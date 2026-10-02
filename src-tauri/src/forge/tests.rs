use std::collections::HashMap;
use std::sync::Mutex;

use mockito::{Matcher, Server, ServerGuard};
use serde_json::json;

use super::github::parse_time;
use super::remote::{detect, parse_url, read_remotes};
use super::tokens::{resolve, ForgeTokens};
use super::*;
use crate::git::fixtures;
use crate::git::remote::keychain::SecretStore;

const SENTINEL: &str = "ghp_SENTINEL_TOKEN_123";
const OID: &str = "0123456789abcdef0123456789abcdef01234567";

#[derive(Default)]
struct MemTokens(Mutex<HashMap<String, String>>);

impl ForgeTokens for MemTokens {
    fn get(&self, host: &str) -> Option<String> {
        self.0.lock().unwrap().get(host).cloned()
    }
    fn set(&self, host: &str, token: &str) -> AppResult<()> {
        self.0.lock().unwrap().insert(host.into(), token.into());
        Ok(())
    }
    fn clear(&self, host: &str) -> AppResult<()> {
        self.0.lock().unwrap().remove(host);
        Ok(())
    }
}

#[derive(Default)]
struct MemSecrets(Mutex<HashMap<(String, String), String>>);

impl SecretStore for MemSecrets {
    fn get(&self, host: &str, user: &str) -> Option<String> {
        let key = (host.to_string(), user.to_string());
        self.0.lock().unwrap().get(&key).cloned()
    }
    fn set(&self, host: &str, user: &str, secret: &str) -> AppResult<()> {
        let key = (host.to_string(), user.to_string());
        self.0.lock().unwrap().insert(key, secret.into());
        Ok(())
    }
    fn delete(&self, host: &str, user: &str) -> AppResult<()> {
        let key = (host.to_string(), user.to_string());
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

fn forge(server: &ServerGuard, token: Option<&str>) -> GithubForge {
    let client = crate::http::client(std::time::Duration::from_secs(5)).unwrap();
    GithubForge::new(
        client,
        &server.url(),
        "octo",
        "repo",
        token.map(str::to_string),
    )
}

fn issue_json(n: u32) -> serde_json::Value {
    json!({
        "number": n, "title": format!("Issue {n}"), "state": "open",
        "user": {"login": "alice"}, "labels": [{"name": "bug"}, {"name": "ui"}],
        "comments": 2, "created_at": "2024-01-02T03:04:05Z",
        "updated_at": "2024-01-03T03:04:05Z",
        "html_url": format!("https://github.com/octo/repo/issues/{n}"),
        "body": null
    })
}

fn comment_json(id: u64, body: &str) -> serde_json::Value {
    json!({"id": id, "user": {"login": "bob"}, "body": body,
        "created_at": "2024-01-02T03:04:05Z",
        "html_url": format!("https://github.com/octo/repo/issues/1#c{id}")})
}

fn query() -> IssueQuery {
    IssueQuery {
        state: IssueStateFilter::Open,
        page: 1,
        per_page: 30,
    }
}

fn assert_no_token(e: &AppError) {
    assert!(!e.message.contains(SENTINEL), "{e:?}");
    assert!(!e.detail.clone().unwrap_or_default().contains(SENTINEL));
}

// ------------------------------------------------------------ detection

#[test]
fn url_parsing_table() {
    let ok = |u: &str| parse_url(u).map(|(h, o, n)| format!("{h}/{o}/{n}"));
    let want = Some("github.com/octo/repo".to_string());
    for url in [
        "https://github.com/octo/repo",
        "https://github.com/octo/repo.git",
        "https://github.com/octo/repo/",
        "https://github.com/octo/repo.git/",
        "https://user:pw@github.com/octo/repo.git",
        "https://GitHub.com/octo/repo",
        "git@github.com:octo/repo.git",
        "git@github.com:octo/repo",
        "ssh://git@github.com/octo/repo.git",
        "ssh://git@github.com:22/octo/repo.git",
    ] {
        assert_eq!(ok(url), want, "{url}");
    }
    assert_eq!(
        ok("https://gitlab.com/g/p.git").as_deref(),
        Some("gitlab.com/g/p")
    );
    assert_eq!(ok("/tmp/some/repo"), None);
    assert_eq!(ok("C:\\repos\\x"), None);
    assert_eq!(ok("https://github.com/octo"), None);
    assert_eq!(ok("https://github.com/octo/re po"), None);
    assert_eq!(ok("https://github.com/a/b/c"), None);
}

#[test]
fn embedded_credentials_do_not_leak() {
    let remotes = vec![(
        "origin".to_string(),
        "https://me:secretpw@github.com/octo/repo.git".to_string(),
    )];
    let repo = detect(&remotes).unwrap();
    assert_eq!(repo.kind, ForgeKind::Github);
    assert_eq!(repo.web_url, "https://github.com/octo/repo");
    assert_eq!(repo.remote, "origin");
    let dump = format!("{repo:?}");
    assert!(!dump.contains("secretpw") && !dump.contains("@"));
}

#[test]
fn origin_is_preferred_then_github_then_gitlab() {
    let r = |n: &str, u: &str| (n.to_string(), u.to_string());
    let both = [
        r("up", "https://github.com/up/repo"),
        r("origin", "https://github.com/me/repo"),
    ];
    assert_eq!(detect(&both).unwrap().owner, "me");
    let no_origin = [
        r("lab", "https://gitlab.com/g/p"),
        r("a", "https://github.com/a/repo"),
        r("b", "https://github.com/b/repo"),
    ];
    assert_eq!(detect(&no_origin).unwrap().owner, "a");
    let lab = [r("x", "/local/path"), r("lab", "https://gitlab.com/g/p")];
    let found = detect(&lab).unwrap();
    assert_eq!(found.kind, ForgeKind::Gitlab);
    assert_eq!(found.remote, "lab");
    assert!(detect(&[r("x", "/local/path"), r("y", "https://example.org/a/b")]).is_none());
}

#[test]
fn reads_remotes_from_a_fixture_repo() {
    let t = fixtures::empty();
    assert!(detect(&read_remotes(&t.repo)).is_none());
    t.repo
        .remote("origin", "git@github.com:octo/repo.git")
        .unwrap();
    t.repo.remote("local", "/tmp/elsewhere").unwrap();
    let remotes = read_remotes(&t.repo);
    assert_eq!(remotes.len(), 2);
    let found = detect(&remotes).unwrap();
    assert_eq!(
        (found.owner.as_str(), found.name.as_str()),
        ("octo", "repo")
    );
}

#[tokio::test]
async fn github_for_requires_a_github_remote() {
    let t = fixtures::empty();
    t.repo
        .remote("origin", "https://gitlab.com/g/p.git")
        .unwrap();
    let state = crate::git::GitState::default();
    let (_, info) = state.open(t.dir.path()).unwrap();
    let err = github_for(&state, &info.id).await.err().unwrap();
    assert_eq!(err.kind, ErrorKind::Unsupported);
    assert_eq!(err.message, "This needs a GitHub remote");
}

// --------------------------------------------------------------- tokens

#[test]
fn token_precedence_forge_then_git_then_none() {
    let tokens = MemTokens::default();
    let git = MemSecrets::default();
    let host = "github.com";
    assert_eq!(resolve(&tokens, &git, host), (None, ForgeTokenSource::None));
    git.set(host, "", "me").unwrap();
    git.set(host, "me", "gitpw").unwrap();
    assert_eq!(
        resolve(&tokens, &git, host),
        (Some("gitpw".into()), ForgeTokenSource::GitCredential)
    );
    tokens.set(host, "forgetok").unwrap();
    assert_eq!(
        resolve(&tokens, &git, host),
        (Some("forgetok".into()), ForgeTokenSource::Forge)
    );
    tokens.clear(host).unwrap();
    tokens.clear(host).unwrap();
    assert_eq!(
        resolve(&tokens, &git, host).1,
        ForgeTokenSource::GitCredential
    );
}

#[tokio::test]
async fn token_set_validates_and_stores() {
    let mut server = Server::new_async().await;
    let ok = server
        .mock("GET", "/user")
        .match_header("authorization", format!("Bearer {SENTINEL}").as_str())
        .with_status(200)
        .with_body(r#"{"login":"alice"}"#)
        .create_async()
        .await;
    let tokens = MemTokens::default();
    let user = set_token(
        &server.url(),
        &tokens,
        "github.com",
        &format!(" {SENTINEL} "),
    )
    .await
    .unwrap();
    assert_eq!(user.login, "alice");
    assert_eq!(tokens.get("github.com").as_deref(), Some(SENTINEL));
    ok.assert_async().await;
}

#[tokio::test]
async fn token_set_rejected_stores_nothing() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/user")
        .with_status(401)
        .with_body(r#"{"message":"Bad credentials"}"#)
        .create_async()
        .await;
    let tokens = MemTokens::default();
    let err = set_token(&server.url(), &tokens, "github.com", SENTINEL)
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::AuthFailed);
    assert_eq!(err.message, "GitHub rejected the token");
    assert_no_token(&err);
    assert_eq!(tokens.get("github.com"), None);
}

#[tokio::test]
async fn token_set_input_validation() {
    let mut server = Server::new_async().await;
    let none = server.mock("GET", "/user").expect(0).create_async().await;
    let tokens = MemTokens::default();
    let e = set_token(&server.url(), &tokens, "gitlab.com", "x")
        .await
        .unwrap_err();
    assert_eq!(e.kind, ErrorKind::Unsupported);
    for bad in ["", "   ", "a b", "a\tb"] {
        let e = set_token(&server.url(), &tokens, "github.com", bad)
            .await
            .unwrap_err();
        assert_eq!(e.kind, ErrorKind::InvalidInput, "{bad:?}");
    }
    none.assert_async().await;
}

// --------------------------------------------------------------- client

#[test]
fn timestamps_parse_to_unix_seconds() {
    assert_eq!(parse_time("2024-01-02T03:04:05Z"), 1_704_164_645.0);
    assert_eq!(parse_time("2024-01-02T04:04:05+01:00"), 1_704_164_645.0);
    assert_eq!(parse_time("garbage"), 0.0);
}

#[tokio::test]
async fn list_issues_filters_pull_requests_and_parses_link() {
    let mut server = Server::new_async().await;
    let mut pr = issue_json(2);
    pr["pull_request"] = json!({"url": "x"});
    let link = format!(
        "<{0}/repos/octo/repo/issues?state=open&per_page=30&page=3>; rel=\"next\", \
         <{0}/repos/octo/repo/issues?per_page=30&page=9>; rel=\"last\"",
        server.url()
    );
    let m = server
        .mock("GET", "/repos/octo/repo/issues")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("state".into(), "open".into()),
            Matcher::UrlEncoded("per_page".into(), "30".into()),
            Matcher::UrlEncoded("page".into(), "2".into()),
            Matcher::UrlEncoded("sort".into(), "updated".into()),
        ]))
        .match_header("accept", "application/vnd.github+json")
        .match_header("x-github-api-version", "2022-11-28")
        .match_header("authorization", Matcher::Missing)
        .with_header("link", &link)
        .with_body(json!([issue_json(1), pr]).to_string())
        .create_async()
        .await;
    let q = IssueQuery { page: 2, ..query() };
    let page = forge(&server, None).list_issues(&q).await.unwrap();
    m.assert_async().await;
    assert_eq!(page.next_page, Some(3));
    assert_eq!(page.items.len(), 1);
    let i = &page.items[0];
    assert_eq!(i.number, 1);
    assert_eq!(i.author.login, "alice");
    assert_eq!(i.labels, vec!["bug", "ui"]);
    assert_eq!(i.comments, 2);
    assert_eq!(i.created_at, 1_704_164_645.0);
    assert_eq!(i.url, "https://github.com/octo/repo/issues/1");
    assert_eq!(i.state, IssueState::Open);
}

