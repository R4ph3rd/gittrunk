use std::fs;
use std::path::Path;

use super::*;
use crate::git::fixtures::TestRepo;
use crate::git::libgit::LibGit;
use crate::git::staging::StagingService;

fn base() -> TestRepo {
    let mut t = TestRepo::new();
    t.write("src/a.txt", "a\n");
    t.write("src/deep/b.log", "b\n");
    t.write("keep.txt", "k\n");
    t.commit_all("base");
    t
}

fn pats(p: &[&str]) -> Vec<String> {
    p.iter().map(|s| s.to_string()).collect()
}

fn ignore(t: &TestRepo, p: &[&str], target: IgnoreTarget) -> IgnoreAddResult {
    ignore_add(&t.repo, &pats(p), target, false).unwrap()
}

#[test]
fn ignore_creates_the_file_and_appends_with_newline() {
    let t = base();
    let r = ignore(&t, &["/build/"], IgnoreTarget::Gitignore);
    assert_eq!(r.file, ".gitignore");
    assert_eq!(r.added, ["/build/"]);
    assert_eq!(
        fs::read_to_string(t.root().join(".gitignore")).unwrap(),
        "/build/\n"
    );

    // A file without a trailing newline gets one before the append.
    t.write(".gitignore", "target");
    ignore(&t, &["*.log"], IgnoreTarget::Gitignore);
    assert_eq!(
        fs::read_to_string(t.root().join(".gitignore")).unwrap(),
        "target\n*.log\n"
    );
}

#[test]
fn ignore_skips_duplicates() {
    let t = base();
    ignore(&t, &["*.log"], IgnoreTarget::Gitignore);
    let again = ignore(&t, &["*.log", "/x.txt", "/x.txt"], IgnoreTarget::Gitignore);
    assert_eq!(again.added, ["/x.txt"]);
    assert_eq!(again.already_present, ["*.log"]);
    assert_eq!(
        fs::read_to_string(t.root().join(".gitignore")).unwrap(),
        "*.log\n/x.txt\n"
    );
    let none = ignore(&t, &["*.log"], IgnoreTarget::Gitignore);
    assert!(none.added.is_empty());
}

#[test]
fn ignore_keeps_crlf_line_endings() {
    let t = base();
    t.write(".gitignore", "a\r\nb\r\n");
    ignore(&t, &["c"], IgnoreTarget::Gitignore);
    assert_eq!(
        fs::read(t.root().join(".gitignore")).unwrap(),
        b"a\r\nb\r\nc\r\n"
    );
    // Duplicate detection tolerates the CR.
    assert!(ignore(&t, &["b"], IgnoreTarget::Gitignore).added.is_empty());
}

#[test]
fn ignore_dry_run_writes_nothing_and_exclude_goes_to_info() {
    let t = base();
    let r = ignore_add(&t.repo, &pats(&["/x"]), IgnoreTarget::Gitignore, true).unwrap();
    assert_eq!(r.added, ["/x"]);
    assert!(!t.root().join(".gitignore").exists());

    let r = ignore(&t, &["/x"], IgnoreTarget::Exclude);
    assert_eq!(r.file, ".git/info/exclude");
    let exclude = fs::read_to_string(t.root().join(".git/info/exclude")).unwrap();
    assert!(exclude.ends_with("/x\n"));
    assert!(!t.root().join(".gitignore").exists());
}

