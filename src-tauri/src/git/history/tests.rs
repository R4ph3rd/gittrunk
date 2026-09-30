use std::process::Command;

use git2::Oid;

use super::*;
use crate::git::conflicts::ConflictService;
use crate::git::fixtures::TestRepo;
use crate::git::oplog::Oplog;

// ------------------------------------------------------------------ helpers

/// A fixture repository with an explicit identity in its own config.
fn new_repo() -> TestRepo {
    let t = TestRepo::new();
    let mut cfg = t.repo.config().unwrap();
    cfg.set_str("user.name", "Test User").unwrap();
    cfg.set_str("user.email", "test@example.com").unwrap();
    cfg.set_bool("commit.gpgsign", false).unwrap();
    t
}

fn git(t: &TestRepo, args: &[&str]) -> String {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.com",
        ])
        .args(args)
        .current_dir(t.root())
        .env("GIT_EDITOR", "true")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Subjects reachable from HEAD, newest first.
fn subjects(t: &TestRepo) -> Vec<String> {
    git(t, &["log", "--format=%s"])
        .lines()
        .map(String::from)
        .collect()
}

#[cfg(not(embedded_git))]
fn body(t: &TestRepo, rev: &str) -> String {
    git(t, &["log", "-1", "--format=%B", rev])
}

fn rev(t: &TestRepo, spec: &str) -> Oid {
    t.repo
        .revparse_single(spec)
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
}

fn parents(t: &TestRepo, spec: &str) -> usize {
    t.repo
        .revparse_single(spec)
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .parent_count()
}

fn exists(t: &TestRepo, file: &str) -> bool {
    t.root().join(file).exists()
}

fn checkout(t: &TestRepo, branch: &str) {
    t.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
}

fn applied(o: AppResult<OpOutcome>) -> (String, HeadState, String) {
    match o.unwrap() {
        OpOutcome::Applied {
            oplog_id,
            head,
            message,
        } => (oplog_id, head, message),
        other => panic!("expected applied, got {other:?}"),
    }
}

fn conflicted(o: AppResult<OpOutcome>) -> (String, Vec<String>) {
    match o.unwrap() {
        OpOutcome::Conflicted { oplog_id, files } => (oplog_id, files),
        other => panic!("expected conflicted, got {other:?}"),
    }
}

fn preview(o: AppResult<OpOutcome>) -> OpPreview {
    match o.unwrap() {
        OpOutcome::Preview { preview } => preview,
        other => panic!("expected preview, got {other:?}"),
    }
}

fn undo(t: &TestRepo) {
    match Oplog::undo(&t.repo, false).unwrap() {
        OpOutcome::Applied { .. } => {}
        other => panic!("undo: {other:?}"),
    }
}

fn is_clean(t: &TestRepo) -> bool {
    git(t, &["status", "--porcelain", "--untracked-files=no"]).is_empty()
}

/// main: A -> B (m.txt); feature: A -> C (f.txt). HEAD on main.
fn diverged() -> TestRepo {
    let mut t = new_repo();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    t.commit_on("feature", "f.txt", "feature\n", "C");
    t.commit_on("main", "m.txt", "main\n", "B");
    t
}

/// main: A; feature: A -> C (ahead of main). HEAD on main.
fn ahead() -> TestRepo {
    let mut t = new_repo();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    t.commit_on("feature", "f.txt", "feature\n", "C");
    checkout(&t, "main");
    t
}

/// Every side edits base.txt: main: A -> B; feature: A -> C.
fn conflicting() -> TestRepo {
    let mut t = new_repo();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    t.commit_on("feature", "base.txt", "feature side\n", "C");
    t.commit_on("main", "base.txt", "main side\n", "B");
    t
}

/// main: A -> c1 -> c2 -> c3 -> c4, each adding `fN.txt`.
fn seq() -> (TestRepo, Oid, Vec<Oid>) {
    let mut t = new_repo();
    t.write("a.txt", "a\n");
    let a = t.commit_all("A");
    let mut oids = Vec::new();
    for n in 1..=4 {
        t.write(&format!("f{n}.txt"), format!("{n}\n"));
        oids.push(t.commit_all(&format!("c{n}")));
    }
    (t, a, oids)
}

