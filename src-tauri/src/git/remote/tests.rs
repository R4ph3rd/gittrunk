use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use git2::{Oid, Repository, RepositoryInitOptions, Signature};
use parking_lot::Mutex;

use super::creds::*;
use super::keychain::{self, Keychain, SecretStore};
use super::net::*;
use super::progress::{parse_progress, Progress};
use super::provider::{detect_provider, host_of};
use super::{ops::Throttle, validate, RemoteService};
use crate::askpass;
use crate::git::cli::GitCli;
use crate::git::libgit::LibGit;
use crate::git::oplog::Oplog;
use crate::ipc::error::{AppResult, ErrorKind};
use crate::ipc::types::*;

// ------------------------------------------------------------- fixtures

fn sig() -> Signature<'static> {
    Signature::now("Test User", "test@example.com").unwrap()
}

fn plain() -> NetSession {
    NetSession::plain(GitCli::new())
}

fn commit_file(repo: &Repository, path: &str, content: &str, msg: &str) -> Oid {
    let wd = repo.workdir().unwrap();
    std::fs::write(wd.join(path), content).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(path)).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let s = sig();
    repo.commit(Some("HEAD"), &s, &s, msg, &tree, &parents)
        .unwrap()
}

fn set_identity(repo: &Repository) {
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "Test User").unwrap();
    cfg.set_str("user.email", "test@example.com").unwrap();
}

fn file_url(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        format!("file:///{s}")
    } else {
        format!("file://{s}")
    }
}

struct Fixture {
    _tmp: tempfile::TempDir,
    remote: PathBuf,
    a: Repository,
    a_dir: PathBuf,
}

/// Bare remote + working repo `a` with one commit pushed to `origin/main`.
fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let remote = tmp.path().join("remote.git");
    let mut o = RepositoryInitOptions::new();
    o.initial_head("main").bare(true);
    Repository::init_opts(&remote, &o).unwrap();
    let a_dir = tmp.path().join("a");
    let mut o = RepositoryInitOptions::new();
    o.initial_head("main");
    let a = Repository::init_opts(&a_dir, &o).unwrap();
    set_identity(&a);
    commit_file(&a, "f.txt", "base\n", "base");
    LibGit
        .remote_add(
            &a,
            &RemoteAddRequest {
                name: "origin".into(),
                url: remote.to_string_lossy().into_owned(),
                fetch: false,
            },
        )
        .unwrap();
    push(&plain(), &a_dir, &push_req(&["main"], false, true)).unwrap();
    Fixture {
        _tmp: tmp,
        remote,
        a,
        a_dir,
    }
}

fn push_req(specs: &[&str], lease: bool, upstream: bool) -> PushRequest {
    PushRequest {
        remote: "origin".into(),
        refspecs: specs.iter().map(|s| s.to_string()).collect(),
        force_with_lease: lease,
        set_upstream: upstream,
        tags: false,
    }
}

impl Fixture {
    fn clone_to(&self, name: &str) -> (Repository, PathBuf) {
        let dest = self._tmp.path().join(name);
        let req = CloneRequest {
            url: self.remote.to_string_lossy().into_owned(),
            dest: dest.to_string_lossy().into_owned(),
            bare: false,
            recurse_submodules: false,
        };
        clone(&plain(), &req).unwrap();
        let repo = Repository::open(&dest).unwrap();
        set_identity(&repo);
        (repo, dest)
    }

    fn remote_tip(&self, branch: &str) -> Option<Oid> {
        Repository::open_bare(&self.remote)
            .unwrap()
            .find_reference(&format!("refs/heads/{branch}"))
            .ok()
            .and_then(|r| r.target())
    }
}

fn head(repo: &Repository) -> Oid {
    repo.head().unwrap().peel_to_commit().unwrap().id()
}

fn pull_req(strategy: PullStrategy) -> PullRequest {
    PullRequest {
        remote: None,
        branch: None,
        strategy,
    }
}

// ------------------------------------------------------------- pure helpers

