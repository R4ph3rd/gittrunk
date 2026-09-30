//! Tests of the libgit2 backend. They call `native::*` directly, so they run
//! on desktop builds too (against local remotes made by the fixtures).

use super::*;
use crate::git::remote::native::{self, classify_git2_error, CredState, Hooks};
use git2::{CredentialType, ErrorClass, ErrorCode};

fn cancelled_session() -> NetSession {
    let ops = crate::git::cli::OpRegistry::default();
    let handle = ops.register("op-native");
    ops.cancel("op-native");
    NetSession::new(GitCli::new(), Some(handle), None, Box::new(|_| {}))
}

fn fetch_req(remote: Option<&str>, prune: bool, tags: bool) -> FetchRequest {
    FetchRequest {
        remote: remote.map(str::to_string),
        prune,
        tags,
    }
}

fn nfetch(dir: &Path, req: &FetchRequest) -> AppResult<()> {
    native::fetch(&plain(), dir, req)
}

fn npush(dir: &Path, req: &PushRequest) -> AppResult<()> {
    native::push(&plain(), dir, req)
}

fn npull(repo: &Repository, strategy: PullStrategy) -> AppResult<OpOutcome> {
    // The merge step runs through `sess.run`; everything else is native.
    pull(&plain(), repo, &pull_req(strategy))
}

fn tracking(repo: &Repository, name: &str) -> Option<Oid> {
    repo.refname_to_id(&format!("refs/remotes/{name}")).ok()
}

// ------------------------------------------------------------- fetch

#[test]
fn native_fetch_single_all_prune_and_tags() {
    let f = fixture();
    let (b, b_dir) = f.clone_to("b");
    let second = tempfile::tempdir().unwrap();
    let remote2 = second.path().join("r2.git");
    Repository::init_bare(&remote2).unwrap();
    f.a.remote("second", remote2.to_str().unwrap()).unwrap();
    npush(
        &f.a_dir,
        &PushRequest {
            remote: "second".into(),
            refspecs: vec!["main".into()],
            force_with_lease: false,
            set_upstream: false,
            tags: false,
        },
    )
    .unwrap();
    b.remote("second", remote2.to_str().unwrap()).unwrap();

    // Single remote.
    let c2 = commit_file(&f.a, "n.txt", "n\n", "new");
    npush(&f.a_dir, &push_req(&["main"], false, false)).unwrap();
    nfetch(&b_dir, &fetch_req(Some("origin"), false, false)).unwrap();
    assert_eq!(tracking(&b, "origin/main"), Some(c2));
    assert_eq!(tracking(&b, "second/main"), None);

    // All remotes.
    nfetch(&b_dir, &fetch_req(None, false, false)).unwrap();
    assert!(tracking(&b, "second/main").is_some());

    // Tags only arrive with `tags` when they do not point into fetched history.
    let orphan = {
        let tree =
            f.a.find_tree(f.a.index().unwrap().write_tree().unwrap())
                .unwrap();
        let s = sig();
        f.a.commit(None, &s, &s, "orphan", &tree, &[]).unwrap()
    };
    f.a.tag_lightweight("v9", &f.a.find_object(orphan, None).unwrap(), false)
        .unwrap();
    npush(
        &f.a_dir,
        &PushRequest {
            remote: "origin".into(),
            refspecs: vec![],
            force_with_lease: false,
            set_upstream: false,
            tags: true,
        },
    )
    .unwrap();
    nfetch(&b_dir, &fetch_req(Some("origin"), false, true)).unwrap();
    assert!(b.find_reference("refs/tags/v9").is_ok());

    // Prune drops tracking refs of deleted branches.
    let c = head(&f.a);
    f.a.branch("topic", &f.a.find_commit(c).unwrap(), false)
        .unwrap();
    npush(&f.a_dir, &push_req(&["topic"], false, false)).unwrap();
    nfetch(&b_dir, &fetch_req(Some("origin"), false, false)).unwrap();
    assert!(tracking(&b, "origin/topic").is_some());
    npush(&f.a_dir, &push_req(&[":topic"], false, false)).unwrap();
    nfetch(&b_dir, &fetch_req(Some("origin"), false, false)).unwrap();
    assert!(tracking(&b, "origin/topic").is_some(), "no prune requested");
    nfetch(&b_dir, &fetch_req(Some("origin"), true, false)).unwrap();
    assert!(tracking(&b, "origin/topic").is_none());
}

