use super::*;

fn kb(action: &str, keys: &str) -> Keybinding {
    Keybinding {
        action: action.into(),
        keys: keys.into(),
    }
}

#[test]
fn defaults_when_nothing_stored() {
    let d = tempfile::tempdir().unwrap();
    let s = load(d.path());
    assert_eq!(s, defaults());
    assert_eq!(s.theme, ThemePreference::System);
    assert_eq!(s.git_path, None);
    assert_eq!(s.pull_strategy, PullStrategy::Merge);
    assert!(s.confirm_destructive);
    assert_eq!(s.graph_order, CommitOrder::Topo);
    assert_eq!(s.diff_context_lines, 3);
    let none = load(&d.path().join("missing-dir"));
    assert_eq!(none, defaults());
}

#[test]
fn round_trip_and_partial_and_corrupt_files() {
    let d = tempfile::tempdir().unwrap();
    let mut s = defaults();
    s.theme = ThemePreference::Dark;
    s.diff_context_lines = 7;
    s.pull_strategy = PullStrategy::Rebase;
    s.confirm_destructive = false;
    s.graph_order = CommitOrder::Date;
    let saved = save(d.path(), &s).unwrap();
    assert_eq!(saved, s);
    assert_eq!(load(d.path()), s);

    fs::write(d.path().join(SETTINGS_FILE), r#"{"theme":"light"}"#).unwrap();
    let partial = load(d.path());
    assert_eq!(partial.theme, ThemePreference::Light);
    assert_eq!(partial.diff_context_lines, 3);

    fs::write(d.path().join(SETTINGS_FILE), "{ not json").unwrap();
    assert_eq!(load(d.path()), defaults());
}

#[test]
fn validation() {
    let d = tempfile::tempdir().unwrap();
    let mut s = defaults();
    s.diff_context_lines = 21;
    assert_eq!(
        save(d.path(), &s).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    s.diff_context_lines = 20;
    save(d.path(), &s).unwrap();
    s.diff_context_lines = 0;
    save(d.path(), &s).unwrap();

    s.git_path = Some(d.path().join("nope").to_string_lossy().into_owned());
    assert!(save(d.path(), &s).is_err());
    // A directory is not an executable.
    s.git_path = Some(d.path().to_string_lossy().into_owned());
    assert!(save(d.path(), &s).is_err());
    // A file that is not git.
    let fake = d.path().join("fake");
    fs::write(&fake, "not a program").unwrap();
    s.git_path = Some(fake.to_string_lossy().into_owned());
    assert!(save(d.path(), &s).is_err());
    // Blank means PATH.
    s.git_path = Some("  ".into());
    assert_eq!(save(d.path(), &s).unwrap().git_path, None);
    // Nothing invalid was persisted over the good file.
    assert_eq!(load(d.path()).git_path, None);
}

#[test]
fn real_git_path_is_accepted() {
    let out = Command::new("which").arg("git").output();
    let Ok(out) = out else { return };
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        return;
    }
    let d = tempfile::tempdir().unwrap();
    let mut s = defaults();
    s.git_path = Some(path.clone());
    assert_eq!(save(d.path(), &s).unwrap().git_path, Some(path));
    assert!(usable_git_path(&load(d.path())).is_some());
}

#[test]
fn atomic_save_leaves_no_temp_files_and_replaces() {
    let d = tempfile::tempdir().unwrap();
    save(d.path(), &defaults()).unwrap();
    let mut s = defaults();
    s.diff_context_lines = 9;
    save(d.path(), &s).unwrap();
    let names: Vec<String> = fs::read_dir(d.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, [SETTINGS_FILE]);
    // Failed write (target is a directory) keeps no temp file behind.
    let bad = tempfile::tempdir().unwrap();
    fs::create_dir(bad.path().join(SETTINGS_FILE)).unwrap();
    assert!(save(bad.path(), &defaults()).is_err());
    let left: Vec<_> = fs::read_dir(bad.path()).unwrap().collect();
    assert_eq!(left.len(), 1);
}

#[test]
fn keybinding_chords() {
    for ok in [
        "mod+shift+k",
        "ctrl+k",
        "k",
        "f5",
        "alt+enter",
        "g g",
        "mod+k mod+s",
        "mod+,",
        "mod+plus",
        "Mod+Shift+K",
    ] {
        assert!(normalize_keys(ok).is_ok(), "{ok}");
    }
    for bad in [
        "",
        " ",
        "mod+",
        "+",
        "mod+shift",
        "foo+k",
        "mod+mod+k",
        "a b c",
        "a  b",
        "f99",
        "mod+kk",
    ] {
        assert!(normalize_keys(bad).is_err(), "{bad:?}");
    }
    assert_eq!(
        normalize_keys("Shift+Mod+K").unwrap(),
        normalize_keys("mod+shift+k").unwrap()
    );
}

#[test]
fn keybinding_validation_and_persistence() {
    let d = tempfile::tempdir().unwrap();
    assert!(load_keybindings(d.path()).is_empty());
    let good = vec![kb("commit.open", "mod+enter"), kb("palette", "mod+k")];
    assert_eq!(save_keybindings(d.path(), &good).unwrap(), good);
    assert_eq!(load_keybindings(d.path()), good);

    for bad in [
        vec![kb("", "mod+k")],
        vec![kb("  ", "mod+k")],
        vec![kb("a", "")],
        vec![kb("a", "mod+")],
        vec![kb("a", "mod+k"), kb("a", "mod+j")],
        vec![kb("a", "mod+shift+k"), kb("b", "shift+mod+K")],
    ] {
        assert_eq!(
            save_keybindings(d.path(), &bad).unwrap_err().kind,
            ErrorKind::InvalidInput
        );
    }
    assert_eq!(load_keybindings(d.path()), good);
    assert!(save_keybindings(d.path(), &[]).unwrap().is_empty());
}
