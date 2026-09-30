use super::*;
use crate::git::fixtures::TestRepo;
use serde_json::json;

fn step(desc: &str, command: Value) -> Value {
    json!({"description": desc, "command": command})
}

fn plan_json(steps: Vec<Value>) -> String {
    json!({"explanation": "because", "steps": steps}).to_string()
}

fn create_cmd(name: &str, start: Option<&str>, checkout: bool) -> Value {
    json!({"kind":"branchCreate","request":{"name":name,"startPoint":start,"checkout":checkout}})
}

fn checkout_cmd(name: &str) -> Value {
    json!({"kind":"checkout","target":{"kind":"branch","name":name}})
}

fn merge_cmd(source: &str) -> Value {
    json!({"kind":"merge","request":{"source":source,"into":null,"strategy":"auto","message":null}})
}

fn no_network() -> AppResult<NetSession> {
    Err(invalid("no network in tests"))
}

/// main: A ; feature: A - C (a fast-forward of main).
fn ff_repo() -> (TestRepo, git2::Oid) {
    let mut t = TestRepo::new();
    t.write("a.txt", "a\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    let c = t.commit_on("feature", "f.txt", "f\n", "C");
    t.checkout_branch("main", a);
    (t, c)
}

#[test]
fn parses_a_valid_plan_and_fences() {
    let text = plan_json(vec![
        step("make it", create_cmd("topic", None, true)),
        step("merge", merge_cmd("feature")),
    ]);
    let p = parse(&text).unwrap();
    assert_eq!(p.steps.len(), 2);
    assert_eq!(p.explanation, "because");
    assert!(matches!(
        &p.steps[0].command,
        PlannedCommand::BranchCreate { request } if request.name == "topic" && request.checkout
    ));
    let fenced = format!("```json\n{text}\n```");
    assert_eq!(parse(&fenced).unwrap().steps.len(), 2);
}

#[test]
fn rejects_unknown_kinds_and_extra_fields() {
    let unknown = plan_json(vec![step(
        "x",
        json!({"kind":"shell","command":"rm -rf /"}),
    )]);
    assert_eq!(parse(&unknown).unwrap_err().kind, ErrorKind::AiProvider);

    let nested = plan_json(vec![step(
        "x",
        json!({"kind":"reset","request":{"target":"HEAD","mode":"soft","extra":1}}),
    )]);
    assert!(parse(&nested)
        .unwrap_err()
        .message
        .contains("unknown fields"));

    let top = plan_json(vec![step(
        "x",
        json!({"kind":"stashSave","request":{"message":null,"includeUntracked":false,"keepIndex":false},"sudo":true}),
    )]);
    assert!(parse(&top).is_err());

    let plan_extra = json!({"explanation":"e","steps":[],"extra":1}).to_string();
    assert!(parse(&plan_extra).is_err());
    assert!(parse("not json").is_err());
}

#[test]
fn caps_steps_at_ten() {
    let ten: Vec<Value> = (0..10)
        .map(|i| step("s", create_cmd(&format!("b{i}"), None, false)))
        .collect();
    assert!(parse(&plan_json(ten.clone())).is_ok());
    let mut eleven = ten;
    eleven.push(step("s", create_cmd("b10", None, false)));
    assert!(parse(&plan_json(eleven)).is_err());
}

#[test]
fn validation_checks_refs_commits_and_remotes() {
    let (t, _) = ff_repo();
    let check = |cmd: Value| {
        let p = parse(&plan_json(vec![step("s", cmd)])).unwrap();
        validate(&t.repo, &p.steps)
    };
    assert!(check(create_cmd("ok-name", Some("main"), false)).is_ok());
    assert_eq!(
        check(create_cmd("bad name", None, false)).unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        check(create_cmd("x", Some("nope"), false))
            .unwrap_err()
            .kind,
        ErrorKind::RefNotFound
    );
    assert!(check(create_cmd("x", Some("--upload-pack=evil"), false)).is_err());
    assert_eq!(
        check(checkout_cmd("missing")).unwrap_err().kind,
        ErrorKind::RefNotFound
    );
    assert!(check(merge_cmd("feature")).is_ok());
    let missing_commit = "0".repeat(40);
    assert!(check(
        json!({"kind":"revert","request":{"commits":[missing_commit],"noCommit":false}})
    )
    .is_err());
    assert!(check(
        json!({"kind":"cherryPick","request":{"commits":[],"targetBranch":null,"noCommit":false}})
    )
    .is_err());
    let err =
        check(json!({"kind":"fetch","request":{"remote":"origin","prune":false,"tags":false}}))
            .unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
    assert!(err.message.starts_with("Step 1:"));
}

#[test]
fn names_created_by_earlier_steps_are_valid_later() {
    let (t, _) = ff_repo();
    let p = parse(&plan_json(vec![
        step("a", create_cmd("topic", Some("main"), false)),
        step("b", checkout_cmd("topic")),
        step("c", merge_cmd("feature")),
    ]))
    .unwrap();
    validate(&t.repo, &p.steps).unwrap();
}

#[test]
fn preview_combines_steps_and_warns_on_multiple_mutations() {
    let (t, _) = ff_repo();
    let state = GitState::default();
    let (entry, _) = state.open(&t.root()).unwrap();
    let p = parse(&plan_json(vec![
        step("make topic", create_cmd("topic", Some("main"), false)),
        step("checkout topic", checkout_cmd("topic")),
        step("merge feature", merge_cmd("feature")),
    ]))
    .unwrap();
    let pv = preview(&state, &entry.id, &p.steps).unwrap();
    assert!(pv.summary.starts_with("3 steps:"));
    assert!(!pv.ref_updates.is_empty());
    assert!(pv
        .warnings
        .iter()
        .any(|w| w.contains("previewed one by one")));
    assert!(pv.warnings.iter().any(|w| w.contains("3 steps")));
    // `topic` does not exist yet, so its checkout cannot be previewed.
    assert!(pv
        .warnings
        .iter()
        .any(|w| w.contains("could not be previewed")));
    // Preview never mutates the repository.
    assert!(t
        .repo
        .find_branch("topic", git2::BranchType::Local)
        .is_err());
}

#[test]
fn executes_create_checkout_merge_in_order() {
    let (t, c) = ff_repo();
    let state = GitState::default();
    let (entry, _) = state.open(&t.root()).unwrap();
    let p = parse(&plan_json(vec![
        step("make topic", create_cmd("topic", Some("main"), false)),
        step("checkout topic", checkout_cmd("topic")),
        step("merge feature", merge_cmd("feature")),
    ]))
    .unwrap();
    validate(&t.repo, &p.steps).unwrap();
    let id = remember(&entry.id, p.steps);
    let out = execute(&state, &entry.id, &id, &no_network).unwrap();
    let OpOutcome::Applied {
        oplog_id,
        head,
        message,
    } = out
    else {
        panic!("expected applied");
    };
    assert!(!oplog_id.is_empty());
    assert!(message.starts_with("Ran 3 steps"));
    match head {
        HeadState::Branch { name, oid } => {
            assert_eq!(name, "topic");
            assert_eq!(oid, c.to_string());
        }
        other => panic!("unexpected head {other:?}"),
    }
    // Every step is in the journal.
    let journal = crate::git::oplog::Oplog::list(&t.repo, 100).unwrap();
    assert!(journal.len() >= 3);
    // A plan runs once.
    let again = execute(&state, &entry.id, &id, &no_network).unwrap_err();
    assert_eq!(again.kind, ErrorKind::InvalidInput);
}

#[test]
fn stops_at_the_first_error() {
    let (t, _) = ff_repo();
    let state = GitState::default();
    let (entry, _) = state.open(&t.root()).unwrap();
    // Deliberately unvalidated: step 2 fails at execution time.
    let p = parse(&plan_json(vec![
        step("one", create_cmd("one", Some("main"), false)),
        step("bad", checkout_cmd("missing")),
        step("three", create_cmd("three", Some("main"), false)),
    ]))
    .unwrap();
    let id = remember(&entry.id, p.steps);
    let err = execute(&state, &entry.id, &id, &no_network).unwrap_err();
    assert!(err.message.starts_with("Step 2 of 3 failed"));
    assert!(err.detail.as_deref().unwrap_or("").contains("Steps 1-1"));
    assert!(t.repo.find_branch("one", git2::BranchType::Local).is_ok());
    assert!(t
        .repo
        .find_branch("three", git2::BranchType::Local)
        .is_err());
}

#[test]
fn stops_at_a_conflict_and_returns_it() {
    let mut t = TestRepo::new();
    t.write("c.txt", "base\n");
    let a = t.commit_all("base");
    t.checkout_branch("other", a);
    t.commit_on("other", "c.txt", "other\n", "other");
    t.commit_on("main", "c.txt", "main\n", "main");
    let state = GitState::default();
    let (entry, _) = state.open(&t.root()).unwrap();
    let p = parse(&plan_json(vec![
        step("merge other", merge_cmd("other")),
        step("after", create_cmd("after", Some("main"), false)),
    ]))
    .unwrap();
    let id = remember(&entry.id, p.steps);
    match execute(&state, &entry.id, &id, &no_network).unwrap() {
        OpOutcome::Conflicted { files, .. } => assert_eq!(files, vec!["c.txt"]),
        other => panic!("expected conflict, got {other:?}"),
    }
    assert!(t
        .repo
        .find_branch("after", git2::BranchType::Local)
        .is_err());
}

#[test]
fn unknown_plan_ids_and_foreign_repos_are_invalid_input() {
    let (t, _) = ff_repo();
    let state = GitState::default();
    let (entry, _) = state.open(&t.root()).unwrap();
    assert_eq!(
        execute(&state, &entry.id, "plan-nope", &no_network)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
    let p = parse(&plan_json(vec![step("s", create_cmd("x", None, false))])).unwrap();
    let id = remember("repo-other", p.steps);
    assert_eq!(
        execute(&state, &entry.id, &id, &no_network)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
}