// ------------------------------------------------------------- pull

#[test]
fn native_pull_merge_ff_only_and_up_to_date() {
    // R1b-2: `PullStrategy::Rebase` needs the shim's rebase; covered by the
    // desktop test `pull_merge_rebase_and_ff_only_on_diverged_history`.
    for strategy in [PullStrategy::Merge, PullStrategy::FfOnly] {
        let f = fixture();
        let (b, _) = f.clone_to("b");

        // Up to date: success, no merge commit, no changes.
        let before = head(&b);
        assert!(matches!(
            npull(&b, strategy).unwrap(),
            OpOutcome::Applied { .. }
        ));
        assert_eq!(head(&b), before);

        commit_file(&f.a, "remote.txt", "r\n", "remote change");
        npush(&f.a_dir, &push_req(&["main"], false, false)).unwrap();
        let local = commit_file(&b, "local.txt", "l\n", "local change");
        let result = npull(&b, strategy);
        match strategy {
            PullStrategy::FfOnly => {
                assert_eq!(result.unwrap_err().kind, ErrorKind::GitCli);
                assert_eq!(head(&b), local);
            }
            _ => {
                assert!(matches!(result.unwrap(), OpOutcome::Applied { .. }));
                let h = b.head().unwrap().peel_to_commit().unwrap();
                assert_eq!(h.parent_count(), 2);
                let msg = String::from_utf8_lossy(h.message_bytes()).into_owned();
                assert!(msg.starts_with("Merge branch 'main' of "), "{msg}");
                assert!(b.workdir().unwrap().join("remote.txt").exists());
            }
        }
    }
}

#[test]
fn native_pull_conflict_and_explicit_target() {
    let f = fixture();
    let (b, _) = f.clone_to("b");
    commit_file(&f.a, "f.txt", "remote\n", "remote edit");
    npush(&f.a_dir, &push_req(&["main"], false, false)).unwrap();
    commit_file(&b, "f.txt", "local\n", "local edit");
    let req = PullRequest {
        remote: Some("origin".into()),
        branch: Some("main".into()),
        strategy: PullStrategy::Merge,
    };
    let out = pull(&plain(), &b, &req).unwrap();
    let OpOutcome::Conflicted { files, .. } = out else {
        panic!("expected Conflicted");
    };
    assert_eq!(files, vec!["f.txt".to_string()]);

    // A branch that does not exist on the remote.
    let (c, _) = f.clone_to("c");
    let req = PullRequest {
        remote: Some("origin".into()),
        branch: Some("nope".into()),
        strategy: PullStrategy::Merge,
    };
    let err = pull(&plain(), &c, &req).unwrap_err();
    assert!(matches!(
        err.kind,
        ErrorKind::RefNotFound | ErrorKind::GitCli
    ));
}

// ------------------------------------------------------------- push

