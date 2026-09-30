//! Embedded (Android) startup: private data dir, secret store, and libgit2
//! process-wide options. Compiled only with `cfg(embedded_git)`.

use std::fs;
use std::path::Path;

use git2::ConfigLevel;

use crate::ipc::error::{AppError, AppResult, ErrorKind};

/// Android's system CA store (one PEM per file, hashed names).
#[cfg(target_os = "android")]
const ANDROID_CA_DIR: &str = "/system/etc/security/cacerts";

fn git_error(what: &str, e: git2::Error) -> AppError {
    AppError::new(ErrorKind::Internal, format!("{what}: {}", e.message()))
}

pub fn init(data_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(data_dir)?;
    crate::secrets::init(data_dir)?;
    // libgit2 finds no HOME on Android: keep the global and XDG config in
    // the app's private data dir so `user.name` / `user.email` persist.
    // SAFETY: the option setters mutate process-global libgit2 state; this
    // runs once during startup before any repository is opened.
    unsafe {
        git2::opts::set_search_path(ConfigLevel::Global, data_dir)
            .map_err(|e| git_error("global config path", e))?;
        git2::opts::set_search_path(ConfigLevel::XDG, data_dir)
            .map_err(|e| git_error("xdg config path", e))?;
        // The app's files are owned by an app uid that may differ from the
        // one libgit2 sees for shared storage; ownership checks only block.
        git2::opts::set_verify_owner_validation(false)
            .map_err(|e| git_error("owner validation", e))?;
        #[cfg(target_os = "android")]
        git2::opts::set_ssl_cert_dir(ANDROID_CA_DIR).map_err(|e| git_error("CA directory", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// libgit2 options are process-global: serialise and restore.
    static OPTS: Mutex<()> = Mutex::new(());

    #[test]
    fn init_creates_dir_and_points_global_config_there() {
        let _g = OPTS.lock().unwrap_or_else(|p| p.into_inner());
        crate::secrets::test_init();
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("app").join("data");
        init(&data).unwrap();
        assert!(data.is_dir());

        let cfg_dir = unsafe { git2::opts::get_search_path(ConfigLevel::Global) }.unwrap();
        assert_eq!(
            Path::new(cfg_dir.to_str().unwrap()).canonicalize().unwrap(),
            data.canonicalize().unwrap()
        );

        // Identity written to the global config lands under the data dir.
        fs::write(data.join(".gitconfig"), "[user]\n\tname = Mobile\n").unwrap();
        let cfg = git2::Config::open_default().unwrap();
        assert_eq!(cfg.get_string("user.name").unwrap(), "Mobile");
        assert!(git2::Config::find_global()
            .unwrap()
            .starts_with(data.canonicalize().unwrap_or(data.clone())));

        // Restore libgit2 defaults so other tests are unaffected.
        unsafe {
            git2::opts::reset_search_path(ConfigLevel::Global).unwrap();
            git2::opts::reset_search_path(ConfigLevel::XDG).unwrap();
            git2::opts::set_verify_owner_validation(true).unwrap();
        }
    }
}
