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
fn settings_without_m10_fields_get_their_defaults() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join(SETTINGS_FILE), r#"{"theme":"dark"}"#).unwrap();
    let s = load(d.path());
    assert_eq!(s.theme, ThemePreference::Dark);
    assert!(s.backdrop);
    assert!(s.workspaces.is_empty());
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
#[cfg(not(embedded_git))]
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
#[cfg(not(embedded_git))]
fn real_git_path_is_accepted() {
    // Search PATH natively: `which` on Windows runners is MSYS and returns
    // MSYS-style paths such as `/cmd/git` that native code cannot open.
    let exe = if cfg!(windows) { "git.exe" } else { "git" };
    let Some(found) = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(exe))
            .find(|candidate| candidate.is_file())
    }) else {
        return;
    };
    let path = found.to_string_lossy().into_owned();
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

#[test]
#[cfg(embedded_git)]
fn cli_path_is_inert_when_embedded() {
    let d = tempfile::tempdir().unwrap();
    let mut s = defaults();
    s.git_path = Some("/definitely/not/a/cli".into());
    let saved = save(d.path(), &s).unwrap();
    assert_eq!(saved.git_path.as_deref(), Some("/definitely/not/a/cli"));
    assert_eq!(
        load(d.path()).git_path.as_deref(),
        Some("/definitely/not/a/cli")
    );
    assert_eq!(usable_git_path(&saved), None);
}

fn ws(id: &str, name: &str, repos: &[&str]) -> Workspace {
    Workspace {
        id: id.into(),
        name: name.into(),
        repos: repos.iter().map(|r| (*r).to_string()).collect(),
    }
}

fn with_workspaces(list: Vec<Workspace>) -> AppSettings {
    let mut s = defaults();
    s.workspaces = list;
    s
}

#[test]
fn workspaces_are_trimmed_and_deduplicated() {
    let s = with_workspaces(vec![ws("a-1", "  Work  ", &["/x", "/y", "/x"])]);
    let clean = validate(&s).unwrap();
    assert_eq!(clean.workspaces, vec![ws("a-1", "Work", &["/x", "/y"])]);
}

#[test]
fn workspace_rules_are_enforced() {
    let bad = |list: Vec<Workspace>| {
        let err = validate(&with_workspaces(list)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    };
    bad((0..51).map(|i| ws(&format!("w{i}"), "n", &[])).collect());
    bad(vec![ws("", "n", &[])]);
    bad(vec![ws(&"a".repeat(65), "n", &[])]);
    bad(vec![ws("has space", "n", &[])]);
    bad(vec![ws("a", "n", &[]), ws("a", "m", &[])]);
    bad(vec![ws("a", "   ", &[])]);
    bad(vec![ws("a", &"n".repeat(65), &[])]);
    let many: Vec<String> = (0..201).map(|i| format!("/r{i}")).collect();
    let refs: Vec<&str> = many.iter().map(String::as_str).collect();
    bad(vec![ws("a", "n", &refs)]);
    bad(vec![ws("a", "n", &["  "])]);
    bad(vec![ws("a", "n", &[&"p".repeat(4097)])]);
    bad(vec![ws("a", "n", &["/a\0b"])]);
    assert!(validate(&with_workspaces(vec![ws("a", &"n".repeat(64), &[])])).is_ok());
}

#[test]
fn workspaces_round_trip_through_save_and_load() {
    let d = tempfile::tempdir().unwrap();
    let s = with_workspaces(vec![ws("one", "One", &["/a", "/b"]), ws("two", "Two", &[])]);
    save(d.path(), &s).unwrap();
    assert_eq!(load(d.path()).workspaces, s.workspaces);
}