#[test]
fn native_push_rejections_lease_tags_and_upstream() {
    let f = fixture();
    let (b, b_dir) = f.clone_to("b");
    let a2 = commit_file(&f.a, "a.txt", "a\n", "a2");
    npush(&f.a_dir, &push_req(&["main"], false, false)).unwrap();
    assert_eq!(f.remote_tip("main"), Some(a2));
    assert_eq!(tracking(&f.a, "origin/main"), Some(a2));

    let b2 = commit_file(&b, "b.txt", "b\n", "b2");
    // Non-fast-forward: an error, remote untouched.
    let err = npush(&b_dir, &push_req(&["main"], false, false)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
    // Stale lease.
    let err = npush(&b_dir, &push_req(&["main"], true, false)).unwrap_err();
    assert!(err.message.contains("stale info"), "{}", err.message);
    assert_eq!(f.remote_tip("main"), Some(a2));
    // Fresh lease forces the update.
    nfetch(&b_dir, &fetch_req(Some("origin"), false, false)).unwrap();
    npush(&b_dir, &push_req(&["main"], true, false)).unwrap();
    assert_eq!(f.remote_tip("main"), Some(b2));

    // New branch with upstream, then deletion.
    b.branch("topic", &b.find_commit(b2).unwrap(), false)
        .unwrap();
    npush(&b_dir, &push_req(&["topic"], false, true)).unwrap();
    assert_eq!(f.remote_tip("topic"), Some(b2));
    let topic = b.find_branch("topic", git2::BranchType::Local).unwrap();
    assert_eq!(
        topic.upstream().unwrap().name().unwrap(),
        Some("origin/topic")
    );
    npush(&b_dir, &push_req(&[":topic"], false, false)).unwrap();
    assert_eq!(f.remote_tip("topic"), None);
    assert!(tracking(&b, "origin/topic").is_none());

    // Renaming refspec, tags, and an unknown source.
    npush(&b_dir, &push_req(&["main:refs/heads/copy"], false, false)).unwrap();
    assert_eq!(f.remote_tip("copy"), Some(b2));
    b.tag_lightweight("v1", &b.find_object(b2, None).unwrap(), false)
        .unwrap();
    let mut req = push_req(&[], false, false);
    req.tags = true;
    npush(&b_dir, &req).unwrap();
    assert!(Repository::open_bare(&f.remote)
        .unwrap()
        .find_reference("refs/tags/v1")
        .is_ok());
    assert_eq!(
        npush(&b_dir, &push_req(&["ghost"], false, false))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
    // Default refspec is the current branch.
    let b3 = commit_file(&b, "c.txt", "c\n", "b3");
    npush(&b_dir, &push_req(&[], false, false)).unwrap();
    assert_eq!(f.remote_tip("main"), Some(b3));
}

// ------------------------------------------------------------- clone / delete

#[test]
fn native_clone_variants_cleanup_and_submodules() {
    let f = fixture();
    let tmp = f._tmp.path();
    let mk = |dest: &Path, bare: bool, subs: bool| CloneRequest {
        url: file_url(&f.remote),
        dest: dest.to_string_lossy().into_owned(),
        bare,
        recurse_submodules: subs,
    };
    let d1 = tmp.join("n1");
    native::clone_into(&plain(), &mk(&d1, false, true), &d1).unwrap();
    assert_eq!(head(&Repository::open(&d1).unwrap()), head(&f.a));
    let d2 = tmp.join("n2");
    native::clone_into(&plain(), &mk(&d2, true, false), &d2).unwrap();
    assert!(Repository::open(&d2).unwrap().is_bare());

    // Failure through `net::clone` leaves no destination behind.
    let d3 = tmp.join("n3");
    let mut req = mk(&d3, false, false);
    req.url = file_url(&tmp.join("missing.git"));
    assert_eq!(clone(&plain(), &req).unwrap_err().kind, ErrorKind::GitCli);
    assert!(!d3.exists());
    // ... and an existing empty destination stays, emptied.
    std::fs::create_dir(&d3).unwrap();
    assert!(clone(&plain(), &req).is_err());
    assert!(d3.is_dir() && std::fs::read_dir(&d3).unwrap().next().is_none());
}

#[test]
fn native_delete_remote_branch_updates_tracking_ref() {
    let f = fixture();
    let c = head(&f.a);
    f.a.branch("topic", &f.a.find_commit(c).unwrap(), false)
        .unwrap();
    npush(&f.a_dir, &push_req(&["topic"], false, false)).unwrap();
    let req = BranchDeleteRequest {
        name: "origin/topic".into(),
        remote: true,
        force: false,
    };
    delete_remote_branch(&plain(), &f.a, &req, false).unwrap();
    assert_eq!(f.remote_tip("topic"), None);
    assert!(tracking(&f.a, "origin/topic").is_none());
}

// ------------------------------------------------------------- cancel

#[test]
fn native_operations_honor_cancellation() {
    let f = fixture();
    let sess = cancelled_session();
    let kind = |r: AppResult<()>| r.unwrap_err().kind;
    assert_eq!(
        kind(native::fetch(
            &sess,
            &f.a_dir,
            &fetch_req(None, false, false)
        )),
        ErrorKind::Cancelled
    );
    assert_eq!(
        kind(native::push(
            &sess,
            &f.a_dir,
            &push_req(&["main"], false, false)
        )),
        ErrorKind::Cancelled
    );
    let dest = f._tmp.path().join("cancelled");
    let req = CloneRequest {
        url: file_url(&f.remote),
        dest: dest.to_string_lossy().into_owned(),
        bare: false,
        recurse_submodules: false,
    };
    assert_eq!(kind(clone(&sess, &req).map(|_| ())), ErrorKind::Cancelled);
    assert!(!dest.exists());
    let (b, _) = f.clone_to("b");
    assert_eq!(
        pull(&sess, &b, &pull_req(PullStrategy::Merge))
            .unwrap_err()
            .kind,
        ErrorKind::Cancelled
    );
}

#[test]
fn native_progress_is_reported() {
    let f = fixture();
    let seen: Arc<Mutex<Vec<Progress>>> = Arc::default();
    let s = seen.clone();
    let sess = NetSession::new(
        GitCli::new(),
        None,
        None,
        Box::new(move |p| s.lock().push(p)),
    );
    let dest = f._tmp.path().join("prog");
    let req = CloneRequest {
        url: file_url(&f.remote),
        dest: dest.to_string_lossy().into_owned(),
        bare: false,
        recurse_submodules: false,
    };
    clone(&sess, &req).unwrap();
    assert!(seen.lock().iter().any(|p| p.phase == "Cloning"));
}

// ------------------------------------------------------------- errors

#[test]
fn git2_error_classification() {
    let e = |code, class, msg: &str| git2::Error::new(code, class, msg);
    assert_eq!(
        classify_git2_error(&e(ErrorCode::Auth, ErrorClass::Http, "bad creds")),
        ErrorKind::AuthFailed
    );
    assert_eq!(
        classify_git2_error(&e(ErrorCode::GenericError, ErrorClass::Http, "status 500")),
        ErrorKind::Network
    );
    assert_eq!(
        classify_git2_error(&e(
            ErrorCode::GenericError,
            ErrorClass::Os,
            "Connection refused"
        )),
        ErrorKind::Network
    );
    assert_eq!(
        classify_git2_error(&e(
            ErrorCode::GenericError,
            ErrorClass::Os,
            "failed to resolve address for example.invalid"
        )),
        ErrorKind::Network
    );
    assert_eq!(
        classify_git2_error(&e(ErrorCode::User, ErrorClass::Callback, "aborted")),
        ErrorKind::Cancelled
    );
    assert_eq!(
        classify_git2_error(&e(
            ErrorCode::GenericError,
            ErrorClass::Os,
            "failed to resolve path '/x': No such file"
        )),
        ErrorKind::GitCli
    );
    let cert = native::git2_error(&e(
        ErrorCode::Certificate,
        ErrorClass::Ssl,
        "the SSL certificate is invalid",
    ));
    assert_eq!(cert.kind, ErrorKind::Network);
    assert!(cert.detail.unwrap().contains("certificate"));
}

// ------------------------------------------------------------- credentials

type Asked = Arc<Mutex<Vec<CredentialRequested>>>;

/// Session whose resolver answers prompts from `answers` (`None` = cancel).
fn resolver_session(
    store: Arc<FakeStore>,
    answers: Vec<Option<&'static str>>,
) -> (NetSession, Asked) {
    let pending = PendingCredentials::default();
    let asked: Asked = Asked::default();
    let (p, a) = (pending.clone(), asked.clone());
    let answers = Mutex::new(answers.into_iter());
    let notifier: Notifier = Arc::new(move |req| {
        let id = req.request_id.clone();
        a.lock().push(req);
        let ans = answers.lock().next().flatten();
        p.respond(&id, ans.map(str::to_string), false).unwrap();
    });
    let resolver = CredentialResolver::new(store, pending, notifier, Duration::from_secs(5));
    (
        NetSession::plain(GitCli::new()).with_resolver(Arc::new(resolver)),
        asked,
    )
}

fn userpass(hooks: &Hooks<'_>, url: &str, st: &mut CredState) -> Result<git2::Cred, git2::Error> {
    hooks.credentials(url, None, CredentialType::USER_PASS_PLAINTEXT, st)
}

#[test]
fn resolver_uses_stored_secret_first_then_prompts_after_rejection() {
    let store = Arc::new(FakeStore::default());
    store.set("example.com", "alice", "old-token").unwrap();
    let (sess, asked) = resolver_session(store.clone(), vec![Some("new-token")]);
    let hooks = Hooks::new(&sess);
    let url = "https://alice@example.com/o/r.git";
    let mut st = CredState::default();

    // Attempt 1: stored secret, no prompt.
    assert!(userpass(&hooks, url, &mut st).is_ok());
    assert!(asked.lock().is_empty());
    assert_eq!(
        store.get("example.com", "alice").as_deref(),
        Some("old-token")
    );

    // Attempt 2 (rejection): the stale secret is forgotten and the UI asked.
    assert!(userpass(&hooks, url, &mut st).is_ok());
    assert_eq!(store.get("example.com", "alice"), None);
    let asked = asked.lock();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].kind, CredentialKind::Password);
    assert_eq!(asked[0].username.as_deref(), Some("alice"));
    assert_eq!(asked[0].url, url);
}

