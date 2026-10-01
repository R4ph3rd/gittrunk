//! PTY-backed sessions (desktop only).
use std::collections::HashMap;
use std::io::{Read, Write};
use std::ops::Deref;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::{clamp_cols, clamp_rows, shell_command, EmitFn, TermEvent, Utf8Carry, MAX_SESSIONS};
use crate::ipc::error::{AppError, AppResult, ErrorKind};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

/// Shared state; killing every child on drop means app exit leaves nothing behind.
#[derive(Default)]
pub struct Inner {
    sessions: Sessions,
    next: AtomicU64,
}

/// Open terminal sessions. Cheap to clone via [`Terminals::handle`] so blocking
/// work can move onto another thread.
#[derive(Default)]
pub struct Terminals(Arc<Inner>);

impl Deref for Terminals {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl Terminals {
    /// Another handle to the same sessions.
    pub fn handle(&self) -> Terminals {
        Terminals(self.0.clone())
    }
}

fn lock(sessions: &Sessions) -> MutexGuard<'_, HashMap<String, Session>> {
    sessions.lock().unwrap_or_else(|p| p.into_inner())
}

fn internal(e: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::Internal, format!("terminal: {e}"))
}

fn closed(id: &str) -> AppError {
    AppError::new(ErrorKind::InvalidInput, format!("terminal {id} is closed"))
}

fn too_many() -> AppError {
    AppError::new(
        ErrorKind::InvalidInput,
        format!("at most {MAX_SESSIONS} terminals can be open"),
    )
}

impl Inner {
    /// Number of live sessions.
    pub fn count(&self) -> usize {
        lock(&self.sessions).len()
    }

