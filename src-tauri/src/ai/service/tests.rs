use mockito::Matcher;
use serde_json::json;

use super::*;
use crate::ai::settings::testing::MemKeys;
use crate::git::fixtures::TestRepo;

const SECRET: &str = "sk-test-secret-123";

struct Env {
    dir: tempfile::TempDir,
    keys: MemKeys,
    state: GitState,
    repo: String,
    _t: TestRepo,
}

/// A repo with one staged file (`SECRET_CONTENT` in the diff).
fn env() -> Env {
    let mut t = TestRepo::new();
    t.write("seed.txt", "seed\n");
    t.commit_all("init");
    t.write("new.txt", "SECRET_CONTENT\n");
    t.stage_all();
    let state = GitState::default();
    let (entry, _) = state.open(&t.root()).unwrap();
    Env {
        dir: tempfile::tempdir().unwrap(),
        keys: MemKeys::default(),
        state,
        repo: entry.id.clone(),
        _t: t,
    }
}

fn configure(env: &Env, enabled: bool, provider: AiProviderKind, base: &str, key: Option<&str>) {
    let mut s = settings::load(env.dir.path(), &env.keys);
    s.enabled = enabled;
    s.provider = provider;
    s.base_url = Some(base.to_string());
    settings::save(env.dir.path(), &env.keys, &s).unwrap();
    if let Some(k) = key {
        env.keys.set(provider, k).unwrap();
    }
}

async fn run_req(env: &Env, request: AiRequest) -> AppResult<AiResponse> {
    run(&env.state, env.dir.path(), &env.keys, &env.repo, &request).await
}

#[tokio::test]
async fn disabled_makes_zero_requests_and_returns_ai_disabled() {
    let mut server = mockito::Server::new_async().await;
    let anthropic = server
        .mock("POST", "/v1/messages")
        .expect(0)
        .create_async()
        .await;
    let openai = server
        .mock("POST", "/chat/completions")
        .expect(0)
        .create_async()
        .await;
    for provider in [AiProviderKind::Anthropic, AiProviderKind::OpenAiCompatible] {
        let e = env();
        configure(&e, false, provider, &server.url(), Some(SECRET));
        let err = run_req(&e, AiRequest::CommitMessage).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::AiDisabled);
        let err = payload_preview(
            &e.state,
            e.dir.path(),
            &e.keys,
            &e.repo,
            &AiRequest::CommitMessage,
        )
        .await
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::AiDisabled);
        let err = run_req(&e, AiRequest::Plan { prompt: "x".into() })
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::AiDisabled);
    }
    anthropic.assert_async().await;
    openai.assert_async().await;
}

#[tokio::test]
async fn preview_is_exactly_what_is_sent() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::Anthropic,
        &server.url(),
        Some(SECRET),
    );
    let preview = payload_preview(
        &e.state,
        e.dir.path(),
        &e.keys,
        &e.repo,
        &AiRequest::CommitMessage,
    )
    .await
    .unwrap();
    assert!(preview.content.contains("SECRET_CONTENT"));
    assert_eq!(preview.files, vec!["new.txt"]);
    // Previewing sends nothing; running sends exactly `preview.content`.
    let m = server
        .mock("POST", "/v1/messages")
        .match_body(Matcher::PartialJson(json!({
            "messages": [{"role": "user", "content": preview.content}]
        })))
        .with_status(200)
        .with_body(
            json!({"content":[{"type":"text","text":"feat: add new"}],"stop_reason":"end_turn"})
                .to_string(),
        )
        .expect(1)
        .create_async()
        .await;
    let out = run_req(&e, AiRequest::CommitMessage).await.unwrap();
    assert_eq!(
        out,
        AiResponse::Text {
            text: "feat: add new".into()
        }
    );
    m.assert_async().await;
}

#[tokio::test]
async fn anthropic_request_shape() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::Anthropic,
        &server.url(),
        Some(SECRET),
    );
    let m = server
        .mock("POST", "/v1/messages")
        .match_header("x-api-key", SECRET)
        .match_header("anthropic-version", "2023-06-01")
        .match_header("content-type", Matcher::Regex("application/json".into()))
        .match_body(Matcher::PartialJson(json!({
            "model": settings::DEFAULT_MODEL,
            "max_tokens": 500
        })))
        .match_body(Matcher::Regex("Conventional Commits".into()))
        .with_status(200)
        .with_body(
            json!({"content":[{"type":"text","text":"```\nfix: thing\n```"}],"stop_reason":"end_turn"})
                .to_string(),
        )
        .create_async()
        .await;
    let out = run_req(&e, AiRequest::CommitMessage).await.unwrap();
    // A wrapping code fence is stripped.
    assert_eq!(
        out,
        AiResponse::Text {
            text: "fix: thing".into()
        }
    );
    m.assert_async().await;
}

