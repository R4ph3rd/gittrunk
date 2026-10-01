use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

use super::*;
use crate::avatars::cache;

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];

fn sources(server: &mockito::ServerGuard) -> Sources {
    Sources {
        github_avatars: format!("{}/ga", server.url()),
        github_web: format!("{}/gw", server.url()),
        gravatar: format!("{}/gr", server.url()),
    }
}

fn email(e: &str) -> AvatarSubject {
    AvatarSubject::Email { email: e.into() }
}

fn login(l: &str) -> AvatarSubject {
    AvatarSubject::GithubLogin { login: l.into() }
}

fn png_url() -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(PNG);
    format!("data:image/png;base64,{b64}")
}

async fn run(
    cache: &AvatarCache,
    dir: Option<&Path>,
    mode: AvatarMode,
    src: &Sources,
    subjects: &[AvatarSubject],
) -> Vec<Option<String>> {
    let http = crate::http::client(Duration::from_secs(5)).unwrap();
    cache.get_many(&http, dir, mode, src, subjects, 64).await
}

#[tokio::test]
async fn noreply_with_id_uses_the_avatar_host() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/ga/u/1234?s=64&v=4")
        .with_header("content-type", "image/png")
        .with_body(PNG)
        .expect(1)
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::Github,
        &sources(&server),
        &[email("1234+Octo-Cat@users.noreply.github.com")],
    )
    .await;
    assert_eq!(out, vec![Some(png_url())]);
    m.assert_async().await;
}

#[tokio::test]
async fn noreply_login_and_login_subject_use_the_png_url() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/gw/octo.png?size=64")
        .with_header("content-type", "image/png; charset=binary")
        .with_body(PNG)
        .expect(2)
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::Github,
        &sources(&server),
        &[email("octo@users.noreply.github.com"), login("octo")],
    )
    .await;
    // Different cache keys, same URL: two requests.
    assert_eq!(out, vec![Some(png_url()), Some(png_url())]);
    m.assert_async().await;
}

#[tokio::test]
async fn gravatar_hash_is_sha256_of_the_normalized_email() {
    let mut server = mockito::Server::new_async().await;
    let hash = cache::hex(&Sha256::digest(b"dev@example.com"));
    let m = server
        .mock("GET", format!("/gr/avatar/{hash}?s=64&d=404").as_str())
        .with_header("content-type", "image/jpeg")
        .with_body(PNG)
        .expect(1)
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::GithubAndGravatar,
        &sources(&server),
        &[email("  Dev@Example.COM ")],
    )
    .await;
    assert!(out[0]
        .as_deref()
        .unwrap()
        .starts_with("data:image/jpeg;base64,"));
    m.assert_async().await;
}

#[tokio::test]
async fn off_makes_no_request_and_touches_no_disk() {
    let mut server = mockito::Server::new_async().await;
    let any = server
        .mock("GET", mockito::Matcher::Any)
        .expect(0)
        .create_async()
        .await;
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("avatars");
    let out = run(
        &AvatarCache::default(),
        Some(&dir),
        AvatarMode::Off,
        &sources(&server),
        &[email("a@users.noreply.github.com"), login("octo")],
    )
    .await;
    assert_eq!(out, vec![None, None]);
    assert!(!dir.exists());
    any.assert_async().await;
}

#[tokio::test]
async fn github_mode_never_calls_gravatar() {
    let mut server = mockito::Server::new_async().await;
    let gr = server
        .mock("GET", mockito::Matcher::Regex("^/gr/".into()))
        .expect(0)
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::Github,
        &sources(&server),
        &[email("dev@example.com")],
    )
    .await;
    assert_eq!(out, vec![None]);
    gr.assert_async().await;
}

#[tokio::test]
async fn not_found_is_cached_on_disk_and_not_requested_again() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/gw/ghost.png?size=64")
        .with_status(404)
        .expect(1)
        .create_async()
        .await;
    let tmp = tempfile::tempdir().unwrap();
    let src = sources(&server);
    let first = AvatarCache::default();
    let s = [login("ghost")];
    assert_eq!(
        run(&first, Some(tmp.path()), AvatarMode::Github, &src, &s).await,
        vec![None]
    );
    let file = cache::path(tmp.path(), "github:ghost", 64);
    assert_eq!(std::fs::read(&file).unwrap(), b"");
    // Second call through a fresh in-memory cache: served from disk.
    let second = AvatarCache::default();
    assert_eq!(
        run(&second, Some(tmp.path()), AvatarMode::Github, &src, &s).await,
        vec![None]
    );
    m.assert_async().await;
}