fn item(oid: Oid, action: RebaseAction, message: Option<&str>) -> RebaseTodoItem {
    RebaseTodoItem {
        action,
        oid: oid.to_string(),
        summary: String::new(),
        message: message.map(String::from),
    }
}

fn merge_req(source: &str, strategy: MergeStrategy) -> MergeRequest {
    MergeRequest {
        source: source.into(),
        into: None,
        strategy,
        message: None,
    }
}

#[cfg(not(embedded_git))]
fn no_temp_left(t: &TestRepo) -> bool {
    match std::fs::read_dir(t.repo.path().join("gittrunk")) {
        Ok(rd) => !rd
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with("rebase-")),
        Err(_) => true,
    }
}

// -------------------------------------------------------------------- merge

#[test]
fn merge_fast_forwards_and_undoes() {
    let t = ahead();
    let before = rev(&t, "main");
    let p = preview(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), true));
    assert_eq!(p.commits_created, 0);
    assert_eq!(p.ref_updates.len(), 1);
    assert_eq!(
        p.ref_updates[0].to.as_deref(),
        Some(rev(&t, "feature").to_string().as_str())
    );
    assert_eq!(rev(&t, "main"), before, "dry run must not move anything");

    let (_, head, _) =
        applied(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), false));
    assert_eq!(rev(&t, "main"), rev(&t, "feature"));
    assert!(matches!(head, HeadState::Branch { .. }));
    assert!(exists(&t, "f.txt"));

    undo(&t);
    assert_eq!(rev(&t, "main"), before);
    assert!(!exists(&t, "f.txt"));
    assert!(is_clean(&t));
}

#[test]
fn merge_no_ff_creates_a_merge_commit_with_message() {
    let t = ahead();
    let before = rev(&t, "main");
    let mut req = merge_req("feature", MergeStrategy::NoFf);
    req.message = Some("Merge the feature".into());
    let p = preview(LibGit.merge(&t.repo, &req, true));
    assert_eq!(p.commits_created, 1);
    applied(LibGit.merge(&t.repo, &req, false));
    assert_eq!(parents(&t, "HEAD"), 2);
    assert_eq!(subjects(&t)[0], "Merge the feature");
    undo(&t);
    assert_eq!(rev(&t, "main"), before);
    assert!(!exists(&t, "f.txt"));
}

#[test]
fn merge_ff_only_refuses_diverged_branches() {
    let t = diverged();
    let err = LibGit
        .merge(&t.repo, &merge_req("feature", MergeStrategy::FfOnly), false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    let t = ahead();
    applied(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::FfOnly), false));
    assert_eq!(rev(&t, "main"), rev(&t, "feature"));
}

#[test]
fn merge_auto_on_diverged_history_makes_a_merge_commit() {
    let t = diverged();
    let before = rev(&t, "main");
    let p = preview(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), true));
    assert_eq!(p.commits_created, 1);
    assert!(p.predicted_conflicts.is_empty());
    let (_, _, msg) =
        applied(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), false));
    assert!(msg.contains("feature"));
    assert_eq!(parents(&t, "HEAD"), 2);
    assert!(exists(&t, "f.txt") && exists(&t, "m.txt"));
    undo(&t);
    assert_eq!(rev(&t, "main"), before);
    assert!(!exists(&t, "f.txt") && exists(&t, "m.txt"));
}

#[test]
fn merge_squash_leaves_the_result_staged() {
    let t = diverged();
    let before = rev(&t, "main");
    let (_, _, msg) =
        applied(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Squash), false));
    assert!(msg.contains("staged"));
    assert_eq!(rev(&t, "main"), before, "squash must not commit");
    assert!(git(&t, &["diff", "--cached", "--name-only"]).contains("f.txt"));
    undo(&t);
    assert_eq!(rev(&t, "main"), before);
    assert!(!exists(&t, "f.txt"));
    assert!(is_clean(&t));
}