#[test]
fn provider_detection_table() {
    use RemoteProvider::*;
    let table = [
        ("https://github.com/o/r.git", GitHub),
        ("git@github.com:o/r.git", GitHub),
        ("ssh://git@ssh.github.com:443/o/r.git", GitHub),
        ("https://gitlab.com/o/r", GitLab),
        ("git@gitlab.example.org:o/r.git", GitLab),
        ("https://gitlab.internal.corp/o/r", GitLab),
        ("https://user@bitbucket.org/o/r.git", Bitbucket),
        ("git@bitbucket.org:o/r.git", Bitbucket),
        ("https://dev.azure.com/org/proj/_git/r", AzureDevOps),
        ("git@ssh.dev.azure.com:v3/org/proj/r", AzureDevOps),
        ("https://org.visualstudio.com/proj/_git/r", AzureDevOps),
        ("https://example.com/o/r.git", Other),
        ("https://notgithub.com/o/r.git", Other),
        ("https://github.com.evil.io/o/r.git", Other),
        ("/srv/git/r.git", Other),
        ("C:\\repos\\r", Other),
        ("file:///srv/git/r.git", Other),
        ("../relative/r.git", Other),
    ];
    for (url, want) in table {
        assert_eq!(detect_provider(url), want, "{url}");
    }
    assert_eq!(
        host_of("git@GitHub.com:o/r.git").as_deref(),
        Some("github.com")
    );
    assert_eq!(
        host_of("https://u:p@host.io:8443/x").as_deref(),
        Some("host.io")
    );
}

#[test]
fn progress_parser() {
    let p = parse_progress("Receiving objects:  45% (9/20), 1.2 MiB | 3.0 MiB/s").unwrap();
    assert_eq!(p.phase, "Receiving objects");
    assert_eq!(p.percent, Some(45.0));
    let p = parse_progress("remote: Counting objects: 100% (5/5), done.").unwrap();
    assert_eq!(
        (p.phase.as_str(), p.percent),
        ("Counting objects", Some(100.0))
    );
    let p = parse_progress("Resolving deltas:   3% (1/30)").unwrap();
    assert_eq!(p.percent, Some(3.0));
    for phase in ["Compressing objects", "Writing objects"] {
        let p = parse_progress(&format!("{phase}:  50% (1/2)")).unwrap();
        assert_eq!(p.phase, phase);
    }
    let p = parse_progress("remote: Enumerating objects: 12, done.").unwrap();
    assert_eq!((p.phase.as_str(), p.percent), ("Enumerating objects", None));
    let p = parse_progress("Cloning into '/tmp/x'...").unwrap();
    assert_eq!(p.phase, "Cloning");
    assert_eq!(parse_progress("From /tmp/remote"), None);
    assert_eq!(
        parse_progress("   abc123..def456  main -> origin/main"),
        None
    );
    assert_eq!(
        parse_progress("Receiving objects: 250% (1/2)")
            .unwrap()
            .percent,
        None
    );
    assert_eq!(parse_progress(""), None);
}

#[test]
fn throttle_limits_rate_but_passes_phase_changes_and_completion() {
    let mut t = Throttle::new(Duration::from_millis(100));
    let p = |phase: &str, pct: f64| Progress {
        phase: phase.into(),
        percent: Some(pct),
        message: String::new(),
    };
    let t0 = Instant::now();
    assert!(t.allow(&p("Receiving objects", 1.0), t0));
    assert!(!t.allow(&p("Receiving objects", 2.0), t0 + Duration::from_millis(10)));
    assert!(t.allow(&p("Resolving deltas", 1.0), t0 + Duration::from_millis(20)));
    assert!(!t.allow(&p("Resolving deltas", 50.0), t0 + Duration::from_millis(30)));
    assert!(t.allow(
        &p("Resolving deltas", 100.0),
        t0 + Duration::from_millis(40)
    ));
    assert!(t.allow(
        &p("Resolving deltas", 60.0),
        t0 + Duration::from_millis(500)
    ));
}

#[test]
fn failure_classification() {
    let cases = [
        (
            "fatal: Authentication failed for 'https://h/r.git/'",
            ErrorKind::AuthFailed,
        ),
        (
            "git@h: Permission denied (publickey).",
            ErrorKind::AuthFailed,
        ),
        (
            "fatal: could not read Username for 'https://h': terminal prompts disabled",
            ErrorKind::AuthRequired,
        ),
        (
            "fatal: unable to access 'https://h/': Could not resolve host: h",
            ErrorKind::Network,
        ),
        (
            "ssh: connect to host h port 22: Connection timed out",
            ErrorKind::Network,
        ),
        (
            "error: Your local changes to the following files would be overwritten by merge",
            ErrorKind::DirtyWorktree,
        ),
        ("fatal: repository 'x' does not exist", ErrorKind::GitCli),
    ];
    for (stderr, kind) in cases {
        assert_eq!(classify_failure(stderr), kind, "{stderr}");
    }
    let out = crate::git::cli::CliOutput {
        stdout: vec![],
        stderr: "hint: something\nfatal: Authentication failed for 'x'\n".into(),
        code: 128,
    };
    let e = failure_error(&out);
    assert_eq!(e.kind, ErrorKind::AuthFailed);
    assert_eq!(e.message, "Authentication failed for 'x'");
    assert!(e.detail.unwrap().contains("hint"));
}