#[tokio::test]
async fn list_issues_without_link_has_no_next_page() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/repos/octo/repo/issues")
        .match_query(Matcher::UrlEncoded("per_page".into(), "100".into()))
        .with_body("[]")
        .create_async()
        .await;
    let q = IssueQuery {
        per_page: 500,
        state: IssueStateFilter::Open,
        page: 0,
    };
    let page = forge(&server, None).list_issues(&q).await.unwrap();
    assert!(page.items.is_empty() && page.next_page.is_none());
}

#[tokio::test]
async fn issue_detail_merges_comment_pages() {
    let mut server = Server::new_async().await;
    let mut detail = issue_json(7);
    detail["body"] = json!("hello");
    server
        .mock("GET", "/repos/octo/repo/issues/7")
        .with_body(detail.to_string())
        .create_async()
        .await;
    let link = format!(
        "<{}/repos/octo/repo/issues/7/comments?per_page=100&page=2>; rel=\"next\"",
        server.url()
    );
    server
        .mock("GET", "/repos/octo/repo/issues/7/comments")
        .match_query(Matcher::UrlEncoded("page".into(), "1".into()))
        .with_header("link", &link)
        .with_body(json!([comment_json(1, "one")]).to_string())
        .create_async()
        .await;
    server
        .mock("GET", "/repos/octo/repo/issues/7/comments")
        .match_query(Matcher::UrlEncoded("page".into(), "2".into()))
        .with_body(json!([comment_json(2, "two")]).to_string())
        .create_async()
        .await;
    let d = forge(&server, None).issue(7).await.unwrap();
    assert_eq!(d.body, "hello");
    assert_eq!(d.issue.number, 7);
    let ids: Vec<_> = d.comments.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["1", "2"]);
    assert_eq!(d.comments[1].body, "two");
    assert_eq!(d.comments[0].author.login, "bob");
}

