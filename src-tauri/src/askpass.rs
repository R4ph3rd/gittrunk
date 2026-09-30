//! Git askpass bridge. Git runs the gittrunk executable as `GIT_ASKPASS` /
//! `SSH_ASKPASS`; in that mode the process forwards the prompt to the running
//! app, which shows it in the UI (`CredentialRequested`), and prints the answer.
//!
//! Owned by `rust-git-agent` (remotes track). Phase 0 stub: never intercepts.

/// Returns `Some(exit_code)` when this process was launched as an askpass
/// helper and has already handled the prompt; `None` for a normal app start.
pub fn maybe_run() -> Option<i32> {
    None
}