#[test]
fn prompt_classification() {
    let p = classify_prompt("Username for 'https://github.com': ");
    assert_eq!(p.kind, CredentialKind::Username);
    assert_eq!(p.url, "https://github.com");
    assert_eq!(p.host, "github.com");
    assert_eq!(p.username, None);

    let p = classify_prompt("Password for 'https://alice@github.com': ");
    assert_eq!(p.kind, CredentialKind::Password);
    assert_eq!(p.host, "github.com");
    assert_eq!(p.username.as_deref(), Some("alice"));

    let p = classify_prompt("Password for 'https://bob:old@git.example.com:8443/x': ");
    assert_eq!(p.host, "git.example.com:8443");
    assert_eq!(p.username.as_deref(), Some("bob"));

    let p = classify_prompt("Enter passphrase for key '/home/me/.ssh/id_ed25519': ");
    assert_eq!(p.kind, CredentialKind::Passphrase);
    assert_eq!(p.url, "/home/me/.ssh/id_ed25519");
    assert_eq!(p.host, SSH_KEY_HOST);

    let p = classify_prompt("git@example.com's password: ");
    assert_eq!(p.kind, CredentialKind::Password);
    assert_eq!(p.host, "example.com");
    assert_eq!(p.username.as_deref(), Some("git"));

    assert!(is_confirmation(
        "Are you sure you want to continue connecting (yes/no/[fingerprint])? "
    ));
    assert!(!is_confirmation("Password for 'https://h': "));
}

#[test]
fn random_hex_is_hex_and_unique() {
    let a = random_hex(32);
    let b = random_hex(32);
    assert_eq!(a.len(), 64);
    assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a, b);
}

// ------------------------------------------------------------- option injection

const EVIL: &[&str] = &[
    "--upload-pack=touch /tmp/pwned",
    "-u",
    "--receive-pack=x",
    "--force",
    "",
    "ext::sh -c touch% /tmp/pwned",
    "a b",
    "x\ny",
    "+main",
    "a..b",
];

#[test]
fn injection_is_rejected_by_validators() {
    for v in EVIL {
        assert_eq!(
            validate::remote_name(v).unwrap_err().kind,
            ErrorKind::InvalidInput,
            "remote {v:?}"
        );
    }
    for v in [
        "--upload-pack=x",
        "-oProxyCommand=x",
        "ext::sh -c id",
        "a\nb",
        "",
    ] {
        assert_eq!(
            validate::url(v).unwrap_err().kind,
            ErrorKind::InvalidInput,
            "{v:?}"
        );
    }
    for v in ["--delete", "-f", "a..b", "x y", "", "--upload-pack=x"] {
        assert!(validate::branch(v).is_err(), "branch {v:?}");
    }
    for v in [
        "--force", "+main", "--delete", "main:--x", "*:*", "a b", "", "-f:main",
    ] {
        assert!(validate::refspec(v).is_err(), "refspec {v:?}");
    }
    for v in [
        "main",
        "feature/x",
        "main:main",
        "HEAD:refs/heads/x",
        ":old",
        "v1.0",
    ] {
        validate::refspec(v).unwrap_or_else(|e| panic!("{v}: {e}"));
    }
    for v in [
        "origin",
        "up_stream",
        "my-remote.2",
        "org/x".replace('/', "-").as_str(),
    ] {
        validate::remote_name(v).unwrap();
    }
}

