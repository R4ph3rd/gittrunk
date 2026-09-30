//! Compile-time platform facts. `EMBEDDED` = no git CLI; libgit2 does everything.

pub const EMBEDDED: bool = cfg!(embedded_git);
pub const MOBILE: bool = cfg!(mobile);
// Capability switches. R1b-2 flips these to `true` when its shim handlers land.
/// Non-interactive rebase, `pull --rebase`.
pub const SUPPORTS_REBASE: bool = !EMBEDDED;
pub const SUPPORTS_WORKTREES: bool = !EMBEDDED;
/// `log --follow`.
pub const SUPPORTS_FILE_HISTORY: bool = !EMBEDDED;
