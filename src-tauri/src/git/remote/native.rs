//! libgit2 network backend for embedded builds.
pub fn enabled() -> bool {
    cfg!(embedded_git)
}