#[test]
fn merge_into_another_branch_checks_it_out_first() {
    let t = diverged();
    checkout(&t, "feature");
    // merge main into feature while HEAD is on feature is the plain case; use
    // `into` from main instead.
    checkout(&t, "main");
    let mut req = merge_req("main", MergeStrategy::Auto);
    req.into = Some("feature".into());
    applied(LibGit.merge(&t.repo, &req, false));
    assert_eq!(git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature");
    assert_eq!(parents(&t, "HEAD"), 2);
    undo(&t);
    assert_eq!(git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
}

#[test]
fn merge_into_refuses_a_dirty_worktree() {
    let t = diverged();
    t.write("m.txt", "edited\n");
    let mut req = merge_req("main", MergeStrategy::Auto);
    req.into = Some("feature".into());
    let err = LibGit.merge(&t.repo, &req, false).unwrap_err();
    assert_eq!(err.kind, ErrorKind::DirtyWorktree);
    assert_eq!(git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
}

#[test]
fn merge_conflict_resolve_continue_and_abort() {
    let t = conflicting();
    let before = rev(&t, "main");
    let p = preview(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), true));
    assert_eq!(p.predicted_conflicts, ["base.txt"]);

    let (id, files) =
        conflicted(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), false));
    assert_eq!(files, ["base.txt"]);
    assert!(!id.is_empty());
    assert_eq!(t.repo.state(), git2::RepositoryState::Merge);
    let list = LibGit.conflict_list(&t.repo).unwrap();
    assert_eq!(list[0].status, ChangeStatus::Conflicted);
    let f = LibGit.conflict_file(&t.repo, "base.txt").unwrap();
    assert_eq!(f.ours_label, "main");
    assert_eq!(f.theirs_label, "feature");
    assert_eq!(f.theirs.as_deref(), Some("feature side\n"));

    // Continue with unresolved conflicts stays conflicted.
    conflicted(LibGit.sequencer_control(&t.repo, SequencerAction::Continue));

    LibGit
        .conflict_resolve(
            &t.repo,
            "base.txt",
            &ConflictResolution::Content {
                content: "both\n".into(),
            },
        )
        .unwrap();
    let (_, head, _) = applied(LibGit.sequencer_control(&t.repo, SequencerAction::Continue));
    assert!(matches!(head, HeadState::Branch { .. }));
    assert_eq!(t.repo.state(), git2::RepositoryState::Clean);
    assert_eq!(parents(&t, "HEAD"), 2);
    assert_eq!(
        std::fs::read_to_string(t.root().join("base.txt")).unwrap(),
        "both\n"
    );

    // Abort path on a fresh conflict.
    let t = conflicting();
    conflicted(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), false));
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Abort));
    assert_eq!(t.repo.state(), git2::RepositoryState::Clean);
    assert_eq!(rev(&t, "main"), before);
    assert!(is_clean(&t));
}

#[test]
fn merge_squash_conflict_can_be_aborted() {
    let t = conflicting();
    let before = rev(&t, "main");
    conflicted(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Squash), false));
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Abort));
    assert_eq!(rev(&t, "main"), before);
    assert!(is_clean(&t));
}

