//! Long-running operation plumbing: op ids, background thread, throttled
//! `OpProgress` events, the credential bridge and the final `OpFinished`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri_specta::Event;

use super::creds::{random_hex, CredentialBridge, CredentialResolver, Notifier, PROMPT_TIMEOUT};
use super::keychain::Keychain;
use super::native;
use super::net::NetSession;
use super::progress::Progress;
use crate::git::cli::GitCli;
use crate::git::{GitState, RepoEntry};
use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::*;

/// Minimum spacing of `OpProgress` events (about ten per second).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Decides which progress lines are worth an event.
pub struct Throttle {
    interval: Duration,
    last: Option<Instant>,
    last_phase: String,
}

impl Throttle {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
            last_phase: String::new(),
        }
    }

    /// Phase changes and completed phases always pass.
    pub fn allow(&mut self, p: &Progress, now: Instant) -> bool {
        let due = self
            .last
            .map_or(true, |t| now.duration_since(t) >= self.interval);
        let pass = due || p.phase != self.last_phase || p.percent == Some(100.0);
        if pass {
            self.last = Some(now);
            self.last_phase.clone_from(&p.phase);
        }
        pass
    }
}

fn new_op_id() -> OpId {
    static N: AtomicU64 = AtomicU64::new(1);
    format!("op-{}-{}", N.fetch_add(1, Ordering::Relaxed), random_hex(4))
}

/// Builds the notifier that forwards credential requests to the UI.
pub fn credential_notifier(app: tauri::AppHandle) -> Notifier {
    Arc::new(move |req: CredentialRequested| {
        let _ = req.emit(&app);
    })
}

/// A session for a synchronous network call inside a command (no op id).
pub fn sync_session(
    app: &tauri::AppHandle,
    state: &GitState,
    cli: GitCli,
) -> AppResult<NetSession> {
    if native::enabled() {
        let resolver = resolver(state, app, None);
        return Ok(NetSession::plain(cli).with_resolver(resolver));
    }
    let bridge = CredentialBridge::start(
        state.credentials().clone(),
        credential_notifier(app.clone()),
        None,
        Arc::new(Keychain),
    )
    .map_err(|e| AppError::new(ErrorKind::Io, format!("credential bridge: {e}")))?;
    Ok(NetSession::new(cli, None, Some(bridge), Box::new(|_| {})))
}

/// Resolver for embedded builds (no askpass bridge there).
fn resolver(
    state: &GitState,
    app: &tauri::AppHandle,
    op: Option<Arc<crate::git::cli::OpHandle>>,
) -> Arc<CredentialResolver> {
    Arc::new(
        CredentialResolver::new(
            Arc::new(Keychain),
            state.credentials().clone(),
            credential_notifier(app.clone()),
            PROMPT_TIMEOUT,
        )
        .with_op(op),
    )
}

/// Starts `work` on a background thread and returns its `OpId` immediately.
/// The op is registered in `state.ops()` (so `op_cancel` works); progress and
/// the final result arrive as `OpProgress` / `OpFinished` events.
pub fn spawn_op<F>(
    app: tauri::AppHandle,
    state: &GitState,
    entry: Option<Arc<RepoEntry>>,
    work: F,
) -> OpId
where
    F: FnOnce(&NetSession) -> AppResult<Option<OpOutcome>> + Send + 'static,
{
    let op_id = new_op_id();
    let handle = state.ops().register(&op_id);
    let st = state.clone();
    let id = op_id.clone();
    std::thread::spawn(move || {
        let progress_app = app.clone();
        let progress_id = id.clone();
        let mut throttle = Throttle::new(PROGRESS_INTERVAL);
        let progress: Box<dyn FnMut(Progress) + Send> = Box::new(move |p| {
            if throttle.allow(&p, Instant::now()) {
                let _ = OpProgress {
                    op_id: progress_id.clone(),
                    phase: p.phase,
                    percent: p.percent,
                    message: Some(p.message),
                }
                .emit(&progress_app);
            }
        });
        let result = if native::enabled() {
            let sess = NetSession::new(st.cli().clone(), Some(handle.clone()), None, progress)
                .with_resolver(resolver(&st, &app, Some(handle)));
            work(&sess)
        } else {
            CredentialBridge::start(
                st.credentials().clone(),
                credential_notifier(app.clone()),
                Some(handle.clone()),
                Arc::new(Keychain),
            )
            .map_err(|e| AppError::new(ErrorKind::Io, format!("credential bridge: {e}")))
            .and_then(|bridge| {
                let sess = NetSession::new(st.cli().clone(), Some(handle), Some(bridge), progress);
                work(&sess)
            })
        };
        st.ops().finish(&id);
        if let Some(e) = entry {
            e.invalidate_graph();
        }
        let payload = match result {
            Ok(outcome) => OpFinishedPayload {
                op_id: id,
                outcome,
                error: None,
            },
            Err(error) => OpFinishedPayload {
                op_id: id,
                outcome: None,
                error: Some(error),
            },
        };
        let _ = OpFinished(payload).emit(&app);
    });
    op_id
}