#[tokio::test]
async fn openai_request_shape_and_optional_key_on_localhost() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::OpenAiCompatible,
        &server.url(),
        Some(SECRET),
    );
    let with_key = server
        .mock("POST", "/chat/completions")
        .match_header("authorization", format!("Bearer {SECRET}").as_str())
        .match_body(Matcher::PartialJson(json!({
            "model": settings::DEFAULT_MODEL,
            "max_tokens": 500,
            "messages": [{"role": "system"}]
        })))
        .with_status(200)
        .with_body(
            json!({"choices":[{"message":{"role":"assistant","content":"feat: x"}}]}).to_string(),
        )
        .create_async()
        .await;
    let out = run_req(&e, AiRequest::CommitMessage).await.unwrap();
    assert_eq!(
        out,
        AiResponse::Text {
            text: "feat: x".into()
        }
    );
    with_key.assert_async().await;

    // Loopback URL without a key: allowed, and no Authorization header.
    let e2 = env();
    configure(
        &e2,
        true,
        AiProviderKind::OpenAiCompatible,
        &server.url(),
        None,
    );
    let no_key = server
        .mock("POST", "/chat/completions")
        .match_header("authorization", Matcher::Missing)
        .with_status(200)
        .with_body(json!({"choices":[{"message":{"content":"chore: y"}}]}).to_string())
        .create_async()
        .await;
    let out = run_req(&e2, AiRequest::CommitMessage).await.unwrap();
    assert_eq!(
        out,
        AiResponse::Text {
            text: "chore: y".into()
        }
    );
    no_key.assert_async().await;
}

#[tokio::test]
async fn missing_key_is_reported_before_any_request() {
    let mut server = mockito::Server::new_async().await;
    let m = server
        .mock("POST", "/v1/messages")
        .expect(0)
        .create_async()
        .await;
    let e = env();
    configure(&e, true, AiProviderKind::Anthropic, &server.url(), None);
    let err = run_req(&e, AiRequest::CommitMessage).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::AiDisabled);
    m.assert_async().await;
}

#[tokio::test]
async fn provider_errors_carry_the_message_but_no_key_or_diff() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::Anthropic,
        &server.url(),
        Some(SECRET),
    );
    let _m = server
        .mock("POST", "/v1/messages")
        .with_status(401)
        .with_body(json!({"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}).to_string())
        .create_async()
        .await;
    let err = run_req(&e, AiRequest::CommitMessage).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::AiProvider);
    assert!(err.message.contains("invalid x-api-key"));
    assert!(err.message.contains("401"));
    let all = format!("{err:?}");
    assert!(!all.contains(SECRET));
    assert!(!all.contains("SECRET_CONTENT"));

    server.reset();
    let _m = server
        .mock("POST", "/v1/messages")
        .with_status(200)
        .with_body(json!({"content":[],"stop_reason":"end_turn"}).to_string())
        .create_async()
        .await;
    let err = run_req(&e, AiRequest::CommitMessage).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::AiProvider);
}

#[tokio::test]
async fn openai_error_mapping() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::OpenAiCompatible,
        &server.url(),
        Some(SECRET),
    );
    let _m = server
        .mock("POST", "/chat/completions")
        .with_status(429)
        .with_body(json!({"error":{"message":"rate limited"}}).to_string())
        .create_async()
        .await;
    let err = run_req(&e, AiRequest::CommitMessage).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::AiProvider);
    assert!(err.message.contains("rate limited"));
}

#[tokio::test]
async fn plan_flow_parses_validates_stores_and_previews() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::Anthropic,
        &server.url(),
        Some(SECRET),
    );
    let plan_text = json!({
        "explanation": "Create a branch.",
        "steps": [{"description": "Create topic", "command":
            {"kind":"branchCreate","request":{"name":"topic","startPoint":null,"checkout":false}}}]
    })
    .to_string();
    let _m = server
        .mock("POST", "/v1/messages")
        .with_status(200)
        .with_body(
            json!({"content":[{"type":"text","text": format!("```json\n{plan_text}\n```")}]})
                .to_string(),
        )
        .create_async()
        .await;
    let out = run_req(
        &e,
        AiRequest::Plan {
            prompt: "make topic".into(),
        },
    )
    .await
    .unwrap();
    let AiResponse::Plan { plan } = out else {
        panic!("expected a plan");
    };
    assert_eq!(plan.steps.len(), 1);
    assert_eq!(plan.prompt, "make topic");
    assert!(plan.preview.summary.contains("1 step"));

    // Executing needs the plan to still be stored; then only once.
    let exec = |id: &str| {
        crate::ai::plan::execute(&e.state, &e.repo, id, &|| {
            Err(AppError::new(ErrorKind::Internal, "no net"))
        })
    };
    assert!(matches!(exec(&plan.id).unwrap(), OpOutcome::Applied { .. }));
    assert_eq!(exec(&plan.id).unwrap_err().kind, ErrorKind::InvalidInput);
}

#[tokio::test]
async fn a_plan_with_an_invalid_ref_is_rejected_and_not_stored() {
    let mut server = mockito::Server::new_async().await;
    let e = env();
    configure(
        &e,
        true,
        AiProviderKind::Anthropic,
        &server.url(),
        Some(SECRET),
    );
    let plan_text = json!({
        "explanation": "x",
        "steps": [{"description": "Merge", "command":
            {"kind":"merge","request":{"source":"does-not-exist","into":null,"strategy":"auto","message":null}}}]
    })
    .to_string();
    let _m = server
        .mock("POST", "/v1/messages")
        .with_status(200)
        .with_body(json!({"content":[{"type":"text","text": plan_text}]}).to_string())
        .create_async()
        .await;
    let err = run_req(
        &e,
        AiRequest::Plan {
            prompt: "merge it".into(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(err.kind, ErrorKind::RefNotFound);
    assert!(err.message.starts_with("Step 1:"));
}