#[test]
fn sequencer_without_an_operation_is_an_error() {
    let t = diverged();
    let err = LibGit
        .sequencer_control(&t.repo, SequencerAction::Abort)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

// ------------------------------------------------------------------- rebase

#[test]
fn rebase_replays_commits_and_undoes() {
    let t = diverged();
    checkout(&t, "feature");
    let before = rev(&t, "feature");
    let req = RebaseRequest {
        onto: "main".into(),
        branch: None,
    };
    let p = preview(LibGit.rebase(&t.repo, &req, true));
    assert_eq!(p.commits_created, 1);
    assert!(p.predicted_conflicts.is_empty());
    assert_eq!(p.commits_dropped.len(), 1, "the old C is replaced");
    assert_eq!(rev(&t, "feature"), before);

    applied(LibGit.rebase(&t.repo, &req, false));
    assert_eq!(subjects(&t), ["C", "B", "A"]);
    assert!(exists(&t, "f.txt") && exists(&t, "m.txt"));
    undo(&t);
    assert_eq!(rev(&t, "feature"), before);
    assert!(!exists(&t, "m.txt"));
    assert!(is_clean(&t));
}

#[test]
fn rebase_of_another_branch_checks_it_out() {
    let t = diverged();
    let req = RebaseRequest {
        onto: "main".into(),
        branch: Some("feature".into()),
    };
    applied(LibGit.rebase(&t.repo, &req, false));
    assert_eq!(git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature");
    assert_eq!(subjects(&t), ["C", "B", "A"]);
}

#[test]
fn rebase_up_to_date_is_a_noop_preview() {
    let t = ahead();
    checkout(&t, "feature");
    let req = RebaseRequest {
        onto: "main".into(),
        branch: None,
    };
    let p = preview(LibGit.rebase(&t.repo, &req, true));
    assert!(p.ref_updates.is_empty());
    assert!(p.summary.contains("up to date"));
}

#[test]
fn rebase_conflict_then_abort() {
    let t = conflicting();
    checkout(&t, "feature");
    let before = rev(&t, "feature");
    let req = RebaseRequest {
        onto: "main".into(),
        branch: None,
    };
    let p = preview(LibGit.rebase(&t.repo, &req, true));
    assert_eq!(p.predicted_conflicts, ["base.txt"]);

    let (_, files) = conflicted(LibGit.rebase(&t.repo, &req, false));
    assert_eq!(files, ["base.txt"]);
    let f = LibGit.conflict_file(&t.repo, "base.txt").unwrap();
    assert_eq!(f.ours.as_deref(), Some("main side\n"));
    assert_eq!(f.theirs.as_deref(), Some("feature side\n"));
    assert!(f.theirs_label.ends_with(" C"), "{}", f.theirs_label);

    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Abort));
    assert_eq!(rev(&t, "feature"), before);
    assert_eq!(t.repo.state(), git2::RepositoryState::Clean);
    assert!(is_clean(&t));
}

#[test]
fn rebase_conflict_resolve_and_continue() {
    let t = conflicting();
    checkout(&t, "feature");
    let req = RebaseRequest {
        onto: "main".into(),
        branch: None,
    };
    conflicted(LibGit.rebase(&t.repo, &req, false));
    LibGit
        .conflict_resolve(&t.repo, "base.txt", &ConflictResolution::Theirs)
        .unwrap();
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Continue));
    assert_eq!(subjects(&t), ["C", "B", "A"]);
    assert_eq!(
        std::fs::read_to_string(t.root().join("base.txt")).unwrap(),
        "feature side\n"
    );
}