#[tokio::test]
async fn server_errors_are_not_cached() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/gw/flaky.png?size=64")
        .with_status(500)
        .expect(2)
        .create_async()
        .await;
    let tmp = tempfile::tempdir().unwrap();
    let src = sources(&server);
    let c = AvatarCache::default();
    let s = [login("flaky")];
    for _ in 0..2 {
        assert_eq!(
            run(&c, Some(tmp.path()), AvatarMode::Github, &src, &s).await,
            vec![None]
        );
    }
    assert!(!cache::path(tmp.path(), "github:flaky", 64).exists());
    m.assert_async().await;
}

#[tokio::test]
async fn hits_are_cached_to_disk_and_reused() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/gw/Octo.png?size=64")
        .with_header("content-type", "image/png")
        .with_body(PNG)
        .expect(1)
        .create_async()
        .await;
    let tmp = tempfile::tempdir().unwrap();
    let src = sources(&server);
    let s = [login("Octo")];
    run(
        &AvatarCache::default(),
        Some(tmp.path()),
        AvatarMode::Github,
        &src,
        &s,
    )
    .await;
    let out = run(
        &AvatarCache::default(),
        Some(tmp.path()),
        AvatarMode::Github,
        &src,
        &s,
    )
    .await;
    assert_eq!(out, vec![Some(png_url())]);
    m.assert_async().await;
}

#[tokio::test]
async fn non_image_content_type_is_rejected() {
    let mut server = mockito::Server::new_async().await;
    server
        .mock("GET", "/gw/octo.png?size=64")
        .with_header("content-type", "text/html")
        .with_body("<html>")
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::Github,
        &sources(&server),
        &[login("octo")],
    )
    .await;
    assert_eq!(out, vec![None]);
}

#[tokio::test]
async fn oversized_body_is_rejected() {
    let mut server = mockito::Server::new_async().await;
    server
        .mock("GET", "/gw/octo.png?size=64")
        .with_header("content-type", "image/png")
        .with_body(vec![0u8; MAX_BODY + 1])
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::Github,
        &sources(&server),
        &[login("octo")],
    )
    .await;
    assert_eq!(out, vec![None]);
}

#[tokio::test]
async fn duplicate_subjects_are_fetched_once() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/gw/octo.png?size=64")
        .with_header("content-type", "image/png")
        .with_body(PNG)
        .expect(1)
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::Github,
        &sources(&server),
        &[login("octo"), login("OCTO"), login("octo")],
    )
    .await;
    assert_eq!(out, vec![Some(png_url()); 3]);
    m.assert_async().await;
}

#[tokio::test]
async fn invalid_subjects_get_none_without_a_request() {
    let mut server = mockito::Server::new_async().await;
    let any = server
        .mock("GET", mockito::Matcher::Any)
        .expect(0)
        .create_async()
        .await;
    let out = run(
        &AvatarCache::default(),
        None,
        AvatarMode::GithubAndGravatar,
        &sources(&server),
        &[
            login("dependabot[bot]"),
            login("-lead"),
            login(&"a".repeat(40)),
            login("a/../b"),
            email("not-an-email"),
            email("a@b@c"),
            email(&format!("{}@example.com", "x".repeat(250))),
            email("12+bot[bot]@users.noreply.github.com"),
        ],
    )
    .await;
    assert_eq!(out, vec![None; 8]);
    any.assert_async().await;
}

#[test]
fn freshness_windows() {
    let tmp = tempfile::tempdir().unwrap();
    let hit = tmp.path().join("hit");
    let miss = tmp.path().join("miss");
    std::fs::write(&hit, "data:image/png;base64,AA").unwrap();
    std::fs::write(&miss, "").unwrap();
    let now = SystemTime::now();
    let day = Duration::from_secs(24 * 3600);
    assert!(cache::read_disk(&hit, now).is_some());
    assert!(cache::read_disk(&hit, now + 6 * day).is_some());
    assert!(cache::read_disk(&hit, now + 8 * day).is_none());
    assert_eq!(cache::read_disk(&miss, now), Some(None));
    assert!(cache::read_disk(&miss, now + 2 * day).is_none());
}

#[tokio::test]
async fn unwritable_cache_dir_degrades_to_memory_only() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("GET", "/gw/octo.png?size=64")
        .with_header("content-type", "image/png")
        .with_body(PNG)
        .expect(1)
        .create_async()
        .await;
    let tmp = tempfile::tempdir().unwrap();
    let blocker = tmp.path().join("file");
    std::fs::write(&blocker, "x").unwrap();
    let c = AvatarCache::default();
    let src = sources(&server);
    let s = [login("octo")];
    let dir = blocker.join("avatars");
    run(&c, Some(&dir), AvatarMode::Github, &src, &s).await;
    let out = run(&c, Some(&dir), AvatarMode::Github, &src, &s).await;
    assert_eq!(out, vec![Some(png_url())]);
    m.assert_async().await;
}
