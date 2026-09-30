use super::*;
use crate::git::fixtures::{self, TestRepo};

#[test]
fn ref_updates_map_oids() {
    let (_t, oids) = fixtures::linear(2);
    let planned = [
        PlannedUpdate::new("refs/heads/a", None, Some(oids[0])),
        PlannedUpdate::new("refs/heads/b", Some(oids[1]), None),
    ];
    let updates = ref_updates(&planned);
    assert_eq!(updates[0].from, None);
    assert_eq!(updates[0].to, Some(oids[0].to_string()));
    assert_eq!(updates[1].to, None);
}

#[test]
fn dropped_commits_when_branch_moves_back() {
    let (t, oids) = fixtures::linear(4);
    let planned = [PlannedUpdate::new(
        "refs/heads/main",
        Some(oids[3]),
        Some(oids[1]),
    )];
    let dropped = commits_dropped(&t.repo, &planned).unwrap();
    let ids: Vec<&str> = dropped.iter().map(|c| c.oid.as_str()).collect();
    assert_eq!(ids, vec![oids[3].to_string(), oids[2].to_string()]);
    assert_eq!(dropped[0].summary, "commit 3");
    assert_eq!(dropped[0].short_oid.len(), 7);
}

#[test]
fn commits_kept_alive_by_other_refs_are_not_dropped() {
    let (t, oids) = fixtures::linear(3);
    t.repo
        .reference("refs/tags/keep", oids[2], false, "")
        .unwrap();
    let planned = [PlannedUpdate::new(
        "refs/heads/main",
        Some(oids[2]),
        Some(oids[0]),
    )];
    assert!(commits_dropped(&t.repo, &planned).unwrap().is_empty());
}

#[test]
fn deleting_a_merged_branch_drops_nothing_and_unmerged_drops_its_commits() {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    let a = t.commit_all("A");
    t.checkout_branch("topic", a);
    let c = t.commit_on("topic", "t.txt", "t\n", "T1");
    let planned = [PlannedUpdate::new("refs/heads/topic", Some(c), None)];
    let dropped = commits_dropped(&t.repo, &planned).unwrap();
    assert_eq!(dropped.len(), 1);
    assert_eq!(dropped[0].summary, "T1");
    let planned = [PlannedUpdate::new("refs/heads/topic", Some(a), None)];
    assert!(commits_dropped(&t.repo, &planned).unwrap().is_empty());
}

#[test]
fn dropped_is_capped() {
    let (t, oids) = fixtures::linear(60);
    let planned = [PlannedUpdate::new(
        "refs/heads/main",
        Some(oids[59]),
        Some(oids[0]),
    )];
    assert_eq!(
        commits_dropped(&t.repo, &planned).unwrap().len(),
        DROPPED_CAP
    );
}

#[test]
fn detached_head_counts_as_a_ref() {
    let (t, oids) = fixtures::linear(3);
    t.repo.set_head_detached(oids[2]).unwrap();
    let planned = [PlannedUpdate::new(
        "refs/heads/main",
        Some(oids[2]),
        Some(oids[0]),
    )];
    assert!(commits_dropped(&t.repo, &planned).unwrap().is_empty());
}

#[test]
fn predicts_conflicts_without_touching_worktree() {
    let t = fixtures::conflicted_merge();
    t.repo.cleanup_state().unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    let ours = t.branch_tip("main");
    let theirs = t.branch_tip("other");
    let conflicts = predicted_conflicts(&t.repo, ours, theirs).unwrap();
    assert_eq!(conflicts, vec!["conflict.txt".to_string()]);
    assert_eq!(
        std::fs::read_to_string(t.root().join("conflict.txt")).unwrap(),
        "main side\n"
    );
}

#[test]
fn clean_merge_predicts_no_conflicts() {
    let m = fixtures::branch_merge();
    assert!(predicted_conflicts(&m.repo.repo, m.b, m.c)
        .unwrap()
        .is_empty());
}

#[test]
fn build_assembles_preview() {
    let (t, oids) = fixtures::linear(3);
    let planned = [PlannedUpdate::new(
        "refs/heads/main",
        Some(oids[2]),
        Some(oids[1]),
    )];
    let p = build(
        &t.repo,
        "Reset",
        &planned,
        0,
        vec!["detached HEAD".into()],
        Vec::new(),
    )
    .unwrap();
    assert_eq!(p.summary, "Reset");
    assert_eq!(p.commits_dropped.len(), 1);
    assert_eq!(p.warnings, vec!["detached HEAD".to_string()]);
}