#[tokio::test]
async fn null_body_becomes_empty_and_pull_requests_are_rejected() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/repos/octo/repo/issues/3")
        .with_body(issue_json(3).to_string())
        .create_async()
        .await;
    server
        .mock("GET", "/repos/octo/repo/issues/3/comments")
        .match_query(Matcher::Any)
        .with_body("[]")
        .create_async()
        .await;
    let d = forge(&server, None).issue(3).await.unwrap();
    assert_eq!(d.body, "");
    let mut pr = issue_json(4);
    pr["pull_request"] = json!({});
    server
        .mock("GET", "/repos/octo/repo/issues/4")
        .with_body(pr.to_string())
        .create_async()
        .await;
    let e = forge(&server, None).issue(4).await.unwrap_err();
    assert_eq!(e.kind, ErrorKind::InvalidInput);
    assert_eq!(e.message, "#4 is a pull request");
}

#[tokio::test]
async fn create_issue_sends_json_and_auth() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/repos/octo/repo/issues")
        .match_header("authorization", format!("Bearer {SENTINEL}").as_str())
        .match_body(Matcher::Json(json!({"title": "Hi", "body": "text"})))
        .with_status(201)
        .with_body(issue_json(9).to_string())
        .create_async()
        .await;
    let req = IssueCreateRequest {
        title: "  Hi ".into(),
        body: "text".into(),
    };
    let issue = forge(&server, Some(SENTINEL))
        .create_issue(&req)
        .await
        .unwrap();
    m.assert_async().await;
    assert_eq!(issue.number, 9);
}