#[test]
fn ignore_rejects_bad_patterns() {
    let t = base();
    for bad in ["", "  ", "a\nb", "#c", "a\0b"] {
        let err = ignore_add(&t.repo, &pats(&[bad]), IgnoreTarget::Gitignore, false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{bad:?}");
    }
    assert!(ignore_add(&t.repo, &[], IgnoreTarget::Gitignore, false).is_err());
}

#[test]
fn ignored_untracked_files_disappear_from_the_status() {
    let t = base();
    t.write("new.log", "x\n");
    let has = |name: &str| {
        let st = crate::git::service::GitService::status(&LibGit, &t.repo).unwrap();
        st.unstaged.iter().any(|f| f.path == name)
    };
    assert!(has("new.log"));
    let r = ignore(&t, &["*.log"], IgnoreTarget::Gitignore);
    // The tracked src/deep/b.log is matched too.
    assert_eq!(r.tracked, ["src/deep/b.log"]);
    assert!(!has("new.log"));
}

#[test]
fn tracked_detection_covers_files_folders_and_skips_old_rules() {
    let t = base();
    let r = ignore_add(&t.repo, &pats(&["/src/"]), IgnoreTarget::Gitignore, true).unwrap();
    assert_eq!(r.tracked, ["src/a.txt", "src/deep/b.log"]);
    let r = ignore_add(
        &t.repo,
        &pats(&["/keep.txt"]),
        IgnoreTarget::Gitignore,
        true,
    )
    .unwrap();
    assert_eq!(r.tracked, ["keep.txt"]);
    let r = ignore_add(&t.repo, &pats(&["/nothing"]), IgnoreTarget::Gitignore, true).unwrap();
    assert!(r.tracked.is_empty());

    // Files an existing rule already ignores are not reported again.
    t.write(".gitignore", "*.txt\n");
    let r = ignore_add(
        &t.repo,
        &pats(&["/keep.txt"]),
        IgnoreTarget::Gitignore,
        true,
    )
    .unwrap();
    assert!(r.tracked.is_empty());
}

fn indexed(t: &TestRepo, path: &str) -> bool {
    let mut index = t.repo.index().unwrap();
    index.read(true).unwrap();
    index.get_path(Path::new(path), 0).is_some()
}

#[test]
fn untrack_file_and_folder_keep_the_working_tree() {
    let t = base();
    let all = ["keep.txt".to_string()];
    let OpOutcome::Preview { preview } = untrack_paths(&t.repo, &all, true).unwrap() else {
        panic!("expected preview");
    };
    assert!(preview.summary.contains("1 file"));
    assert!(indexed(&t, "keep.txt"));

    untrack_paths(&t.repo, &all, false).unwrap();
    assert!(!indexed(&t, "keep.txt"));
    assert!(t.root().join("keep.txt").exists());

    let out = untrack_paths(&t.repo, &["src".to_string()], false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert!(!indexed(&t, "src/a.txt") && !indexed(&t, "src/deep/b.log"));
    assert!(t.root().join("src/deep/b.log").exists());
}

#[test]
fn untrack_rejects_untracked_and_escaping_paths() {
    let t = base();
    t.write("loose.txt", "x");
    for bad in ["loose.txt", "../x", "/abs", "a/../b", ".git/config", "C:/x"] {
        let err = untrack_paths(&t.repo, &[bad.to_string()], false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{bad}");
    }
}

#[test]
fn discard_folder_without_untracked_keeps_them() {
    let t = base();
    t.write("src/a.txt", "changed\n");
    t.write("src/new.txt", "new\n");
    let tracked_only = ["src/a.txt".to_string()];
    LibGit.discard_paths(&t.repo, &tracked_only, false).unwrap();
    assert_eq!(
        fs::read_to_string(t.root().join("src/a.txt")).unwrap(),
        "a\n"
    );
    assert!(t.root().join("src/new.txt").exists());

    // Opting in deletes the untracked file as well.
    t.write("src/a.txt", "changed\n");
    let both = ["src/a.txt".to_string(), "src/new.txt".to_string()];
    LibGit.discard_paths(&t.repo, &both, false).unwrap();
    assert!(!t.root().join("src/new.txt").exists());
    assert_eq!(
        fs::read_to_string(t.root().join("src/a.txt")).unwrap(),
        "a\n"
    );
}

#[test]
fn patch_applies_to_a_clean_copy() {
    let t = base();
    t.write("src/a.txt", "a\nmore\n");
    t.write("src/new.txt", "new\n");
    t.write("keep.txt", "elsewhere\n");
    let patch = diff_patch(&t.repo, &["src".to_string()], false).unwrap();
    let text = String::from_utf8(patch.clone()).unwrap();
    assert!(text.contains("+more") && text.contains("src/new.txt"));
    assert!(!text.contains("keep.txt"));
    assert_applies(&t, &patch);

    // Staged side: only what was staged shows up.
    assert!(diff_patch(&t.repo, &["src".to_string()], true)
        .unwrap()
        .is_empty());
    LibGit.stage_paths(&t.repo, &["src/a.txt".into()]).unwrap();
    let staged = diff_patch(&t.repo, &["src".to_string()], true).unwrap();
    assert!(String::from_utf8_lossy(&staged).contains("+more"));
    assert_applies(&t, &staged);
}

/// `git apply --check` on a pristine checkout of HEAD.
fn assert_applies(t: &TestRepo, patch: &[u8]) {
    let clean = tempfile::tempdir().unwrap();
    let head = t.repo.head().unwrap().peel_to_commit().unwrap();
    let tree = head.tree().unwrap();
    tree.walk(git2::TreeWalkMode::PreOrder, |root, e| {
        if e.kind() == Some(git2::ObjectType::Blob) {
            let dest = clean.path().join(format!("{root}{}", e.name().unwrap()));
            fs::create_dir_all(dest.parent().unwrap()).unwrap();
            fs::write(dest, t.repo.find_blob(e.id()).unwrap().content()).unwrap();
        }
        git2::TreeWalkResult::Ok
    })
    .unwrap();
    let file = clean.path().join("x.patch");
    fs::write(&file, patch).unwrap();
    let out = std::process::Command::new("git")
        .args(["-c", "core.autocrlf=false", "apply", "--check", "x.patch"])
        .current_dir(clean.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git apply: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn patch_covers_binary_files_and_saves_to_disk() {
    let t = base();
    t.write("bin.dat", [0u8, 1, 2, 3, 255, 0, 7]);
    let patch = diff_patch(&t.repo, &["bin.dat".to_string()], false).unwrap();
    assert!(String::from_utf8_lossy(&patch).contains("GIT binary patch"));

    let dest = t.root().join("out.patch");
    let n = diff_patch_save(
        &t.repo,
        &["bin.dat".to_string()],
        false,
        dest.to_str().unwrap(),
    )
    .unwrap();
    assert_eq!(fs::read(&dest).unwrap().len(), n as usize);
    assert!(diff_patch_save(&t.repo, &["keep.txt".to_string()], false, "x.patch").is_err());
}

#[test]
fn patch_rejects_escaping_paths() {
    let t = base();
    for bad in ["../x", "/abs", "a/../b", ".git/HEAD", ""] {
        let err = diff_patch(&t.repo, &[bad.to_string()], false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{bad:?}");
    }
    assert!(diff_patch(&t.repo, &[], false).is_err());
}

#[test]
fn difftool_requires_a_configured_tool_and_a_valid_path() {
    let t = base();
    let cli = GitCli::new();
    // The sandbox may carry a global diff.tool; pin the local value away.
    let err = difftool_open(&t.repo, &cli, "../x", false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);

    let mut cfg = t.repo.config().unwrap();
    cfg.set_str("diff.tool", "").unwrap();
    cfg.set_str("merge.tool", "").unwrap();
    let err = difftool_open(&t.repo, &cli, "keep.txt", false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(err.message.contains("diff.tool"));
}

#[cfg(not(embedded_git))]
#[test]
fn difftool_launches_the_configured_tool() {
    let t = base();
    t.write("keep.txt", "edited\n");
    let mut cfg = t.repo.config().unwrap();
    cfg.set_str("diff.tool", "marker").unwrap();
    cfg.set_str("difftool.marker.cmd", "echo ran > difftool-ran.marker")
        .unwrap();
    difftool_open(&t.repo, &GitCli::new(), "keep.txt", false).unwrap();
    let marker = t.root().join("difftool-ran.marker");
    for _ in 0..100 {
        if marker.exists() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    panic!("the difftool never ran");
}

#[cfg(embedded_git)]
#[test]
fn difftool_is_unsupported_when_embedded() {
    let t = base();
    let mut cfg = t.repo.config().unwrap();
    cfg.set_str("diff.tool", "marker").unwrap();
    let err = difftool_open(&t.repo, &GitCli::new(), "keep.txt", false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Unsupported);
}

#[cfg(not(embedded_git))]
#[test]
fn spawn_detached_reports_early_failures() {
    let t = base();
    let err = GitCli::new()
        .spawn_detached(&t.root(), &["no-such-subcommand-xyz"])
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
}
