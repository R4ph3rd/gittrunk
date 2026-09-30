//! Compile-time platform facts. `EMBEDDED` = no git CLI; libgit2 does everything.

pub const EMBEDDED: bool = cfg!(embedded_git);
pub const MOBILE: bool = cfg!(mobile);
// Capability switches. Both the git CLI (desktop) and the embedded shim
// (Android) serve these since R1b-2.
/// Non-interactive rebase, `pull --rebase`.
pub const SUPPORTS_REBASE: bool = true;
pub const SUPPORTS_WORKTREES: bool = true;
/// `log --follow`.
pub const SUPPORTS_FILE_HISTORY: bool = true;
/// Git write actions are hidden in the UI (Android: browse, follow, comment).
pub const READ_ONLY: bool = MOBILE;
/// A PTY-backed terminal exists (portable-pty is not built for Android).
pub const SUPPORTS_TERMINAL: bool = cfg!(not(target_os = "android"));
