use super::*;
use crate::git::fixtures::TestRepo;

#[test]
fn runs_git_version() {
    let repo = TestRepo::new();
    let out = GitCli::new().run(&repo.root(), &["--version"]).unwrap();
    assert!(out.stdout_str().starts_with("git version"));
}

#[cfg(not(embedded_git))]
#[test]
fn maps_failure_to_git_cli_error() {
    let repo = TestRepo::new();
    let err = GitCli::new()
        .run(&repo.root(), &["rev-parse", "--verify", "nope^{commit}"])
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
    assert!(!err.message.contains('\n'));
    let detail = err.detail.clone().unwrap_or_default();
    assert!(detail.contains(&err.message) || err.message.contains("status"));
}

#[test]
fn run_raw_keeps_exit_code() {
    let repo = TestRepo::new();
    let out = GitCli::new()
        .run_raw(
            &repo.root(),
            &["rev-parse", "--verify", "nope"],
            &CliOptions::default(),
        )
        .unwrap();
    assert!(!out.success());
}

#[cfg(not(embedded_git))]
#[test]
fn stdin_and_stderr_streaming() {
    let repo = TestRepo::new();
    let opts = CliOptions {
        stdin: Some(b"hello\n".to_vec()),
        ..CliOptions::default()
    };
    let out = GitCli::new()
        .run_raw(&repo.root(), &["hash-object", "--stdin"], &opts)
        .unwrap();
    assert_eq!(out.stdout_str().trim().len(), 40);

    let mut lines = Vec::new();
    let out = GitCli::new()
        .run_streaming(
            &repo.root(),
            &["cat-file", "-t", "deadbeef"],
            &CliOptions::default(),
            None,
            &mut |l| lines.push(l.to_string()),
        )
        .unwrap();
    assert!(!out.success());
    assert!(!lines.is_empty());
}

#[cfg(not(embedded_git))]
#[test]
fn missing_executable_is_git_cli_error() {
    let repo = TestRepo::new();
    let err = GitCli::with_path("definitely-not-git-xyz")
        .run(&repo.root(), &["status"])
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::GitCli);
}

#[cfg(not(embedded_git))]
#[cfg(unix)]
#[test]
fn cancels_running_command() {
    let repo = TestRepo::new();
    let registry = OpRegistry::default();
    let handle = registry.register("op-1");
    let reg = registry.clone();
    let killer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        assert!(reg.cancel("op-1"));
    });
    let started = std::time::Instant::now();
    let err = GitCli::new()
        .run_streaming(
            &repo.root(),
            &["-c", "alias.slp=!sleep 5", "slp"],
            &CliOptions::default(),
            Some(&handle),
            &mut |_| {},
        )
        .unwrap_err();
    killer.join().unwrap();
    registry.finish("op-1");
    assert_eq!(err.kind, ErrorKind::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(4));
    assert!(!registry.cancel("op-1"));
}