#[test]
fn injection_never_reaches_argument_position() {
    let bad = "--upload-pack=touch /tmp/pwned".to_string();
    assert!(fetch_args(&FetchRequest {
        remote: Some(bad.clone()),
        prune: false,
        tags: false
    })
    .is_err());
    assert!(pull_args(&PullRequest {
        remote: Some("origin".into()),
        branch: Some(bad.clone()),
        strategy: PullStrategy::Merge
    })
    .is_err());
    assert!(push_args(&PushRequest {
        remote: "origin".into(),
        refspecs: vec![bad.clone()],
        force_with_lease: false,
        set_upstream: false,
        tags: false
    })
    .is_err());
    let req = CloneRequest {
        url: bad.clone(),
        dest: "/tmp/x-dest".into(),
        bare: false,
        recurse_submodules: false,
    };
    assert!(clone_target(&req).is_err());
    let req = CloneRequest {
        url: "https://h/r.git".into(),
        dest: "--upload-pack=x".into(),
        bare: false,
        recurse_submodules: false,
    };
    assert!(clone_target(&req).is_err());

    // Accepted values sit after `--`.
    let args = push_args(&push_req(&["main"], true, true)).unwrap();
    let dd = args.iter().position(|a| a == "--").unwrap();
    assert_eq!(&args[dd + 1..], ["origin", "main"]);
    assert!(args[..dd].contains(&"--force-with-lease".to_string()));
    assert!(!args.contains(&"--force".to_string()));
    let args = pull_args(&PullRequest {
        remote: Some("origin".into()),
        branch: Some("main".into()),
        strategy: PullStrategy::FfOnly,
    })
    .unwrap();
    assert_eq!(&args[args.len() - 3..], ["--", "origin", "main"]);
    let args = clone_args(
        &CloneRequest {
            url: "https://h/r.git".into(),
            dest: "d".into(),
            bare: true,
            recurse_submodules: true,
        },
        Path::new("/d"),
    );
    assert_eq!(&args[args.len() - 3..], ["--", "https://h/r.git", "/d"]);
    assert!(args.contains(&"--bare".to_string()));
    assert!(args.contains(&"--recurse-submodules".to_string()));
}

// ------------------------------------------------------------- askpass bridge

#[derive(Default)]
struct FakeStore(Mutex<HashMap<(String, String), String>>);

impl SecretStore for FakeStore {
    fn get(&self, host: &str, username: &str) -> Option<String> {
        self.0.lock().get(&(host.into(), username.into())).cloned()
    }
    fn set(&self, host: &str, username: &str, secret: &str) -> AppResult<()> {
        self.0
            .lock()
            .insert((host.into(), username.into()), secret.into());
        Ok(())
    }
    fn delete(&self, host: &str, username: &str) -> AppResult<()> {
        self.0.lock().remove(&(host.into(), username.into()));
        Ok(())
    }
}

type Seen = Arc<Mutex<Vec<CredentialRequested>>>;

/// Bridge whose "UI" answers every request with `answer`.
fn bridge(
    answer: Option<&'static str>,
    remember: bool,
    store: Arc<FakeStore>,
    timeout: Duration,
) -> (CredentialBridge, Seen, PendingCredentials) {
    let pending = PendingCredentials::default();
    let seen: Seen = Seen::default();
    let (p, s) = (pending.clone(), seen.clone());
    let notifier: Notifier = Arc::new(move |req| {
        let id = req.request_id.clone();
        s.lock().push(req);
        if let Some(a) = answer {
            p.respond(&id, Some(a.to_string()), remember).unwrap();
        }
    });
    let b = CredentialBridge::start_with_timeout(pending.clone(), notifier, None, store, timeout)
        .unwrap();
    (b, seen, pending)
}

fn ask(b: &CredentialBridge, prompt: &str) -> (i32, String) {
    let mut out = Vec::new();
    let code = askpass::run_with(b.addr(), b.token(), prompt, &mut out);
    (code, String::from_utf8(out).unwrap())
}

#[test]
fn askpass_round_trip_password_and_username() {
    let store = Arc::new(FakeStore::default());
    let (b, seen, pending) = bridge(Some("s3cret"), false, store, PROMPT_TIMEOUT);
    let (code, out) = ask(&b, "Password for 'https://alice@github.com': ");
    assert_eq!((code, out.as_str()), (0, "s3cret\n"));
    {
        let seen = seen.lock();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].kind, CredentialKind::Password);
        assert_eq!(seen[0].url, "https://alice@github.com");
        assert_eq!(seen[0].username.as_deref(), Some("alice"));
    }
    let (code, out) = ask(&b, "Username for 'https://github.com': ");
    assert_eq!((code, out.as_str()), (0, "s3cret\n"));
    assert_eq!(seen.lock()[1].kind, CredentialKind::Username);
    assert!(pending.is_empty());
    let env = b.env();
    let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    assert_eq!(get("SSH_ASKPASS_REQUIRE").as_deref(), Some("force"));
    assert_eq!(get("GITTRUNK_ASKPASS_ADDR").as_deref(), Some(b.addr()));
    assert_eq!(get("GITTRUNK_ASKPASS_TOKEN").unwrap().len(), 64);
    assert_eq!(get("GIT_ASKPASS"), get("SSH_ASKPASS"));
    assert!(b.addr().starts_with("127.0.0.1:"));
}

