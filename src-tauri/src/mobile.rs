//! Embedded (Android) startup: private data dir, secret store, and libgit2
//! process-wide options. Compiled only with `cfg(embedded_git)`.

use std::fs;
use std::path::Path;

use git2::ConfigLevel;

use crate::ipc::error::{AppError, AppResult, ErrorKind};

/// CA stores to read, in order of preference: the updatable Conscrypt APEX
/// store (Android 14+), then the system image one (one PEM per file).
#[cfg(target_os = "android")]
const ANDROID_CA_DIRS: [&str; 2] = [
    "/apex/com.android.conscrypt/cacerts",
    "/system/etc/security/cacerts",
];

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

/// The PEM certificates of the first directory in `dirs` that holds any
/// (sorted by file name). Files without a certificate and subdirectories are
/// skipped; with no certificate anywhere the result is empty.
///
/// Why in memory: OpenSSL is built `no-stdio` on Android, so libgit2's file
/// and directory options cannot load anything there.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn collect_ca_pems(dirs: &[&Path]) -> Vec<String> {
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
        let mut certs = Vec::new();
        for file in files {
            let Ok(bytes) = fs::read(&file) else {
                continue;
            };
            for block in pem_blocks(&String::from_utf8_lossy(&bytes)) {
                certs.push(format!("{block}\n"));
            }
        }
        if !certs.is_empty() {
            return certs;
        }
    }
    Vec::new()
}

/// Registers the system CA certificates with libgit2's OpenSSL store.
/// Individual bad certificates are skipped; fails only if none is added.
///
/// # Safety
/// Mutates process-global libgit2 state; call at startup before any
/// repository is opened.
#[cfg(target_os = "android")]
unsafe fn configure_ca() -> AppResult<()> {
    use foreign_types::ForeignTypeRef;
    use std::os::raw::c_int;

    let dirs = ANDROID_CA_DIRS.map(Path::new);
    let pems = collect_ca_pems(&dirs);
    if pems.is_empty() {
        return Err(AppError::new(
            ErrorKind::Internal,
            format!("CA bundle: no CA certificates found in {ANDROID_CA_DIRS:?}"),
        ));
    }
    // Make sure libgit2 (and its OpenSSL backend) is initialised.
    libgit2_sys::init();
    let mut added = 0usize;
    for pem in &pems {
        let Ok(x509) = openssl::x509::X509::from_pem(pem.as_bytes()) else {
            continue;
        };
        // libgit2 adds the certificate to its store, which takes its own
        // reference; `x509` stays valid until the end of this iteration.
        let rc = libgit2_sys::git_libgit2_opts(
            libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as c_int,
            x509.as_ptr(),
        );
        if rc >= 0 {
            added += 1;
        }
    }
    if added == 0 {
        return Err(AppError::new(
            ErrorKind::Internal,
            format!(
                "CA bundle: libgit2 accepted none of {} certificates",
                pems.len()
            ),
        ));
    }
    Ok(())
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
        configure_ca()?;
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
    fn collect_keeps_only_certificate_blocks_of_the_first_store_with_any() {
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

        let certs = collect_ca_pems(&[&missing, &empty, &system]);
        // Sorted by file name, blocks only.
        assert_eq!(certs, vec![cert("AAAA") + "\n", cert("BBBB") + "\n"]);
        assert!(certs.iter().all(|c| !c.contains("Certificate:")));
    }

    #[test]
    fn collect_prefers_the_first_store() {
        let tmp = tempfile::tempdir().unwrap();
        let apex = tmp.path().join("apex");
        let system = tmp.path().join("system");
        fs::create_dir_all(&apex).unwrap();
        fs::create_dir_all(&system).unwrap();
        fs::write(apex.join("1.0"), android_file("NEW")).unwrap();
        fs::write(system.join("1.0"), android_file("OLD")).unwrap();
        assert_eq!(collect_ca_pems(&[&apex, &system]), vec![cert("NEW") + "\n"]);
    }

    #[test]
    fn collect_without_certificates_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let empty = tmp.path().join("empty");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join("notes.txt"), "nothing here\n").unwrap();
        assert!(collect_ca_pems(&[&tmp.path().join("missing"), &empty]).is_empty());
    }
}