#[test]
fn resolver_asks_for_the_username_and_fails_after_three_attempts() {
    let store = Arc::new(FakeStore::default());
    let (sess, asked) = resolver_session(
        store,
        vec![
            Some("bob"),
            Some("t1"),
            Some("t2"),
            Some("t3"),
            Some("t4"),
            Some("t5"),
        ],
    );
    let hooks = Hooks::new(&sess);
    let url = "https://example.com/o/r.git";
    let mut st = CredState::default();
    assert!(userpass(&hooks, url, &mut st).is_ok());
    assert_eq!(asked.lock()[0].kind, CredentialKind::Username);
    assert_eq!(asked.lock()[1].kind, CredentialKind::Password);
    assert!(userpass(&hooks, url, &mut st).is_ok());
    assert!(userpass(&hooks, url, &mut st).is_ok());
    assert!(userpass(&hooks, url, &mut st).is_err());
    let err = hooks.convert(git2::Error::from_str("x"));
    assert_eq!(err.kind, ErrorKind::AuthFailed);
}

#[test]
fn credentials_reject_ssh_and_missing_answers() {
    let (sess, _) = resolver_session(Arc::new(FakeStore::default()), vec![None]);
    let hooks = Hooks::new(&sess);
    let mut st = CredState::default();
    assert!(hooks
        .credentials("ssh://h/r", Some("git"), CredentialType::SSH_KEY, &mut st)
        .is_err());
    let err = hooks.convert(git2::Error::from_str("x"));
    assert_eq!(err.kind, ErrorKind::Unsupported);
    assert!(err.message.contains("HTTPS"));

    // The user cancels the prompt.
    assert!(userpass(&hooks, "https://u@h.example/r", &mut st).is_err());
    assert_eq!(
        hooks.convert(git2::Error::from_str("x")).kind,
        ErrorKind::AuthRequired
    );

    // No resolver at all.
    let sess = plain();
    let hooks = Hooks::new(&sess);
    assert!(userpass(&hooks, "https://u@h.example/r", &mut CredState::default()).is_err());
    assert_eq!(
        hooks.convert(git2::Error::from_str("x")).kind,
        ErrorKind::AuthRequired
    );
}

// ------------------------------------------------------------- validation

#[cfg(embedded_git)]
#[test]
fn embedded_url_validation() {
    validate::url("https://github.com/o/r.git").unwrap();
    validate::url("http://localhost/r.git").unwrap(); // cfg(test) only
    validate::url("file:///tmp/r.git").unwrap(); // cfg(test) only
    for v in ["ssh://git@github.com/o/r.git", "git@github.com:o/r.git"] {
        let err = validate::url(v).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Unsupported, "{v}");
        assert!(err.message.contains("HTTPS"), "{v}");
    }
    assert_eq!(
        validate::url("ftp://x/r").unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        validate::url("--upload-pack=x").unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    // Remote management refuses ssh remotes too.
    let f = fixture();
    let err = LibGit
        .remote_add(
            &f.a,
            &RemoteAddRequest {
                name: "up".into(),
                url: "git@github.com:o/r.git".into(),
                fetch: false,
            },
        )
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Unsupported);
}

#[cfg(not(embedded_git))]
#[test]
fn desktop_url_validation_still_accepts_ssh() {
    validate::url("git@github.com:o/r.git").unwrap();
    validate::url("ssh://git@github.com/o/r.git").unwrap();
}
