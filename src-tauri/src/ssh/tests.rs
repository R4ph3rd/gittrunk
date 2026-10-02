use super::*;
use ssh_key::PrivateKey;

fn request(name: &str, comment: &str, passphrase: Option<&str>) -> SshKeyGenerateRequest {
    SshKeyGenerateRequest {
        name: name.into(),
        comment: comment.into(),
        passphrase: passphrase.map(str::to_string),
    }
}

#[test]
fn generate_then_list_unencrypted() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    let made = generate(&dir, &request("id_test", "me@laptop", None)).unwrap();
    assert_eq!(made.name, "id_test");
    assert_eq!(made.algorithm, "ssh-ed25519");
    assert!(made.fingerprint.starts_with("SHA256:"));
    assert_eq!(made.comment, "me@laptop");
    assert!(made.has_private_key);
    assert!(made.public_key.starts_with("ssh-ed25519 "));
    assert!(made.public_key.ends_with("me@laptop"));

    let listed = list(&dir).unwrap();
    assert_eq!(listed, vec![made.clone()]);
    let private = fs::read_to_string(dir.join("id_test")).unwrap();
    let parsed = PrivateKey::from_openssh(&private).unwrap();
    assert!(!parsed.is_encrypted());
    assert!(!private.contains('\r'));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: PathBuf| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(dir.join("id_test")), 0o600);
        assert_eq!(mode(dir.clone()), 0o700);
    }
}

#[test]
fn generate_encrypted_key() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    generate(&dir, &request("id_enc", "c", Some("correct horse"))).unwrap();
    let key = PrivateKey::from_openssh(fs::read_to_string(dir.join("id_enc")).unwrap()).unwrap();
    assert!(key.is_encrypted());
    let plain = key.decrypt("correct horse").unwrap();
    assert!(!plain.is_encrypted());
    assert!(key.decrypt("wrong").is_err());
    // The public line matches the private key.
    let listed = list(&dir).unwrap();
    assert_eq!(
        listed[0].fingerprint,
        plain.public_key().fingerprint(HashAlg::Sha256).to_string()
    );
}

#[test]
fn empty_passphrase_means_unencrypted() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    generate(&dir, &request("k", "", Some(""))).unwrap();
    let key = PrivateKey::from_openssh(fs::read_to_string(dir.join("k")).unwrap()).unwrap();
    assert!(!key.is_encrypted());
}

#[test]
fn refuses_to_overwrite() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    let first = generate(&dir, &request("id_x", "a", None)).unwrap();
    let err = generate(&dir, &request("id_x", "b", None)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert_eq!(err.message, "A key named id_x already exists");
    assert_eq!(list(&dir).unwrap(), vec![first]);

    // An existing public file alone also blocks.
    fs::write(dir.join("lonely.pub"), "x").unwrap();
    let err = generate(&dir, &request("lonely", "", None)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[test]
fn invalid_names_and_inputs() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    let long = "a".repeat(65);
    for name in [
        "",
        "../x",
        "a/b",
        "a\\b",
        ".hidden",
        "x.pub",
        "-x",
        long.as_str(),
    ] {
        let err = generate(&dir, &request(name, "", None)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{name:?}");
    }
    assert!(validate_name(&"a".repeat(64)).is_ok());
    assert!(validate_name("id_ed25519.work-1").is_ok());
    let bad_comment = request("ok", "line\nbreak", None);
    assert_eq!(
        generate(&dir, &bad_comment).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    let long_comment = request("ok", &"c".repeat(257), None);
    assert_eq!(
        generate(&dir, &long_comment).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    let long_pass = request("ok", "", Some(&"p".repeat(1025)));
    let err = generate(&dir, &long_pass).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(!err.message.contains("ppp"));
    assert!(!dir.join("ok").exists());
}

#[test]
fn unparsable_pub_is_skipped_and_orphan_pub_has_no_private_key() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    let made = generate(&dir, &request("real", "c", None)).unwrap();
    fs::write(dir.join("broken.pub"), "this is not a key\n").unwrap();
    fs::write(dir.join("empty.pub"), "\n\n").unwrap();
    fs::write(dir.join("notes.txt"), "ignore").unwrap();
    fs::create_dir(dir.join("dir.pub")).unwrap();
    fs::write(dir.join("huge.pub"), "a".repeat(20_000)).unwrap();
    // A public key copied without its private half.
    let orphan = format!("\n{}\n", made.public_key);
    fs::write(dir.join("orphan.pub"), orphan).unwrap();

    let names: Vec<_> = list(&dir).unwrap().into_iter().map(|k| k.name).collect();
    assert_eq!(names, ["orphan", "real"]);
    let keys = list(&dir).unwrap();
    assert!(!keys[0].has_private_key);
    assert!(keys[1].has_private_key);
}

#[test]
fn missing_dir_lists_empty() {
    let home = tempfile::tempdir().unwrap();
    assert!(list(&ssh_dir(home.path())).unwrap().is_empty());
}

#[test]
fn errors_never_contain_secrets() {
    let home = tempfile::tempdir().unwrap();
    let dir = ssh_dir(home.path());
    generate(&dir, &request("dup", "", Some("s3cret-pass"))).unwrap();
    let err = generate(&dir, &request("dup", "", Some("s3cret-pass"))).unwrap_err();
    let text = format!("{err:?}");
    assert!(!text.contains("s3cret-pass"));
}