    /// Spawns a shell in `cwd` and starts streaming its output to `emit`.
    pub fn open(&self, cwd: &str, cols: u32, rows: u32, emit: EmitFn) -> AppResult<String> {
        if !Path::new(cwd).is_dir() {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                format!("{cwd} is not an existing directory"),
            ));
        }
        if self.count() >= MAX_SESSIONS {
            return Err(too_many());
        }
        let os = if cfg!(windows) { "windows" } else { "unix" };
        let (program, args) = shell_command(&|k| std::env::var(k).ok(), os);
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "gittrunk");

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: clamp_rows(rows),
                cols: clamp_cols(cols),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(internal)?;
        let mut child = pair.slave.spawn_command(cmd).map_err(internal)?;
        drop(pair.slave);
        let killer = child.clone_killer();
        let streams = pair
            .master
            .try_clone_reader()
            .and_then(|r| pair.master.take_writer().map(|w| (r, w)));
        let (mut reader, writer) = match streams {
            Ok(rw) => rw,
            Err(e) => {
                let _ = child.kill();
                return Err(internal(e));
            }
        };

        let id = format!("term-{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
        {
            let mut map = lock(&self.sessions);
            if map.len() >= MAX_SESSIONS {
                let _ = child.kill();
                return Err(too_many());
            }
            map.insert(
                id.clone(),
                Session {
                    master: pair.master,
                    writer,
                    killer,
                },
            );
        }

        let sessions = self.sessions.clone();
        let thread_id = id.clone();
        let spawned = std::thread::Builder::new()
            .name(format!("gittrunk-{id}"))
            .spawn(move || {
                let mut buf = vec![0u8; 16 * 1024];
                let mut carry = Utf8Carry::default();
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let data = carry.push(&buf[..n]);
                            if !data.is_empty() {
                                emit(TermEvent::Output {
                                    id: thread_id.clone(),
                                    data,
                                });
                            }
                        }
                    }
                }
                let tail = carry.finish();
                if !tail.is_empty() {
                    emit(TermEvent::Output {
                        id: thread_id.clone(),
                        data: tail,
                    });
                }
                let code = child.wait().ok().map(|s| s.exit_code() as i32);
                lock(&sessions).remove(&thread_id);
                emit(TermEvent::Exit {
                    id: thread_id,
                    code,
                });
            });
        if let Err(e) = spawned {
            self.close(&id);
            return Err(internal(e));
        }
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &str) -> AppResult<()> {
        let mut map = lock(&self.sessions);
        let s = map.get_mut(id).ok_or_else(|| closed(id))?;
        s.writer
            .write_all(data.as_bytes())
            .and_then(|()| s.writer.flush())
            .map_err(|e| AppError::new(ErrorKind::Io, format!("terminal {id}: {e}")))
    }

    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let map = lock(&self.sessions);
        let s = map.get(id).ok_or_else(|| closed(id))?;
        s.master
            .resize(PtySize {
                rows: clamp_rows(rows),
                cols: clamp_cols(cols),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(internal)
    }

    /// Kills the child and drops the PTY; unknown ids are ignored.
    pub fn close(&self, id: &str) {
        let removed = lock(&self.sessions).remove(id);
        if let Some(mut s) = removed {
            let _ = s.killer.kill();
        }
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        let all: Vec<Session> = lock(&self.sessions).drain().map(|(_, s)| s).collect();
        for mut s in all {
            let _ = s.killer.kill();
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    use std::time::{Duration, Instant};

    fn collector() -> (EmitFn, Receiver<TermEvent>) {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let f: EmitFn = Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        });
        (f, rx)
    }

    fn wait_output(rx: &Receiver<TermEvent>, needle: &str) -> String {
        let end = Instant::now() + Duration::from_secs(5);
        let mut acc = String::new();
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            if let Ok(TermEvent::Output { data, .. }) = rx.recv_timeout(left) {
                acc.push_str(&data);
                if acc.contains(needle) {
                    return acc;
                }
            }
        }
        panic!("timed out waiting for {needle:?}; got {acc:?}");
    }

    fn wait_exit(rx: &Receiver<TermEvent>) -> Option<i32> {
        let end = Instant::now() + Duration::from_secs(5);
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            if let Ok(TermEvent::Exit { code, .. }) = rx.recv_timeout(left) {
                return code;
            }
        }
        panic!("timed out waiting for exit");
    }

    fn wait_count(t: &Terminals, n: usize) {
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end {
            if t.count() == n {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("count never reached {n}, is {}", t.count());
    }

    fn open(t: &Terminals, dir: &Path) -> (String, Receiver<TermEvent>) {
        let (f, rx) = collector();
        let id = t.open(dir.to_str().unwrap(), 80, 24, f).unwrap();
        (id, rx)
    }

    #[test]
    fn echo_pwd_resize_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let t = Terminals::default();
        let (id, rx) = open(&t, dir.path());
        assert_eq!(id, "term-1");
        t.write(&id, "echo gittrunk-$((40+2))\n").unwrap();
        wait_output(&rx, "gittrunk-42\r\n");
        t.write(&id, "pwd\n").unwrap();
        let real = dir.path().canonicalize().unwrap();
        wait_output(&rx, real.to_str().unwrap());
        t.resize(&id, 100, 30).unwrap();
        t.resize(&id, 0, 0).unwrap();
        // `exec` so a login shell's ~/.bash_logout (Ubuntu runs clear_console,
        // which fails in a pty) cannot replace the exit status.
        t.write(&id, "exec sh -c 'exit 3'\n").unwrap();
        assert_eq!(wait_exit(&rx), Some(3));
        wait_count(&t, 0);
        assert_eq!(t.write(&id, "x").unwrap_err().kind, ErrorKind::InvalidInput);
    }

    #[test]
    fn close_kills_running_child() {
        let dir = tempfile::tempdir().unwrap();
        let t = Terminals::default();
        let (id, rx) = open(&t, dir.path());
        t.write(&id, "sleep 30\n").unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(t.count(), 1);
        t.close(&id);
        assert_eq!(t.count(), 0);
        t.close(&id);
        t.close("nope");
        let _ = wait_exit(&rx);
    }

    #[test]
    fn errors_and_limit() {
        let dir = tempfile::tempdir().unwrap();
        let t = Terminals::default();
        let (f, _rx) = collector();
        let missing = dir.path().join("missing");
        let e = t.open(missing.to_str().unwrap(), 80, 24, f).unwrap_err();
        assert_eq!(e.kind, ErrorKind::InvalidInput);
        let e = t.write("term-99", "x").unwrap_err();
        assert_eq!(e.kind, ErrorKind::InvalidInput);
        assert_eq!(e.message, "terminal term-99 is closed");
        assert_eq!(
            t.resize("term-99", 1, 1).unwrap_err().kind,
            ErrorKind::InvalidInput
        );
        let mut keep = Vec::new();
        for _ in 0..MAX_SESSIONS {
            keep.push(open(&t, dir.path()));
        }
        let (f, _rx2) = collector();
        let e = t.open(dir.path().to_str().unwrap(), 80, 24, f).unwrap_err();
        assert_eq!(e.kind, ErrorKind::InvalidInput);
        drop(t);
    }
}
