//! SSH key listing and generation. Not built for Android.
//!
//! Only `*.pub` files are ever read; private key files are checked for
//! existence and written on generation, never opened for reading. Secrets
//! (passphrases, private key bytes) are never logged or put in errors.

use std::fs;
use std::path::{Path, PathBuf};

use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey, PublicKey};

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{SshKey, SshKeyGenerateRequest};

#[cfg(test)]
mod tests;

const MAX_PUB_BYTES: u64 = 16 * 1024;
const MAX_COMMENT_CHARS: usize = 256;
const MAX_PASSPHRASE_CHARS: usize = 1024;

pub fn ssh_dir(home: &Path) -> PathBuf {
    home.join(".ssh")
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, message)
}

/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and not ending in `.pub`.
pub fn validate_name(name: &str) -> AppResult<()> {
    let mut chars = name.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    let rest_ok = chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !first_ok || !rest_ok || name.len() > 64 || name.ends_with(".pub") {
        return Err(invalid(
            "A key name must be 1 to 64 letters, digits, `.`, `_` or `-`, start with a letter or digit and not end in .pub",
        ));
    }
    Ok(())
}

/// The key described by `<stem>.pub` in `dir`; `None` when it does not parse.
fn read_entry(dir: &Path, pub_path: &Path) -> Option<SshKey> {
    let stem = pub_path.file_stem()?.to_string_lossy().into_owned();
    let meta = fs::metadata(pub_path).ok()?;
    if !meta.is_file() || meta.len() > MAX_PUB_BYTES {
        return None;
    }
    let text = fs::read_to_string(pub_path).ok()?;
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let key = PublicKey::from_openssh(line).ok()?;
    let private = dir.join(&stem);
    Some(SshKey {
        path: private.to_string_lossy().into_owned(),
        public_key: line.to_string(),
        algorithm: key.algorithm().as_str().to_string(),
        fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        comment: key.comment().to_string(),
        has_private_key: private.is_file(),
        name: stem,
    })
}

/// Public keys in `dir`, sorted by name. A missing directory is empty.
pub fn list(dir: &Path) -> AppResult<Vec<SshKey>> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut keys: Vec<SshKey> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "pub"))
        .filter_map(|p| read_entry(dir, &p))
        .collect();
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(keys)
}

fn key_error(what: &str) -> AppError {
    AppError::new(ErrorKind::Internal, format!("Could not {what}"))
}

fn ensure_dir(dir: &Path) -> AppResult<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    Ok(())
}

/// Creates an ed25519 key pair `dir/<name>` and `dir/<name>.pub`.
pub fn generate(dir: &Path, req: &SshKeyGenerateRequest) -> AppResult<SshKey> {
    validate_name(&req.name)?;
    if req.comment.chars().count() > MAX_COMMENT_CHARS || req.comment.chars().any(char::is_control)
    {
        return Err(invalid(
            "The comment must be at most 256 characters without control characters",
        ));
    }
    let passphrase = req.passphrase.as_deref().filter(|p| !p.is_empty());
    if passphrase.is_some_and(|p| p.chars().count() > MAX_PASSPHRASE_CHARS) {
        return Err(invalid("The passphrase is too long"));
    }
    ensure_dir(dir)?;
    let private_path = dir.join(&req.name);
    let public_path = dir.join(format!("{}.pub", req.name));
    if private_path.symlink_metadata().is_ok() || public_path.symlink_metadata().is_ok() {
        return Err(invalid(format!("A key named {} already exists", req.name)));
    }

    let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
        .map_err(|_| key_error("generate the key"))?;
    key.set_comment(req.comment.as_str());
    let public_line = key
        .public_key()
        .to_openssh()
        .map_err(|_| key_error("encode the public key"))?;
    let key = match passphrase {
        Some(p) => key
            .encrypt(&mut OsRng, p)
            .map_err(|_| key_error("encrypt the key"))?,
        None => key,
    };
    let private_pem = key
        .to_openssh(LineEnding::LF)
        .map_err(|_| key_error("encode the private key"))?;

    crate::settings::atomic_write_mode(&private_path, private_pem.as_bytes(), Some(0o600))?;
    let public_text = format!("{}\n", public_line.trim());
    if let Err(e) =
        crate::settings::atomic_write_mode(&public_path, public_text.as_bytes(), Some(0o644))
    {
        let _ = fs::remove_file(&private_path);
        return Err(e);
    }
    read_entry(dir, &public_path).ok_or_else(|| key_error("read the new key"))
}