#[tokio::test]
async fn comment_issue_sends_json_and_auth() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/repos/octo/repo/issues/5/comments")
        .match_header("authorization", format!("Bearer {SENTINEL}").as_str())
        .match_body(Matcher::Json(json!({"body": "nice"})))
        .with_status(201)
        .with_body(comment_json(77, "nice").to_string())
        .create_async()
        .await;
    let c = forge(&server, Some(SENTINEL))
        .comment_issue(5, "nice")
        .await
        .unwrap();
    m.assert_async().await;
    assert_eq!(c.id, "77");
    assert_eq!(c.created_at, 1_704_164_645.0);
}

#[tokio::test]
async fn commit_comments_read_and_write() {
    let mut server = Server::new_async().await;
    let path = format!("/repos/octo/repo/commits/{OID}/comments");
    server
        .mock("GET", path.as_str())
        .match_query(Matcher::Any)
        .with_body(json!([comment_json(1, "c")]).to_string())
        .create_async()
        .await;
    let post = server
        .mock("POST", path.as_str())
        .match_body(Matcher::Json(json!({"body": "lgtm"})))
        .with_status(201)
        .with_body(comment_json(2, "lgtm").to_string())
        .create_async()
        .await;
    let f = forge(&server, Some(SENTINEL));
    assert_eq!(f.commit_comments(OID).await.unwrap().len(), 1);
    assert_eq!(f.comment_commit(OID, "lgtm").await.unwrap().id, "2");
    post.assert_async().await;
    let e = f.commit_comments("abc").await.unwrap_err();
    assert_eq!(e.kind, ErrorKind::InvalidInput);
}

