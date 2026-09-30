//! App side of the credential bridge: a per-operation loopback listener that
//! the askpass helper (`crate::askpass`) talks to, prompt classification, the
//! pending-request table behind `credential_respond`, and keychain lookups.

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use super::keychain::{self, SecretStore};
use crate::askpass::{self, Reply, Request};
use crate::git::cli::OpHandle;
use crate::ipc::types::{CredentialKind, CredentialRequested};

/// How long the UI has to answer before the request is cancelled.
pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Host used in the keychain for SSH key passphrases (account = key path).
pub const SSH_KEY_HOST: &str = "ssh-key";

/// A UI answer: `value = None` cancels.
#[derive(Debug)]
pub struct CredResponse {
    pub value: Option<String>,
    pub remember: bool,
}

/// Requests waiting for `credential_respond`, keyed by request id.
#[derive(Clone, Default)]
pub struct PendingCredentials(Arc<Mutex<HashMap<String, mpsc::Sender<CredResponse>>>>);

impl PendingCredentials {
    fn register(&self) -> (String, mpsc::Receiver<CredResponse>) {
        let (tx, rx) = mpsc::channel();
        let id = format!("cred-{}", random_hex(8));
        self.0.lock().insert(id.clone(), tx);
        (id, rx)
    }

    fn forget(&self, id: &str) {
        self.0.lock().remove(id);
    }

