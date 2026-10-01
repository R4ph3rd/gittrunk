//! Embedded (Android) startup: private data dir, secret store, and libgit2
//! process-wide options. Compiled only with `cfg(embedded_git)`.

use std::fs;
use std::path::Path;

use git2::ConfigLevel;

use crate::ipc::error::{AppError, AppResult, ErrorKind};

/// Android's system CA store (one PEM per file, hashed names).
#[cfg(target_os = "android")]
const ANDROID_CA_DIR: &str = "/system/etc/security/cacerts";

/// CA stores to bundle, in order of preference: the updatable Conscrypt
/// APEX store (Android 14+), then the system image one.
#[cfg(target_os = "android")]
const ANDROID_CA_DIRS: [&str; 2] = ["/apex/com.android.conscrypt/cacerts", ANDROID_CA_DIR];

/// File name of the generated bundle inside the app data dir.
#[cfg(target_os = "android")]
const CA_BUNDLE: &str = "cacert.pem";

const PEM_BEGIN: &str = "-----BEGIN CERTIFICATE-----";
const PEM_END: &str = "-----END CERTIFICATE-----";

fn git_error(what: &str, e: git2::Error) -> AppError {
    AppError::new(ErrorKind::Internal, format!("{what}: {}", e.message()))
}

/// The `BEGIN CERTIFICATE` .. `END CERTIFICATE` blocks of `text`, without
/// the human-readable dump Android stores next to each certificate.
fn pem_blocks(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(PEM_BEGIN) {
        let Some(len) = rest[start..].find(PEM_END) else {
            break;
        };
        let end = start + len + PEM_END.len();
        out.push(&rest[start..end]);
        rest = &rest[end..];
    }
    out
}

/// Concatenates the PEM certificates of the first directory in `dirs` that
/// holds any into `out` (written atomically). Files without a certificate
/// and subdirectories are skipped. Returns the number of certificates
/// written; with none, `out` is left untouched.
///
/// Why a bundle: Android names its CA files after OpenSSL's *old* subject
/// hash, while OpenSSL 3 (libgit2's TLS backend on Android) looks up the new
/// one, so pointing libgit2 at the directory finds no certificate.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn build_ca_bundle(dirs: &[&Path], out: &Path) -> AppResult<usize> {
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        let mut files: Vec<_> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        files.sort();
        let mut bundle = String::new();
        let mut count = 0;
        for file in files {
            let Ok(bytes) = fs::read(&file) else {
                continue;
            };
            for block in pem_blocks(&String::from_utf8_lossy(&bytes)) {
                bundle.push_str(block);
                bundle.push('\n');
                count += 1;
            }
        }
        if count > 0 {
            crate::settings::atomic_write(out, bundle.as_bytes())?;
            return Ok(count);
        }
    }
    Ok(0)
}

/// Points libgit2 (OpenSSL) at a PEM bundle of the system CA certificates,
/// or at the raw system directory when no bundle can be built.
///
/// # Safety
/// Mutates process-global libgit2 state; call once at startup before any
/// repository is opened.
#[cfg(target_os = "android")]
unsafe fn configure_ca(data_dir: &Path) -> AppResult<()> {
    let bundle = data_dir.join(CA_BUNDLE);
    let dirs = ANDROID_CA_DIRS.map(Path::new);
    match build_ca_bundle(&dirs, &bundle) {
        Ok(n) if n > 0 => {
            return git2::opts::set_ssl_cert_file(&bundle).map_err(|e| git_error("CA bundle", e));
        }
        Ok(_) => eprintln!(
            "gittrunk: warning: no CA certificates found in {ANDROID_CA_DIRS:?}; \
             falling back to {ANDROID_CA_DIR}"
        ),
        Err(e) => eprintln!(
            "gittrunk: warning: could not write the CA bundle ({}); falling back to {ANDROID_CA_DIR}",
            e.message
        ),
    }
    git2::opts::set_ssl_cert_dir(ANDROID_CA_DIR).map_err(|e| git_error("CA directory", e))
}

pub fn init(data_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(data_dir).map_err(|e| {
        AppError::new(
            ErrorKind::Io,
            format!("create data dir {}: {e}", data_dir.display()),
        )
    })?;
    crate::secrets::init(data_dir)
        .map_err(|e| AppError::new(e.kind, format!("secret store: {}", e.message)))?;
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
        configure_ca(data_dir)?;
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

    fn cert(body: &str) -> String {
        format!("{PEM_BEGIN}\n{body}\n{PEM_END}")
    }

    /// Layout of Android's cacerts files: the PEM block, then an
    /// `openssl x509 -text` style dump.
    fn android_file(body: &str) -> String {
        format!(
            "{}\nCertificate:\n    Data:\n        Version: 3 (0x2)\n        Subject: CN={body}\n",
            cert(body)
        )
    }

    #[test]
    fn bundle_keeps_only_certificate_blocks_of_the_first_store_with_any() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("apex");
        let empty = tmp.path().join("empty");
        let system = tmp.path().join("system");
        fs::create_dir_all(&empty).unwrap();
        fs::create_dir_all(system.join("subdir")).unwrap();
        fs::write(system.join("b1a2c3d4.0"), android_file("BBBB")).unwrap();
        fs::write(system.join("a0000000.0"), cert("AAAA")).unwrap();
        fs::write(system.join("README"), "not a certificate\n").unwrap();
        fs::write(system.join("binary"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
        fs::write(system.join("subdir/c.0"), cert("SUBDIR")).unwrap();
        // A truncated block is not a certificate.
        fs::write(system.join("zz.0"), format!("{PEM_BEGIN}\nZZZZ\n")).unwrap();

        let out = tmp.path().join("data").join("cacert.pem");
        let n = build_ca_bundle(&[&missing, &empty, &system], &out).unwrap();
        assert_eq!(n, 2);
        let bundle = fs::read_to_string(&out).unwrap();
        // Sorted by file name, blocks only, one per line group.
        assert_eq!(bundle, format!("{}\n{}\n", cert("AAAA"), cert("BBBB")));
        assert!(!bundle.contains("Certificate:"));
        assert!(!bundle.contains("SUBDIR"));
    }

    #[test]
    fn bundle_prefers_the_first_store_and_overwrites_a_previous_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let apex = tmp.path().join("apex");
        let system = tmp.path().join("system");
        fs::create_dir_all(&apex).unwrap();
        fs::create_dir_all(&system).unwrap();
        fs::write(apex.join("1.0"), android_file("NEW")).unwrap();
        fs::write(system.join("1.0"), android_file("OLD")).unwrap();
        let out = tmp.path().join("cacert.pem");
        fs::write(&out, "stale").unwrap();

        assert_eq!(build_ca_bundle(&[&apex, &system], &out).unwrap(), 1);
        assert_eq!(
            fs::read_to_string(&out).unwrap(),
            format!("{}\n", cert("NEW"))
        );
    }

    #[test]
    fn bundle_without_certificates_writes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let empty = tmp.path().join("empty");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join("notes.txt"), "nothing here\n").unwrap();
        let out = tmp.path().join("cacert.pem");

        assert_eq!(
            build_ca_bundle(&[&tmp.path().join("missing"), &empty], &out).unwrap(),
            0
        );
        assert!(!out.exists());
    }
}