#[tokio::test]
async fn anonymous_writes_never_reach_the_network() {
    let mut server = Server::new_async().await;
    let post = server
        .mock("POST", Matcher::Any)
        .expect(0)
        .create_async()
        .await;
    let f = forge(&server, None);
    let req = IssueCreateRequest {
        title: "t".into(),
        body: "b".into(),
    };
    let errs = [
        f.create_issue(&req).await.unwrap_err(),
        f.comment_issue(1, "x").await.unwrap_err(),
        f.comment_commit(OID, "x").await.unwrap_err(),
    ];
    for e in errs {
        assert_eq!(e.kind, ErrorKind::AuthRequired);
        assert_eq!(e.message, "Add a GitHub token in Settings > Integrations");
    }
    post.assert_async().await;
}

#[tokio::test]
async fn write_validation() {
    let server = Server::new_async().await;
    let f = forge(&server, Some(SENTINEL));
    let bad = |title: &str, body: &str| IssueCreateRequest {
        title: title.into(),
        body: body.into(),
    };
    for req in [
        bad("   ", "b"),
        bad(&"x".repeat(257), "b"),
        bad("t", &"x".repeat(65_537)),
    ] {
        assert_eq!(
            f.create_issue(&req).await.unwrap_err().kind,
            ErrorKind::InvalidInput
        );
    }
    assert_eq!(
        f.comment_issue(1, "  \n").await.unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert_eq!(
        f.comment_issue(1, &"x".repeat(65_537))
            .await
            .unwrap_err()
            .kind,
        ErrorKind::InvalidInput
    );
}

async fn status_error(
    status: usize,
    headers: &[(&str, &str)],
    body: &str,
    token: Option<&str>,
    path: &str,
) -> AppError {
    let mut server = Server::new_async().await;
    let mut m = server
        .mock("GET", Matcher::Any)
        .with_status(status)
        .with_body(body);
    for (k, v) in headers {
        m = m.with_header(*k, v);
    }
    m.create_async().await;
    let f = forge(&server, token);
    if path.is_empty() {
        f.list_issues(&query()).await.unwrap_err()
    } else {
        f.commit_comments(path).await.unwrap_err()
    }
}

#[tokio::test]
async fn error_mapping() {
    let e = status_error(
        401,
        &[],
        r#"{"message":"Bad credentials"}"#,
        Some(SENTINEL),
        "",
    )
    .await;
    assert_eq!(e.kind, ErrorKind::AuthFailed);
    assert_eq!(e.detail.as_deref(), Some("Bad credentials"));
    assert_no_token(&e);

    let rl = [
        ("x-ratelimit-remaining", "0"),
        ("x-ratelimit-reset", "1704164645"),
    ];
    let e = status_error(403, &rl, "{}", None, "").await;
    assert_eq!(e.kind, ErrorKind::Network);
    assert_eq!(
        e.message,
        "GitHub rate limit reached; resets at 03:04 UTC (add a token for a higher limit)"
    );
    let e = status_error(403, &rl, "{}", Some(SENTINEL), "").await;
    assert_eq!(e.message, "GitHub rate limit reached; resets at 03:04 UTC");
    assert_no_token(&e);

    let e = status_error(403, &[], "{}", Some(SENTINEL), "").await;
    assert_eq!(e.kind, ErrorKind::AuthRequired);
    assert_eq!(e.message, "The token cannot access this repository");

    let e = status_error(404, &[], "{}", None, "").await;
    assert_eq!(e.kind, ErrorKind::AuthRequired);
    assert_eq!(
        e.message,
        "Repository not found or private: add a GitHub token"
    );
    let e = status_error(404, &[], "{}", Some(SENTINEL), "").await;
    assert_eq!(e.kind, ErrorKind::InvalidInput);
    assert_eq!(e.message, "Not found on GitHub");

    let e = status_error(410, &[], "{}", None, "").await;
    assert_eq!(e.kind, ErrorKind::Unsupported);
    assert_eq!(e.message, "Issues are disabled for this repository");

    let e = status_error(422, &[], "{}", Some(SENTINEL), OID).await;
    assert_eq!(e.kind, ErrorKind::InvalidInput);
    assert_eq!(e.message, "This commit is not on GitHub");

    let e = status_error(422, &[], r#"{"message":"Validation Failed"}"#, None, "").await;
    assert_eq!(e.kind, ErrorKind::InvalidInput);
    assert_eq!(e.message, "Validation Failed");

    let e = status_error(500, &[], "oops", None, "").await;
    assert_eq!(e.kind, ErrorKind::Network);
}

#[tokio::test]
async fn transport_errors_do_not_leak_token_or_url() {
    let client = crate::http::client(std::time::Duration::from_secs(2)).unwrap();
    let f = GithubForge::new(
        client,
        "http://127.0.0.1:1",
        "octo",
        "repo",
        Some(SENTINEL.into()),
    );
    let e = f.list_issues(&query()).await.unwrap_err();
    assert_eq!(e.kind, ErrorKind::Network);
    assert_no_token(&e);
    assert!(!e.message.contains("127.0.0.1"));
}

// ---------------------------------------------------------------- pulls

fn pull_json(n: u32) -> serde_json::Value {
    json!({
        "number": n, "title": format!("PR {n}"), "state": "open", "draft": false,
        "merged_at": null,
        "user": {"login": "alice"}, "labels": [{"name": "bug"}],
        "created_at": "2024-01-02T03:04:05Z", "updated_at": "2024-01-03T03:04:05Z",
        "html_url": format!("https://github.com/octo/repo/pull/{n}"),
        "head": {"ref": "feature/x", "label": "octo:feature/x", "sha": OID,
                 "repo": {"full_name": "octo/repo"}},
        "base": {"ref": "main", "label": "octo:main", "sha": OID,
                 "repo": {"full_name": "octo/repo"}},
        "body": null, "commits": 3, "additions": 10, "deletions": 4,
        "changed_files": 2, "mergeable": null
    })
}

fn pull_query() -> PullQuery {
    PullQuery {
        state: PullStateFilter::All,
        page: 2,
        per_page: 500,
    }
}

#[tokio::test]
async fn list_pulls_maps_states_forks_and_next_page() {
    let mut server = Server::new_async().await;
    let mut merged = pull_json(2);
    merged["state"] = json!("closed");
    merged["merged_at"] = json!("2024-01-04T00:00:00Z");
    let mut closed = pull_json(3);
    closed["state"] = json!("closed");
    let mut draft = pull_json(4);
    draft["draft"] = json!(true);
    let mut fork = pull_json(5);
    fork["head"]["repo"] = json!({"full_name": "someone/repo"});
    fork["head"]["label"] = json!("someone:feature/x");
    let mut gone = pull_json(6);
    gone["head"]["repo"] = json!(null);
    let link = format!(
        "<{}/repos/octo/repo/pulls?state=all&per_page=100&page=3>; rel=\"next\"",
        server.url()
    );
    let m = server
        .mock("GET", "/repos/octo/repo/pulls")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("state".into(), "all".into()),
            Matcher::UrlEncoded("per_page".into(), "100".into()),
            Matcher::UrlEncoded("page".into(), "2".into()),
            Matcher::UrlEncoded("sort".into(), "updated".into()),
            Matcher::UrlEncoded("direction".into(), "desc".into()),
        ]))
        .with_header("link", &link)
        .with_body(json!([pull_json(1), merged, closed, draft, fork, gone]).to_string())
        .create_async()
        .await;
    let page = forge(&server, None)
        .list_pulls(&pull_query())
        .await
        .unwrap();
    m.assert_async().await;
    assert_eq!(page.next_page, Some(3));
    let states: Vec<_> = page.items.iter().map(|p| p.state).collect();
    assert_eq!(
        states,
        [
            PullState::Open,
            PullState::Merged,
            PullState::Closed,
            PullState::Open,
            PullState::Open,
            PullState::Open
        ]
    );
    let first = &page.items[0];
    assert_eq!(first.number, 1);
    assert_eq!(first.author.login, "alice");
    assert_eq!(first.labels, vec!["bug"]);
    assert_eq!(first.created_at, 1_704_164_645.0);
    assert_eq!(first.url, "https://github.com/octo/repo/pull/1");
    assert_eq!(first.head.name, "feature/x");
    assert_eq!(first.head.label, "octo:feature/x");
    assert_eq!(first.head.repo.as_deref(), Some("octo/repo"));
    assert_eq!(first.base.name, "main");
    assert!(!first.head.is_fork && !first.base.is_fork);
    assert!(page.items[3].draft && !first.draft);
    assert!(page.items[4].head.is_fork);
    assert!(page.items[5].head.is_fork && page.items[5].head.repo.is_none());
}

