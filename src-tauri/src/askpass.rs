//! Git askpass bridge. Git runs the gittrunk executable as `GIT_ASKPASS` /
//! `SSH_ASKPASS`; in that mode the process forwards the prompt to the running
//! app (a per-operation loopback listener, see `git::remote::creds`), which
//! shows it in the UI (`CredentialRequested`), and prints the answer.
//!
//! Protocol: the helper connects to `GITTRUNK_ASKPASS_ADDR`, sends one JSON
//! line `{"token", "prompt"}` and reads one JSON line `{"ok", "value"}`.
//!
//! This module must stay dependency-light (std + serde): it runs before Tauri
//! starts and never opens a window.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const ENV_ADDR: &str = "GITTRUNK_ASKPASS_ADDR";
pub const ENV_TOKEN: &str = "GITTRUNK_ASKPASS_TOKEN";

/// The app waits at most five minutes for the user; the helper waits a bit
/// longer so the app's timeout answer always arrives first.
const REPLY_TIMEOUT: Duration = Duration::from_secs(6 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub token: String,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reply {
    pub ok: bool,
    pub value: Option<String>,
}

/// Sends `prompt` to the app at `addr` and returns its answer.
pub fn request(addr: &str, token: &str, prompt: &str) -> std::io::Result<Reply> {
    let invalid = |m: String| std::io::Error::new(std::io::ErrorKind::InvalidData, m);
    let sock: SocketAddr = addr
        .parse()
        .map_err(|_| invalid(format!("bad askpass address `{addr}`")))?;
    let mut stream = TcpStream::connect_timeout(&sock, CONNECT_TIMEOUT)?;
    stream.set_read_timeout(Some(REPLY_TIMEOUT))?;
    let req = Request {
        token: token.to_string(),
        prompt: prompt.to_string(),
    };
    let mut line = serde_json::to_string(&req).map_err(|e| invalid(e.to_string()))?;
    line.push('\n');
    stream.write_all(line.as_bytes())?;
    stream.flush()?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply)?;
    serde_json::from_str(reply.trim()).map_err(|e| invalid(e.to_string()))
}

/// Helper logic: prints the answer to `out` and returns the exit code
/// (`0` answered, `1` cancelled or failed).
pub fn run_with(addr: &str, token: &str, prompt: &str, out: &mut dyn Write) -> i32 {
    match request(addr, token, prompt) {
        Ok(Reply {
            ok: true,
            value: Some(value),
        }) => {
            if writeln!(out, "{value}").is_err() || out.flush().is_err() {
                return 1;
            }
            0
        }
        _ => 1,
    }
}

/// Returns `Some(exit_code)` when this process was launched as an askpass
/// helper and has already handled the prompt; `None` for a normal app start.
pub fn maybe_run() -> Option<i32> {
    let addr = std::env::var(ENV_ADDR).ok().filter(|a| !a.is_empty())?;
    let token = std::env::var(ENV_TOKEN).unwrap_or_default();
    let prompt = std::env::args().nth(1).unwrap_or_default();
    Some(run_with(
        &addr,
        &token,
        &prompt,
        &mut std::io::stdout().lock(),
    ))
}