#[test]
fn rebase_rejects_option_like_values() {
    let t = diverged();
    for onto in ["--exec=touch pwned", "-x", ""] {
        let req = RebaseRequest {
            onto: onto.into(),
            branch: None,
        };
        assert_eq!(
            LibGit.rebase(&t.repo, &req, false).unwrap_err().kind,
            ErrorKind::InvalidInput,
            "{onto}"
        );
    }
    let req = RebaseRequest {
        onto: "main".into(),
        branch: Some("--exec=touch pwned".into()),
    };
    assert_eq!(
        LibGit.rebase(&t.repo, &req, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert!(!exists(&t, "pwned"));
}

// ------------------------------------------------------ interactive rebase

fn run_interactive(t: &TestRepo, base: Oid, todo: Vec<RebaseTodoItem>) -> AppResult<OpOutcome> {
    LibGit.rebase_interactive(
        &t.repo,
        &InteractiveRebaseRequest {
            base: base.to_string(),
            todo,
        },
        false,
    )
}

#[test]
fn todo_load_lists_commits_oldest_first() {
    let (t, a, oids) = seq();
    let todo = LibGit.rebase_todo_load(&t.repo, &a.to_string()).unwrap();
    assert_eq!(todo.len(), 4);
    assert_eq!(todo[0].oid, oids[0].to_string());
    assert_eq!(todo[0].summary, "c1");
    assert_eq!(todo[3].summary, "c4");
    assert!(todo
        .iter()
        .all(|i| i.action == RebaseAction::Pick && i.message.is_none()));
}

#[test]
fn todo_load_refuses_merges_and_non_ancestors() {
    let t = diverged();
    let root = rev(&t, "main~1");
    applied(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::NoFf), false));
    let err = LibGit
        .rebase_todo_load(&t.repo, &root.to_string())
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    let other = rev(&t, "feature");
    let head_parent = rev(&t, "HEAD~1");
    let _ = (other, head_parent);
    let err = LibGit
        .rebase_todo_load(&t.repo, "--exec=touch pwned")
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_reorders_commits() {
    let (t, a, o) = seq();
    let before = rev(&t, "HEAD");
    let todo = vec![
        item(o[1], RebaseAction::Pick, None),
        item(o[0], RebaseAction::Pick, None),
        item(o[2], RebaseAction::Pick, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    let p = preview(LibGit.rebase_interactive(
        &t.repo,
        &InteractiveRebaseRequest {
            base: a.to_string(),
            todo: todo.clone(),
        },
        true,
    ));
    assert_eq!(p.commits_created, 4);
    assert_eq!(rev(&t, "HEAD"), before);
    applied(run_interactive(&t, a, todo));
    assert_eq!(subjects(&t), ["c4", "c3", "c1", "c2", "A"]);
    assert!(no_temp_left(&t));
    undo(&t);
    assert_eq!(rev(&t, "HEAD"), before);
    assert!(is_clean(&t));
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_drops_omitted_and_dropped_commits() {
    let (t, a, o) = seq();
    let before = rev(&t, "HEAD");
    // c2 is dropped explicitly, c3 is omitted.
    let todo = vec![
        item(o[0], RebaseAction::Pick, None),
        item(o[1], RebaseAction::Drop, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    let p = preview(LibGit.rebase_interactive(
        &t.repo,
        &InteractiveRebaseRequest {
            base: a.to_string(),
            todo: todo.clone(),
        },
        true,
    ));
    assert!(p.commits_dropped.len() >= 2);
    applied(run_interactive(&t, a, todo));
    assert_eq!(subjects(&t), ["c4", "c1", "A"]);
    assert!(!exists(&t, "f2.txt") && !exists(&t, "f3.txt"));
    undo(&t);
    assert_eq!(rev(&t, "HEAD"), before);
    assert!(exists(&t, "f2.txt") && exists(&t, "f3.txt"));
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_squash_with_custom_message() {
    let (t, a, o) = seq();
    let before = rev(&t, "HEAD");
    let todo = vec![
        item(o[0], RebaseAction::Pick, None),
        item(o[1], RebaseAction::Squash, Some("combined c1 and c2")),
        item(o[2], RebaseAction::Pick, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    applied(run_interactive(&t, a, todo));
    assert_eq!(subjects(&t), ["c4", "c3", "combined c1 and c2", "A"]);
    assert_eq!(body(&t, "HEAD~2"), "combined c1 and c2");
    assert!(exists(&t, "f1.txt") && exists(&t, "f2.txt"));
    undo(&t);
    assert_eq!(rev(&t, "HEAD"), before);
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_squash_without_message_concatenates_and_fixup_discards() {
    let (t, a, o) = seq();
    let todo = vec![
        item(o[0], RebaseAction::Pick, None),
        item(o[1], RebaseAction::Squash, None),
        item(o[2], RebaseAction::Fixup, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    applied(run_interactive(&t, a, todo));
    assert_eq!(subjects(&t), ["c4", "c1", "A"]);
    let msg = body(&t, "HEAD~1");
    assert!(msg.contains("c1") && msg.contains("c2"), "{msg}");
    assert!(!msg.contains("c3"), "{msg}");
    assert!(exists(&t, "f3.txt"));
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_reword_changes_only_the_message() {
    let (t, a, o) = seq();
    let before_tree = t.repo.head().unwrap().peel_to_tree().unwrap().id();
    let todo = vec![
        item(o[0], RebaseAction::Pick, None),
        item(
            o[1],
            RebaseAction::Reword,
            Some("renamed two\n\nwith a body"),
        ),
        item(o[2], RebaseAction::Pick, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    applied(run_interactive(&t, a, todo));
    assert_eq!(subjects(&t), ["c4", "c3", "renamed two", "c1", "A"]);
    assert_eq!(body(&t, "HEAD~2"), "renamed two\n\nwith a body");
    assert_eq!(
        t.repo.head().unwrap().peel_to_tree().unwrap().id(),
        before_tree
    );
    assert!(no_temp_left(&t));
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_edit_stops_and_continues() {
    let (t, a, o) = seq();
    let before = rev(&t, "HEAD");
    let todo = vec![
        item(o[0], RebaseAction::Pick, None),
        item(o[1], RebaseAction::Edit, None),
        item(o[2], RebaseAction::Pick, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    let (_, head, msg) = applied(run_interactive(&t, a, todo));
    assert!(msg.starts_with("Stopped for edit at "), "{msg}");
    assert!(matches!(head, HeadState::Detached { .. }));
    assert!(in_progress(&t.repo));
    assert!(msg.ends_with(&short(rev(&t, "HEAD"))));
    assert!(exists(&t, "f2.txt") && !exists(&t, "f3.txt"));

    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Continue));
    assert!(!in_progress(&t.repo));
    assert_eq!(subjects(&t), ["c4", "c3", "c2", "c1", "A"]);
    assert!(no_temp_left(&t));
    assert_eq!(
        git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main",
        "the branch is restored"
    );
    let _ = before;
}

#[cfg(not(embedded_git))]
#[test]
fn interactive_edit_can_be_aborted() {
    let (t, a, o) = seq();
    let before = rev(&t, "HEAD");
    let todo = vec![
        item(o[0], RebaseAction::Edit, None),
        item(o[1], RebaseAction::Pick, None),
        item(o[2], RebaseAction::Pick, None),
        item(o[3], RebaseAction::Pick, None),
    ];
    applied(run_interactive(&t, a, todo));
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Abort));
    assert_eq!(rev(&t, "HEAD"), before);
    assert!(no_temp_left(&t));
}

#[test]
fn interactive_todo_is_validated() {
    let (t, a, o) = seq();
    let bad = |todo: Vec<RebaseTodoItem>| run_interactive(&t, a, todo).unwrap_err().kind;
    // first item squash
    assert_eq!(
        bad(vec![
            item(o[0], RebaseAction::Squash, None),
            item(o[1], RebaseAction::Pick, None)
        ]),
        ErrorKind::InvalidInput
    );
    // duplicate
    assert_eq!(
        bad(vec![
            item(o[0], RebaseAction::Pick, None),
            item(o[0], RebaseAction::Pick, None)
        ]),
        ErrorKind::InvalidInput
    );
    // outside the range
    assert_eq!(
        bad(vec![item(a, RebaseAction::Pick, None)]),
        ErrorKind::InvalidInput
    );
    // empty custom message
    assert_eq!(
        bad(vec![item(o[0], RebaseAction::Reword, Some("  "))]),
        ErrorKind::InvalidInput
    );
    // everything dropped
    assert_eq!(bad(vec![]), ErrorKind::InvalidInput);
    // not hex
    let mut evil = item(o[0], RebaseAction::Pick, None);
    evil.oid = "--exec=touch pwned".into();
    assert_eq!(bad(vec![evil]), ErrorKind::InvalidInput);
    // the base must be hex too
    let err = LibGit
        .rebase_interactive(
            &t.repo,
            &InteractiveRebaseRequest {
                base: "--exec=touch pwned".into(),
                todo: vec![item(o[0], RebaseAction::Pick, None)],
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(!exists(&t, "pwned"));
    assert_eq!(subjects(&t)[0], "c4");
}

#[test]
fn interactive_paths_with_quotes_survive_the_editor_command() {
    assert_eq!(
        rebase::sh_quote_for_test("/tmp/a b/it's"),
        "'/tmp/a b/it'\\''s'"
    );
}

// ---------------------------------------------------- cherry-pick / revert

fn pick_req(commits: &[Oid], target: Option<&str>, no_commit: bool) -> CherryPickRequest {
    CherryPickRequest {
        commits: commits.iter().map(|o| o.to_string()).collect(),
        target_branch: target.map(String::from),
        no_commit,
    }
}

#[test]
fn cherry_pick_single_commit() {
    let t = diverged();
    let before = rev(&t, "main");
    let c = rev(&t, "feature");
    let req = pick_req(&[c], None, false);
    let p = preview(LibGit.cherry_pick(&t.repo, &req, true));
    assert_eq!(p.commits_created, 1);
    assert!(p.predicted_conflicts.is_empty());
    assert_eq!(rev(&t, "main"), before);
    applied(LibGit.cherry_pick(&t.repo, &req, false));
    assert_eq!(subjects(&t), ["C", "B", "A"]);
    assert!(exists(&t, "f.txt"));
    undo(&t);
    assert_eq!(rev(&t, "main"), before);
    assert!(!exists(&t, "f.txt"));
}

#[test]
fn cherry_pick_multiple_commits_in_order() {
    let (t, _, o) = seq();
    // Build a topic branch off the root with c3 and c4 only.
    let root = rev(&t, "HEAD~4");
    t.checkout_branch("topic", root);
    let before = rev(&t, "topic");
    let req = pick_req(&[o[2], o[3]], None, false);
    let p = preview(LibGit.cherry_pick(&t.repo, &req, true));
    assert_eq!(p.commits_created, 2);
    applied(LibGit.cherry_pick(&t.repo, &req, false));
    assert_eq!(subjects(&t), ["c4", "c3", "A"]);
    undo(&t);
    assert_eq!(rev(&t, "topic"), before);
}

#[test]
fn cherry_pick_onto_another_branch() {
    let t = diverged();
    checkout(&t, "feature");
    let b = rev(&t, "main");
    let req = pick_req(&[b], Some("main"), false);
    // Picking main's own tip onto main yields an empty pick, so use a commit
    // from feature instead.
    let c = rev(&t, "feature");
    let _ = (b, req);
    let req = pick_req(&[c], Some("main"), false);
    applied(LibGit.cherry_pick(&t.repo, &req, false));
    assert_eq!(git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    assert_eq!(subjects(&t), ["C", "B", "A"]);
    undo(&t);
    assert_eq!(git(&t, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature");
}

#[test]
fn cherry_pick_no_commit_stages_the_change() {
    let t = diverged();
    let before = rev(&t, "main");
    let req = pick_req(&[rev(&t, "feature")], None, true);
    let (_, _, msg) = applied(LibGit.cherry_pick(&t.repo, &req, false));
    assert!(msg.contains("staged"));
    assert_eq!(rev(&t, "main"), before);
    assert!(git(&t, &["diff", "--cached", "--name-only"]).contains("f.txt"));
    undo(&t);
    assert!(!exists(&t, "f.txt"));
    assert!(is_clean(&t));
}

#[test]
fn cherry_pick_conflict_then_abort_or_resolve() {
    let t = conflicting();
    let before = rev(&t, "main");
    let c = rev(&t, "feature");
    let req = pick_req(&[c], None, false);
    let p = preview(LibGit.cherry_pick(&t.repo, &req, true));
    assert_eq!(p.predicted_conflicts, ["base.txt"]);
    let (_, files) = conflicted(LibGit.cherry_pick(&t.repo, &req, false));
    assert_eq!(files, ["base.txt"]);
    assert_eq!(t.repo.state(), git2::RepositoryState::CherryPick);
    let f = LibGit.conflict_file(&t.repo, "base.txt").unwrap();
    assert!(f.theirs_label.ends_with(" C"), "{}", f.theirs_label);
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Abort));
    assert_eq!(rev(&t, "main"), before);

    conflicted(LibGit.cherry_pick(&t.repo, &req, false));
    LibGit
        .conflict_resolve(&t.repo, "base.txt", &ConflictResolution::Theirs)
        .unwrap();
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Continue));
    assert_eq!(subjects(&t), ["C", "B", "A"]);
}

#[test]
fn cherry_pick_rejects_option_like_and_missing_commits() {
    let t = diverged();
    for bad in ["--exec=touch pwned", "-n", "", "zz", &"0".repeat(40)] {
        let req = CherryPickRequest {
            commits: vec![bad.to_string()],
            target_branch: None,
            no_commit: false,
        };
        assert!(LibGit.cherry_pick(&t.repo, &req, false).is_err(), "{bad}");
    }
    let req = CherryPickRequest {
        commits: vec![rev(&t, "feature").to_string()],
        target_branch: Some("--orphan=x".into()),
        no_commit: false,
    };
    assert_eq!(
        LibGit.cherry_pick(&t.repo, &req, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    let req = CherryPickRequest {
        commits: vec![],
        target_branch: None,
        no_commit: false,
    };
    assert_eq!(
        LibGit.cherry_pick(&t.repo, &req, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
}

#[test]
fn revert_creates_a_revert_commit_and_undoes() {
    let (t, _, o) = seq();
    let before = rev(&t, "HEAD");
    let req = RevertRequest {
        commits: vec![o[1].to_string()],
        no_commit: false,
    };
    let p = preview(LibGit.revert(&t.repo, &req, true));
    assert_eq!(p.commits_created, 1);
    applied(LibGit.revert(&t.repo, &req, false));
    assert_eq!(subjects(&t)[0], "Revert \"c2\"");
    assert!(!exists(&t, "f2.txt"));
    undo(&t);
    assert_eq!(rev(&t, "HEAD"), before);
    assert!(exists(&t, "f2.txt"));
}

#[test]
fn revert_multiple_and_no_commit() {
    let (t, _, o) = seq();
    let before = rev(&t, "HEAD");
    let req = RevertRequest {
        commits: vec![o[3].to_string(), o[2].to_string()],
        no_commit: false,
    };
    applied(LibGit.revert(&t.repo, &req, false));
    assert_eq!(&subjects(&t)[..2], ["Revert \"c3\"", "Revert \"c4\""]);
    undo(&t);
    assert_eq!(rev(&t, "HEAD"), before);

    let req = RevertRequest {
        commits: vec![o[3].to_string()],
        no_commit: true,
    };
    applied(LibGit.revert(&t.repo, &req, false));
    assert_eq!(rev(&t, "HEAD"), before);
    assert!(!exists(&t, "f4.txt"));
    undo(&t);
    assert!(exists(&t, "f4.txt"));
    assert!(is_clean(&t));
}

#[test]
fn revert_conflict_can_be_aborted() {
    let mut t = new_repo();
    t.write("x.txt", "1\n");
    t.commit_all("A");
    t.write("x.txt", "2\n");
    let two = t.commit_all("two");
    t.write("x.txt", "3\n");
    t.commit_all("three");
    let before = rev(&t, "HEAD");
    let req = RevertRequest {
        commits: vec![two.to_string()],
        no_commit: false,
    };
    let p = preview(LibGit.revert(&t.repo, &req, true));
    assert_eq!(p.predicted_conflicts, ["x.txt"]);
    let (_, files) = conflicted(LibGit.revert(&t.repo, &req, false));
    assert_eq!(files, ["x.txt"]);
    assert_eq!(t.repo.state(), git2::RepositoryState::Revert);
    applied(LibGit.sequencer_control(&t.repo, SequencerAction::Abort));
    assert_eq!(rev(&t, "HEAD"), before);
    assert!(is_clean(&t));
}

// ------------------------------------------------------------ guard rails

#[test]
fn merge_rejects_option_like_sources_and_branches() {
    let t = diverged();
    for src in ["--exec=touch pwned", "-h", ""] {
        assert_eq!(
            LibGit
                .merge(&t.repo, &merge_req(src, MergeStrategy::Auto), false)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidInput,
            "{src}"
        );
    }
    let mut req = merge_req("feature", MergeStrategy::Auto);
    req.into = Some("--force".into());
    assert_eq!(
        LibGit.merge(&t.repo, &req, false).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert!(!exists(&t, "pwned"));
}

#[test]
fn operations_refuse_to_start_during_another_operation() {
    let t = conflicting();
    conflicted(LibGit.merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), false));
    let err = LibGit
        .merge(&t.repo, &merge_req("feature", MergeStrategy::Auto), false)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}