#[tokio::test]
async fn pull_detail_has_stats_and_merged_comments() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/repos/octo/repo/pulls/7")
        .with_body(pull_json(7).to_string())
        .create_async()
        .await;
    let link = format!(
        "<{}/repos/octo/repo/issues/7/comments?per_page=100&page=2>; rel=\"next\"",
        server.url()
    );
    server
        .mock("GET", "/repos/octo/repo/issues/7/comments")
        .match_query(Matcher::UrlEncoded("page".into(), "1".into()))
        .with_header("link", &link)
        .with_body(json!([comment_json(1, "one")]).to_string())
        .create_async()
        .await;
    server
        .mock("GET", "/repos/octo/repo/issues/7/comments")
        .match_query(Matcher::UrlEncoded("page".into(), "2".into()))
        .with_body(json!([comment_json(2, "two")]).to_string())
        .create_async()
        .await;
    let d = forge(&server, None).pull(7).await.unwrap();
    assert_eq!(d.pull.number, 7);
    assert_eq!(d.body, "");
    assert_eq!(
        (d.commits, d.additions, d.deletions, d.changed_files),
        (3, 10, 4, 2)
    );
    assert_eq!(d.mergeable, None);
    let ids: Vec<_> = d.comments.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["1", "2"]);
}

#[tokio::test]
async fn pull_detail_mergeable_and_large_counts() {
    let mut server = Server::new_async().await;
    let mut v = pull_json(8);
    v["body"] = json!("text");
    v["mergeable"] = json!(true);
    v["additions"] = json!(u64::MAX);
    v.as_object_mut().unwrap().remove("changed_files");
    server
        .mock("GET", "/repos/octo/repo/pulls/8")
        .with_body(v.to_string())
        .create_async()
        .await;
    server
        .mock("GET", "/repos/octo/repo/issues/8/comments")
        .match_query(Matcher::Any)
        .with_body("[]")
        .create_async()
        .await;
    let d = forge(&server, None).pull(8).await.unwrap();
    assert_eq!(d.body, "text");
    assert_eq!(d.mergeable, Some(true));
    assert_eq!(d.additions, u32::MAX);
    assert_eq!(d.changed_files, 0);
}

