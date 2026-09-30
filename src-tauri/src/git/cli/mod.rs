//! Runner for the system `git` executable: no shell, explicit argument
//! vectors, a fixed environment, streaming stderr and cancellation.

mod registry;

pub use registry::{OpHandle, OpRegistry};

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use crate::ipc::error::{AppError, AppResult, ErrorKind};

/// Captured result of a finished git process.
#[derive(Debug, Clone)]
pub struct CliOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    /// Exit code; `-1` when the process was terminated by a signal.
    pub code: i32,
}

impl CliOutput {
    pub fn success(&self) -> bool {
        self.code == 0
    }

    pub fn stdout_str(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    /// Maps a non-zero exit to `AppError { kind: GitCli }`.
    pub fn into_result(self) -> AppResult<CliOutput> {
        if self.success() {
            Ok(self)
        } else {
            Err(self.error())
        }
    }

    fn error(&self) -> AppError {
        let first = self
            .stderr
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("git exited with status {}", self.code));
        AppError::new(ErrorKind::GitCli, first).with_detail(self.stderr.clone())
    }
}

/// Per-call options.
#[derive(Debug, Default, Clone)]
pub struct CliOptions {
    /// Data written to the process' stdin (stdin is closed afterwards).
    pub stdin: Option<Vec<u8>>,
    /// Sets `GIT_OPTIONAL_LOCKS=0` (calls that only read the repository, so
    /// they never fight the user's own git for `index.lock`).
    pub read_only: bool,
    /// Extra environment variables.
    pub env: Vec<(String, String)>,
}

impl CliOptions {
    pub fn read_only() -> Self {
        Self {
            read_only: true,
            ..Self::default()
        }
    }
}

/// Handle to the git executable.
#[derive(Debug, Clone)]
pub struct GitCli {
    program: PathBuf,
}

impl Default for GitCli {
    fn default() -> Self {
        Self::new()
    }
}

impl GitCli {
    /// Uses `git` from `PATH`.
    pub fn new() -> Self {
        Self {
            program: PathBuf::from("git"),
        }
    }

    /// Uses an explicit executable (a future setting).
    pub fn with_path(path: impl Into<PathBuf>) -> Self {
        Self {
            program: path.into(),
        }
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    fn command(&self, dir: &Path, args: &[String], opts: &CliOptions) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.arg("-c").arg("core.quotepath=false");
        cmd.args(args);
        cmd.current_dir(dir);
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        cmd.env("LC_ALL", "C");
        if opts.read_only {
            cmd.env("GIT_OPTIONAL_LOCKS", "0");
        }
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }
        cmd.stdin(if opts.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        cmd
    }

    /// Runs git and returns its output; a non-zero exit is an `AppError`.
    pub fn run<S: AsRef<str>>(&self, dir: &Path, args: &[S]) -> AppResult<CliOutput> {
        self.run_raw(dir, args, &CliOptions::default())?
            .into_result()
    }

    /// Like `run` for calls that only read (`GIT_OPTIONAL_LOCKS=0`).
    pub fn run_read<S: AsRef<str>>(&self, dir: &Path, args: &[S]) -> AppResult<CliOutput> {
        self.run_raw(dir, args, &CliOptions::read_only())?
            .into_result()
    }

    /// Runs git and returns the output whatever the exit code was.
    pub fn run_raw<S: AsRef<str>>(
        &self,
        dir: &Path,
        args: &[S],
        opts: &CliOptions,
    ) -> AppResult<CliOutput> {
        self.run_streaming(dir, args, opts, None, &mut |_| {})
    }

    /// Runs git, calling `on_stderr` for every stderr line (split on `\n` and
    /// `\r`, so `--progress` updates arrive individually). When `op` is given
    /// the child is registered so `OpRegistry::cancel` can kill it, in which
    /// case the result is `ErrorKind::Cancelled`.
    pub fn run_streaming<S: AsRef<str>>(
        &self,
        dir: &Path,
        args: &[S],
        opts: &CliOptions,
        op: Option<&OpHandle>,
        on_stderr: &mut dyn FnMut(&str),
    ) -> AppResult<CliOutput> {
        let args: Vec<String> = args.iter().map(|a| a.as_ref().to_string()).collect();
        let mut child = self.command(dir, &args, opts).spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::new(
                    ErrorKind::GitCli,
                    format!("git executable `{}` not found", self.program.display()),
                )
            } else {
                AppError::from(e)
            }
        })?;

        let stdin_thread = match (child.stdin.take(), opts.stdin.clone()) {
            (Some(mut pipe), Some(data)) => Some(std::thread::spawn(move || {
                let _ = pipe.write_all(&data);
            })),
            _ => None,
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let out_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut s) = stdout {
                let _ = s.read_to_end(&mut buf);
            }
            buf
        });
        let (tx, rx) = mpsc::channel::<String>();
        let err_thread = std::thread::spawn(move || {
            let Some(mut s) = stderr else { return };
            let mut chunk = [0u8; 4096];
            let mut line = Vec::new();
            loop {
                match s.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        for &b in &chunk[..n] {
                            if b == b'\n' || b == b'\r' {
                                if !line.is_empty() {
                                    let _ = tx.send(String::from_utf8_lossy(&line).into_owned());
                                    line.clear();
                                }
                            } else {
                                line.push(b);
                            }
                        }
                    }
                }
            }
            if !line.is_empty() {
                let _ = tx.send(String::from_utf8_lossy(&line).into_owned());
            }
        });

        let child = Arc::new(parking_lot::Mutex::new(child));
        if let Some(op) = op {
            op.attach(child.clone());
        }
        let mut stderr_text = String::new();
        let mut record = |line: String, text: &mut String| {
            on_stderr(&line);
            text.push_str(&line);
            text.push('\n');
        };

        let status = loop {
            match rx.recv_timeout(Duration::from_millis(10)) {
                Ok(line) => record(line, &mut stderr_text),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // stderr closed but the process may still run.
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            let done = child
                .lock()
                .try_wait()
                .map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))?;
            if let Some(status) = done {
                break status;
            }
            if op.is_some_and(OpHandle::is_cancelled) {
                // Reader threads may outlive grandchildren that still hold
                // the pipes, so they are not joined here.
                let _ = child.lock().wait();
                return Err(AppError::new(ErrorKind::Cancelled, "operation cancelled"));
            }
        };
        if op.is_some_and(OpHandle::is_cancelled) {
            return Err(AppError::new(ErrorKind::Cancelled, "operation cancelled"));
        }
        if let Some(t) = stdin_thread {
            let _ = t.join();
        }
        let stdout = out_thread.join().unwrap_or_default();
        let _ = err_thread.join();
        while let Ok(line) = rx.try_recv() {
            record(line, &mut stderr_text);
        }
        Ok(CliOutput {
            stdout,
            stderr: stderr_text,
            code: status.code().unwrap_or(-1),
        })
    }
}

/// Kills `child` (ignoring "already exited").
pub(crate) fn kill(child: &Arc<parking_lot::Mutex<Child>>) {
    let _ = child.lock().kill();
}

#[cfg(test)]
mod tests;