#[test]
fn askpass_cancel_bad_token_confirmation_and_timeout() {
    let store = Arc::new(FakeStore::default());
    // The UI cancels.
    let pending = PendingCredentials::default();
    let p = pending.clone();
    let notifier: Notifier = Arc::new(move |req| {
        p.respond(&req.request_id, None, false).unwrap();
    });
    let b = CredentialBridge::start(pending, notifier, None, store.clone()).unwrap();
    assert_eq!(ask(&b, "Password for 'https://u@h': ").0, 1);
    drop(b);

    // Wrong token: no prompt reaches the UI.
    let (b, seen, _) = bridge(Some("x"), false, store.clone(), PROMPT_TIMEOUT);
    let mut out = Vec::new();
    assert_eq!(
        askpass::run_with(b.addr(), "wrong", "Password for 'https://u@h': ", &mut out),
        1
    );
    assert!(out.is_empty() && seen.lock().is_empty());

    // Host-key confirmations are never forwarded or answered.
    assert_eq!(
        ask(
            &b,
            "Are you sure you want to continue connecting (yes/no)? "
        )
        .0,
        1
    );
    assert!(seen.lock().is_empty());
    drop(b);

    // Nobody answers: cancelled after the timeout.
    let (b, seen, pending) = bridge(None, false, store, Duration::from_millis(300));
    assert_eq!(ask(&b, "Password for 'https://u@h': ").0, 1);
    assert_eq!(seen.lock().len(), 1);
    assert!(pending.is_empty());
    assert!(pending.respond("cred-unknown", None, false).is_err());
}

#[test]
fn askpass_remember_and_keychain_auto_answer() {
    let store = Arc::new(FakeStore::default());
    let (b, seen, _) = bridge(Some("tok"), true, store.clone(), PROMPT_TIMEOUT);
    assert_eq!(ask(&b, "Password for 'https://alice@example.com': ").0, 0);
    assert_eq!(store.get("example.com", "alice").as_deref(), Some("tok"));
    assert_eq!(store.get("example.com", "").as_deref(), Some("alice"));
    drop(b);

    // Later: answered from the store, the UI is never asked.
    let (b, seen2, _) = bridge(Some("other"), false, store.clone(), PROMPT_TIMEOUT);
    let (code, out) = ask(&b, "Username for 'https://example.com': ");
    assert_eq!((code, out.as_str()), (0, "alice\n"));
    let (code, out) = ask(&b, "Password for 'https://example.com': ");
    assert_eq!((code, out.as_str()), (0, "tok\n"));
    assert!(seen2.lock().is_empty());
    assert_eq!(seen.lock().len(), 1);

    keychain::clear(&*store, "example.com").unwrap();
    assert!(store.0.lock().is_empty());
}

#[test]
fn real_keychain_round_trip_when_available() {
    if !Keychain::available() {
        eprintln!("skipping: no secret service");
        return;
    }
    let host = format!("gittrunk-test-{}", random_hex(4));
    let k = Keychain;
    if keychain::store(&k, &host, "tester", "pw").is_err() {
        eprintln!("skipping: keychain is not writable");
        return;
    }
    assert_eq!(k.get(&host, "tester").as_deref(), Some("pw"));
    assert_eq!(k.get(&host, "").as_deref(), Some("tester"));
    keychain::clear(&k, &host).unwrap();
    assert_eq!(k.get(&host, "tester"), None);
    assert_eq!(k.get(&host, ""), None);
}

// ------------------------------------------------------------- remote management

#[test]
fn remote_management() {
    let f = fixture();
    let svc = LibGit;
    let list = svc.remote_list(&f.a).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "origin");
    assert_eq!(list[0].provider, RemoteProvider::Other);

    let info = svc
        .remote_add(
            &f.a,
            &RemoteAddRequest {
                name: "up".into(),
                url: "git@github.com:o/r.git".into(),
                fetch: false,
            },
        )
        .unwrap();
    assert_eq!(info.provider, RemoteProvider::GitHub);
    assert!(svc
        .remote_add(
            &f.a,
            &RemoteAddRequest {
                name: "up".into(),
                url: "x".into(),
                fetch: false
            }
        )
        .is_err());
    assert!(svc
        .remote_add(
            &f.a,
            &RemoteAddRequest {
                name: "--evil".into(),
                url: "x".into(),
                fetch: false
            }
        )
        .is_err());

    svc.remote_set_url(&f.a, "up", "https://gitlab.com/o/r.git", false)
        .unwrap();
    svc.remote_set_url(&f.a, "up", "https://gitlab.com/o/push.git", true)
        .unwrap();
    let up = svc
        .remote_list(&f.a)
        .unwrap()
        .into_iter()
        .find(|r| r.name == "up")
        .unwrap();
    assert_eq!(up.provider, RemoteProvider::GitLab);
    assert_eq!(
        up.push_url.as_deref(),
        Some("https://gitlab.com/o/push.git")
    );
    assert!(svc
        .remote_set_url(&f.a, "up", "--upload-pack=x", false)
        .is_err());

    svc.remote_rename(&f.a, "up", "upstream").unwrap();
    assert!(f.a.find_remote("upstream").is_ok());
    svc.remote_remove(&f.a, "upstream").unwrap();
    assert_eq!(
        svc.remote_remove(&f.a, "upstream").unwrap_err().kind,
        ErrorKind::RefNotFound
    );
}