#[tokio::test]
async fn comment_pull_requires_a_token_and_posts_json() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/repos/octo/repo/issues/5/comments")
        .match_header("authorization", format!("Bearer {SENTINEL}").as_str())
        .match_body(Matcher::Json(json!({"body": "lgtm"})))
        .with_status(201)
        .with_body(comment_json(78, "lgtm").to_string())
        .expect(1)
        .create_async()
        .await;
    let err = forge(&server, None)
        .comment_pull(5, "lgtm")
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::AuthRequired);
    let c = forge(&server, Some(SENTINEL))
        .comment_pull(5, "lgtm")
        .await
        .unwrap();
    m.assert_async().await;
    assert_eq!(c.id, "78");
    let err = forge(&server, Some(SENTINEL))
        .comment_pull(5, "  ")
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

#[tokio::test]
async fn pull_errors_never_contain_the_token() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/repos/octo/repo/pulls/9")
        .with_status(401)
        .with_body(json!({"message": "Bad credentials"}).to_string())
        .create_async()
        .await;
    let err = forge(&server, Some(SENTINEL)).pull(9).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::AuthFailed);
    assert_no_token(&err);
}

// -------------------------------------------------------- notifications

fn notification_json(id: &str, kind: &str, url: Option<&str>) -> serde_json::Value {
    json!({
        "id": id, "unread": true, "reason": "mention",
        "updated_at": "2024-01-02T03:04:05Z",
        "subject": {"title": format!("T{id}"), "type": kind, "url": url},
        "repository": {"full_name": "octo/repo"}
    })
}

fn http_client() -> reqwest::Client {
    crate::http::client(std::time::Duration::from_secs(5)).unwrap()
}

#[tokio::test]
async fn notifications_without_token_make_no_request() {
    let mut server = Server::new_async().await;
    let m = server
        .mock("GET", "/notifications")
        .match_query(Matcher::Any)
        .expect(0)
        .create_async()
        .await;
    for token in [None, Some("")] {
        let err = notifications::list(&http_client(), &server.url(), token)
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::AuthRequired);
    }
    m.assert_async().await;
}