    /// Delivers the UI's answer; unknown (timed out / duplicate) ids are an error.
    pub fn respond(
        &self,
        request_id: &str,
        value: Option<String>,
        remember: bool,
    ) -> crate::ipc::error::AppResult<()> {
        let tx = self.0.lock().remove(request_id).ok_or_else(|| {
            crate::ipc::error::AppError::new(
                crate::ipc::error::ErrorKind::InvalidInput,
                format!("no pending credential request `{request_id}`"),
            )
        })?;
        // The waiting side may have given up meanwhile; that is fine.
        let _ = tx.send(CredResponse { value, remember });
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.0.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// `n` random bytes as lower-case hex. std-only: `RandomState` is seeded by
/// the OS per thread; time, pid and a counter are mixed in. Adequate for a
/// loopback token; a dedicated CSPRNG crate would be stronger.
pub fn random_hex(n: usize) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut out = String::with_capacity(n * 2);
    let mut bytes = Vec::with_capacity(n + 8);
    while bytes.len() < n {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        h.write_u128(nanos);
        h.write_u32(std::process::id());
        h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        let local = 0u8;
        h.write_usize(&local as *const u8 as usize);
        bytes.extend_from_slice(&h.finish().to_be_bytes());
    }
    for b in bytes.iter().take(n) {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

// --------------------------------------------------------------- prompts

/// What a prompt from git or ssh asks for.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptInfo {
    pub kind: CredentialKind,
    /// URL (or key path for passphrases) shown to the user.
    pub url: String,
    /// Keychain host (`ssh-key` for passphrases).
    pub host: String,
    pub username: Option<String>,
}

fn quoted(prompt: &str) -> Option<&str> {
    let start = prompt.find('\'')? + 1;
    let end = prompt.rfind('\'')?;
    (end > start).then(|| &prompt[start..end])
}

fn user_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split('/').next()?;
    let (userinfo, _) = authority.rsplit_once('@')?;
    let user = userinfo.split(':').next()?;
    (!user.is_empty()).then(|| user.to_string())
}

fn host_port(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split('/').next().unwrap_or("");
    authority
        .rsplit('@')
        .next()
        .unwrap_or(authority)
        .to_string()
}

/// Whether `prompt` is a host-key confirmation, which is never answered.
pub fn is_confirmation(prompt: &str) -> bool {
    let p = prompt.to_ascii_lowercase();
    p.contains("(yes/no") || p.contains("yes/no/[fingerprint]")
}

/// Classifies git/ssh prompts:
/// `Username for 'https://host': `, `Password for 'https://user@host': `,
/// `Enter passphrase for key '/path': `, `user@host's password: `.
pub fn classify_prompt(prompt: &str) -> PromptInfo {
    let lower = prompt.to_ascii_lowercase();
    if lower.contains("passphrase") {
        let key = quoted(prompt).unwrap_or("").to_string();
        return PromptInfo {
            kind: CredentialKind::Passphrase,
            url: key.clone(),
            host: SSH_KEY_HOST.to_string(),
            username: (!key.is_empty()).then_some(key),
        };
    }
    if let Some(end) = prompt.find("'s password") {
        // OpenSSH: `user@host's password: `
        let target = prompt[..end].trim();
        return PromptInfo {
            kind: CredentialKind::Password,
            url: format!("ssh://{target}"),
            host: host_port(target),
            username: user_of(target),
        };
    }
    let url = quoted(prompt).unwrap_or("").to_string();
    let kind = if lower.starts_with("username") {
        CredentialKind::Username
    } else {
        CredentialKind::Password
    };
    PromptInfo {
        kind,
        host: host_port(&url),
        username: user_of(&url),
        url,
    }
}

// --------------------------------------------------------------- bridge

/// Called for every credential the user has to be asked for.
pub type Notifier = Arc<dyn Fn(CredentialRequested) + Send + Sync>;

struct Shared {
    token: String,
    pending: PendingCredentials,
    notifier: Notifier,
    op: Option<Arc<OpHandle>>,
    secrets: Arc<dyn SecretStore>,
    stop: AtomicBool,
    last_username: Mutex<Option<String>>,
    timeout: Duration,
}

/// Listener owned by one network operation; stops when dropped.
pub struct CredentialBridge {
    addr: String,
    token: String,
    exe: std::path::PathBuf,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl CredentialBridge {
    pub fn start(
        pending: PendingCredentials,
        notifier: Notifier,
        op: Option<Arc<OpHandle>>,
        secrets: Arc<dyn SecretStore>,
    ) -> std::io::Result<Self> {
        Self::start_with_timeout(pending, notifier, op, secrets, PROMPT_TIMEOUT)
    }

    pub fn start_with_timeout(
        pending: PendingCredentials,
        notifier: Notifier,
        op: Option<Arc<OpHandle>>,
        secrets: Arc<dyn SecretStore>,
        timeout: Duration,
    ) -> std::io::Result<Self> {
        let exe = std::env::current_exe()?;
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr()?.to_string();
        let token = random_hex(32);
        let shared = Arc::new(Shared {
            token: token.clone(),
            pending,
            notifier,
            op,
            secrets,
            stop: AtomicBool::new(false),
            last_username: Mutex::new(None),
            timeout,
        });
        let s = shared.clone();
        let thread = std::thread::spawn(move || accept_loop(listener, s));
        Ok(Self {
            addr,
            token,
            exe,
            shared,
            thread: Some(thread),
        })
    }

    pub fn addr(&self) -> &str {
        &self.addr
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    /// Environment that makes git and ssh call back into this bridge.
    pub fn env(&self) -> Vec<(String, String)> {
        let exe = self.exe.to_string_lossy().into_owned();
        vec![
            ("GIT_ASKPASS".into(), exe.clone()),
            ("SSH_ASKPASS".into(), exe),
            ("SSH_ASKPASS_REQUIRE".into(), "force".into()),
            (askpass::ENV_ADDR.into(), self.addr.clone()),
            (askpass::ENV_TOKEN.into(), self.token.clone()),
        ]
    }
}

impl Drop for CredentialBridge {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    while !shared.stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let s = shared.clone();
                std::thread::spawn(move || {
                    let _ = handle_connection(stream, &s);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
}

fn handle_connection(stream: TcpStream, shared: &Shared) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut line = String::new();
    // A request line is small; cap what an untrusted local peer can send.
    BufReader::new((&stream).take(64 * 1024)).read_line(&mut line)?;
    let reply = match serde_json::from_str::<Request>(line.trim()) {
        Ok(req) if req.token == shared.token => answer(shared, &req.prompt),
        _ => Reply {
            ok: false,
            value: None,
        },
    };
    let mut out = serde_json::to_string(&reply)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    out.push('\n');
    (&stream).write_all(out.as_bytes())
}

fn answer(shared: &Shared, prompt: &str) -> Reply {
    let value = resolve_prompt(shared, prompt);
    Reply {
        ok: value.is_some(),
        value,
    }
}

fn resolve_prompt(shared: &Shared, prompt: &str) -> Option<String> {
    if is_confirmation(prompt) {
        return None;
    }
    let info = classify_prompt(prompt);
    let username = match info.kind {
        CredentialKind::Username => None,
        _ => info
            .username
            .clone()
            .or_else(|| shared.last_username.lock().clone()),
    };

    // Answer from the keychain when possible.
    match info.kind {
        CredentialKind::Username => {
            if let Some(user) = shared.secrets.get(&info.host, "") {
                *shared.last_username.lock() = Some(user.clone());
                return Some(user);
            }
        }
        _ => {
            if let Some(user) = &username {
                if let Some(secret) = shared.secrets.get(&info.host, user) {
                    return Some(secret);
                }
            }
        }
    }

    let (request_id, rx) = shared.pending.register();
    (shared.notifier)(CredentialRequested {
        request_id: request_id.clone(),
        url: info.url.clone(),
        username: username.clone(),
        kind: info.kind,
    });
    let deadline = Instant::now() + shared.timeout;
    let response = loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(r) => break Some(r),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break None,
        }
        let cancelled = shared.op.as_ref().is_some_and(|o| o.is_cancelled());
        if cancelled || shared.stop.load(Ordering::SeqCst) || Instant::now() >= deadline {
            break None;
        }
    };
    shared.pending.forget(&request_id);
    let response = response?;
    let value = response.value?;
    match info.kind {
        CredentialKind::Username => {
            *shared.last_username.lock() = Some(value.clone());
        }
        _ => {
            if response.remember {
                if let Some(user) = &username {
                    let _ = keychain::store(&*shared.secrets, &info.host, user, &value);
                }
            }
        }
    }
    if matches!(info.kind, CredentialKind::Username) && response.remember {
        let _ = shared.secrets.set(&info.host, "", &value);
    }
    Some(value)
}