#[test]
fn set_upstream_sets_and_clears() {
    let f = fixture();
    let svc = LibGit;
    // Fixture pushed with -u: upstream exists.
    let has_upstream = |r: &Repository| {
        r.find_branch("main", git2::BranchType::Local)
            .unwrap()
            .upstream()
            .is_ok()
    };
    assert!(has_upstream(&f.a));
    svc.set_upstream(&f.a, "main", None).unwrap();
    assert!(!has_upstream(&f.a));
    svc.set_upstream(&f.a, "main", Some("origin/main")).unwrap();
    assert!(has_upstream(&f.a));
    assert_eq!(
        svc.set_upstream(&f.a, "main", Some("origin/nope"))
            .unwrap_err()
            .kind,
        ErrorKind::RefNotFound
    );
    assert!(svc.set_upstream(&f.a, "--x", None).is_err());
}

// ------------------------------------------------------------- network operations

#[test]
fn clone_variants_and_destination_validation() {
    let f = fixture();
    let tmp = f._tmp.path();
    let mk = |url: String, dest: PathBuf, bare: bool| CloneRequest {
        url,
        dest: dest.to_string_lossy().into_owned(),
        bare,
        recurse_submodules: false,
    };

    // Plain path and file:// URL.
    let d1 = tmp.join("c1");
    clone(
        &plain(),
        &mk(f.remote.to_string_lossy().into_owned(), d1.clone(), false),
    )
    .unwrap();
    assert_eq!(head(&Repository::open(&d1).unwrap()), head(&f.a));
    let d2 = tmp.join("c2");
    clone(&plain(), &mk(file_url(&f.remote), d2.clone(), false)).unwrap();
    assert!(d2.join("f.txt").exists());

    // Bare, into an existing empty directory.
    let d3 = tmp.join("c3");
    std::fs::create_dir(&d3).unwrap();
    clone(&plain(), &mk(file_url(&f.remote), d3.clone(), true)).unwrap();
    assert!(Repository::open(&d3).unwrap().is_bare());

    // Existing non-empty destination is refused; nothing is touched.
    let err = clone(&plain(), &mk(file_url(&f.remote), d1.clone(), false)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(d1.join("f.txt").exists());

    // A failed clone leaves no destination behind.
    let d4 = tmp.join("c4");
    let err = clone(
        &plain(),
        &mk(file_url(&tmp.join("missing.git")), d4.clone(), false),
    )
    .unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
    assert!(!d4.exists());
}

#[test]
fn fetch_updates_remote_tracking_refs() {
    let f = fixture();
    let (b, b_dir) = f.clone_to("b");
    let c = commit_file(&f.a, "g.txt", "g\n", "second");
    push(&plain(), &f.a_dir, &push_req(&["main"], false, false)).unwrap();
    assert_ne!(head(&b), c);
    let req = FetchRequest {
        remote: Some("origin".into()),
        prune: true,
        tags: true,
    };
    fetch(&plain(), &b_dir, &req).unwrap();
    let tracked = b
        .find_reference("refs/remotes/origin/main")
        .unwrap()
        .target();
    assert_eq!(tracked, Some(c));
    // All remotes.
    fetch(
        &plain(),
        &b_dir,
        &FetchRequest {
            remote: None,
            prune: false,
            tags: false,
        },
    )
    .unwrap();
    // Unknown remote.
    let err = fetch(
        &plain(),
        &b_dir,
        &FetchRequest {
            remote: Some("nope".into()),
            prune: false,
            tags: false,
        },
    )
    .unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
}

#[test]
fn pull_fast_forward_and_records_oplog() {
    let f = fixture();
    let (b, _) = f.clone_to("b");
    let c = commit_file(&f.a, "g.txt", "g\n", "second");
    push(&plain(), &f.a_dir, &push_req(&["main"], false, false)).unwrap();
    {
        let out = pull(&plain(), &b, &pull_req(PullStrategy::FfOnly)).unwrap();
        let OpOutcome::Applied { head: h, .. } = out else {
            panic!("expected Applied");
        };
        assert_eq!(head(&b), c);
        assert!(matches!(&h, HeadState::Branch { oid, .. } if *oid == c.to_string()));
    }
    let log = Oplog::list(&b, 10).unwrap();
    assert_eq!(log[0].operation, "pull");
    assert_eq!(log[0].head_after, Some(c.to_string()));
}

#[test]
fn pull_merge_rebase_and_ff_only_on_diverged_history() {
    for strategy in [
        PullStrategy::Merge,
        PullStrategy::Rebase,
        PullStrategy::FfOnly,
    ] {
        let f = fixture();
        let (b, _) = f.clone_to("b");
        commit_file(&f.a, "remote.txt", "r\n", "remote change");
        push(&plain(), &f.a_dir, &push_req(&["main"], false, false)).unwrap();
        let local = commit_file(&b, "local.txt", "l\n", "local change");
        let result = pull(&plain(), &b, &pull_req(strategy));
        match strategy {
            PullStrategy::FfOnly => {
                assert_eq!(result.unwrap_err().kind, ErrorKind::GitCli);
                assert_eq!(head(&b), local);
            }
            PullStrategy::Merge => {
                assert!(matches!(result.unwrap(), OpOutcome::Applied { .. }));
                assert_eq!(
                    b.head().unwrap().peel_to_commit().unwrap().parent_count(),
                    2
                );
            }
            PullStrategy::Rebase => {
                assert!(matches!(result.unwrap(), OpOutcome::Applied { .. }));
                let h = b.head().unwrap().peel_to_commit().unwrap();
                assert_eq!(h.parent_count(), 1);
                assert_eq!(String::from_utf8_lossy(h.message_bytes()), "local change");
                assert_ne!(h.id(), local);
            }
        }
        assert!(
            b.workdir().unwrap().join("remote.txt").exists() || strategy == PullStrategy::FfOnly
        );
    }
}

#[test]
fn pull_stops_on_conflicts_and_reports_the_oplog_entry() {
    for strategy in [PullStrategy::Merge, PullStrategy::Rebase] {
        let f = fixture();
        let (b, _) = f.clone_to("b");
        commit_file(&f.a, "f.txt", "remote\n", "remote edit");
        push(&plain(), &f.a_dir, &push_req(&["main"], false, false)).unwrap();
        commit_file(&b, "f.txt", "local\n", "local edit");
        let out = pull(&plain(), &b, &pull_req(strategy)).unwrap();
        let OpOutcome::Conflicted { oplog_id, files } = out else {
            panic!("expected Conflicted for {strategy:?}");
        };
        assert_eq!(files, vec!["f.txt".to_string()]);
        let log = Oplog::list(&b, 10).unwrap();
        assert_eq!(log[0].id, oplog_id);
        assert_eq!(log[0].operation, "pull");
    }
}

#[test]
fn pull_dirty_worktree_is_reported() {
    let f = fixture();
    let (b, b_dir) = f.clone_to("b");
    commit_file(&f.a, "f.txt", "remote\n", "remote edit");
    push(&plain(), &f.a_dir, &push_req(&["main"], false, false)).unwrap();
    std::fs::write(b_dir.join("f.txt"), "uncommitted\n").unwrap();
    let err = pull(&plain(), &b, &pull_req(PullStrategy::Merge)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::DirtyWorktree);
}

#[test]
fn push_rejections_force_with_lease_and_new_branch() {
    let f = fixture();
    let (b, b_dir) = f.clone_to("b");
    let a2 = commit_file(&f.a, "a.txt", "a\n", "a2");
    push(&plain(), &f.a_dir, &push_req(&["main"], false, false)).unwrap();
    assert_eq!(f.remote_tip("main"), Some(a2));

    // B diverges without having fetched.
    let b2 = commit_file(&b, "b.txt", "b\n", "b2");
    let err = push(&plain(), &b_dir, &push_req(&["main"], false, false)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
    // Stale lease: rejected.
    let err = push(&plain(), &b_dir, &push_req(&["main"], true, false)).unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
    assert_eq!(f.remote_tip("main"), Some(a2));

    // After fetching, the lease matches and the forced update goes through.
    fetch(
        &plain(),
        &b_dir,
        &FetchRequest {
            remote: Some("origin".into()),
            prune: false,
            tags: false,
        },
    )
    .unwrap();
    push(&plain(), &b_dir, &push_req(&["main"], true, false)).unwrap();
    assert_eq!(f.remote_tip("main"), Some(b2));

    // New branch with -u sets the upstream; deletion via `:branch`.
    b.branch("topic", &b.find_commit(b2).unwrap(), false)
        .unwrap();
    push(&plain(), &b_dir, &push_req(&["topic"], false, true)).unwrap();
    assert_eq!(f.remote_tip("topic"), Some(b2));
    assert!(b
        .find_branch("topic", git2::BranchType::Local)
        .unwrap()
        .upstream()
        .is_ok());
    push(&plain(), &b_dir, &push_req(&[":topic"], false, false)).unwrap();
    assert_eq!(f.remote_tip("topic"), None);
}

#[test]
fn push_tags() {
    let f = fixture();
    let c = head(&f.a);
    f.a.tag_lightweight("v1", &f.a.find_object(c, None).unwrap(), false)
        .unwrap();
    let mut req = push_req(&[], false, false);
    req.tags = true;
    push(&plain(), &f.a_dir, &req).unwrap();
    let remote = Repository::open_bare(&f.remote).unwrap();
    assert!(remote.find_reference("refs/tags/v1").is_ok());
}

#[test]
fn delete_remote_branch_previews_then_deletes_and_records() {
    let f = fixture();
    let c = head(&f.a);
    f.a.branch("topic", &f.a.find_commit(c).unwrap(), false)
        .unwrap();
    push(&plain(), &f.a_dir, &push_req(&["topic"], false, false)).unwrap();
    assert_eq!(f.remote_tip("topic"), Some(c));
    let req = BranchDeleteRequest {
        name: "origin/topic".into(),
        remote: true,
        force: false,
    };

    let out = delete_remote_branch(&plain(), &f.a, &req, true).unwrap();
    let OpOutcome::Preview { preview } = out else {
        panic!("expected Preview");
    };
    assert!(preview.summary.contains("origin/topic"));
    assert!(preview
        .ref_updates
        .iter()
        .any(|u| u.name == "refs/remotes/origin/topic"));
    assert_eq!(f.remote_tip("topic"), Some(c), "dry run must not delete");

    let out = delete_remote_branch(&plain(), &f.a, &req, false).unwrap();
    assert!(matches!(out, OpOutcome::Applied { .. }));
    assert_eq!(f.remote_tip("topic"), None);
    assert!(f.a.find_reference("refs/remotes/origin/topic").is_err());
    assert_eq!(
        Oplog::list(&f.a, 5).unwrap()[0].operation,
        "branch_delete_remote"
    );

    let missing = BranchDeleteRequest {
        name: "origin/nope".into(),
        remote: true,
        force: false,
    };
    assert_eq!(
        delete_remote_branch(&plain(), &f.a, &missing, false)
            .unwrap_err()
            .kind,
        ErrorKind::RefNotFound
    );
    let evil = BranchDeleteRequest {
        name: "origin/--upload-pack=x".into(),
        remote: true,
        force: false,
    };
    assert!(delete_remote_branch(&plain(), &f.a, &evil, false).is_err());
}

#[test]
fn split_remote_branch_uses_longest_remote_prefix() {
    let f = fixture();
    LibGit
        .remote_add(
            &f.a,
            &RemoteAddRequest {
                name: "origin-2".into(),
                url: "/x".into(),
                fetch: false,
            },
        )
        .unwrap();
    assert_eq!(
        split_remote_branch(&f.a, "origin-2/feat/x").unwrap(),
        ("origin-2".into(), "feat/x".into())
    );
    assert_eq!(
        split_remote_branch(&f.a, "refs/remotes/origin/main").unwrap(),
        ("origin".into(), "main".into())
    );
    assert_eq!(
        split_remote_branch(&f.a, "main").unwrap(),
        ("origin".into(), "main".into())
    );
    assert!(split_remote_branch(&f.a, "zzz/x").is_err());
}

#[test]
fn cancelled_operation_reports_cancelled() {
    let f = fixture();
    let ops = crate::git::cli::OpRegistry::default();
    let handle = ops.register("op-x");
    ops.cancel("op-x");
    let sess = NetSession::new(GitCli::new(), Some(handle), None, Box::new(|_| {}));
    let err = fetch(
        &sess,
        &f.a_dir,
        &FetchRequest {
            remote: Some("origin".into()),
            prune: false,
            tags: false,
        },
    )
    .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Cancelled);
}