#[tokio::test]
async fn notifications_are_mapped() {
    let mut server = Server::new_async().await;
    let api = |p: &str| format!("https://api.github.com/repos/octo/repo/{p}");
    let m = server
        .mock("GET", "/notifications")
        .match_query(Matcher::UrlEncoded("per_page".into(), "50".into()))
        .match_header("authorization", format!("Bearer {SENTINEL}").as_str())
        .match_header("accept", "application/vnd.github+json")
        .with_body(
            json!([
                notification_json("1", "PullRequest", Some(&api("pulls/12"))),
                notification_json("2", "Release", None)
            ])
            .to_string(),
        )
        .create_async()
        .await;
    let list = notifications::list(&http_client(), &server.url(), Some(SENTINEL))
        .await
        .unwrap();
    m.assert_async().await;
    assert_eq!(list.len(), 2);
    let n = &list[0];
    assert_eq!(
        (n.id.as_str(), n.title.as_str(), n.kind.as_str()),
        ("1", "T1", "PullRequest")
    );
    assert_eq!(
        (n.reason.as_str(), n.repo.as_str()),
        ("mention", "octo/repo")
    );
    assert!(n.unread);
    assert_eq!(n.updated_at, 1_704_164_645.0);
    assert_eq!(
        n.url.as_deref(),
        Some("https://github.com/octo/repo/pull/12")
    );
    assert_eq!(list[1].url.as_deref(), Some("https://github.com/octo/repo"));
}

#[tokio::test]
async fn notifications_error_mapping() {
    let mut server = Server::new_async().await;
    for (status, kind, text) in [
        (401, ErrorKind::AuthFailed, "GitHub rejected the token"),
        (403, ErrorKind::Unsupported, "classic token"),
        (500, ErrorKind::Network, "HTTP 500"),
    ] {
        let m = server
            .mock("GET", "/notifications")
            .match_query(Matcher::Any)
            .with_status(status)
            .with_body(json!({"message": "nope"}).to_string())
            .create_async()
            .await;
        let err = notifications::list(&http_client(), &server.url(), Some(SENTINEL))
            .await
            .unwrap_err();
        assert_eq!(err.kind, kind);
        assert!(err.message.contains(text), "{err:?}");
        assert_no_token(&err);
        m.remove_async().await;
    }
}

#[test]
fn notification_web_url_table() {
    let api = "https://api.github.com/repos/octo/repo";
    let ghe = "https://ghe.example.com/api/v3/repos/octo/repo";
    let w = |url: Option<&str>, kind: &str, repo: &str| notifications::web_url(url, kind, repo);
    let page = Some("https://github.com/octo/repo".to_string());
    let sha = "0123456789abcdef0123456789abcdef01234567";
    assert_eq!(
        w(Some(&format!("{api}/pulls/12")), "PullRequest", "octo/repo").as_deref(),
        Some("https://github.com/octo/repo/pull/12")
    );
    assert_eq!(
        w(Some(&format!("{ghe}/issues/3")), "Issue", "octo/repo").as_deref(),
        Some("https://github.com/octo/repo/issues/3")
    );
    assert_eq!(
        w(Some(&format!("{api}/commits/{sha}")), "Commit", "octo/repo").as_deref(),
        Some(format!("https://github.com/octo/repo/commit/{sha}").as_str())
    );
    // Releases, discussions and unknown subjects fall back to the repository page.
    assert_eq!(
        w(Some(&format!("{api}/releases/9")), "Release", "octo/repo"),
        page
    );
    assert_eq!(w(None, "Discussion", "octo/repo"), page);
    assert_eq!(w(Some("https://example.com/x"), "Issue", "octo/repo"), page);
    // Invalid segments fall back to the repository page.
    for bad in [
        format!("{api}/pulls/abc"),
        format!("{api}/pulls/1x"),
        format!("{api}/pulls/"),
        format!("{api}/commits/zzzzzzz"),
        format!("{api}/commits/abc"),
        "https://api.github.com/repos/o%2Fx/repo/pulls/1".to_string(),
        "https://api.github.com/repos/../repo/pulls/1".to_string(),
        "https://api.github.com/repos/oct o/repo/pulls/1".to_string(),
    ] {
        assert_eq!(w(Some(&bad), "PullRequest", "octo/repo"), page, "{bad}");
    }
    // A bad repository name yields nothing; the result is always on github.com.
    assert_eq!(w(None, "Issue", "../evil"), None);
    assert_eq!(w(None, "Issue", "a/b/c"), None);
    assert_eq!(w(None, "Issue", ""), None);
}
