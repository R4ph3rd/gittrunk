//! Shared HTTP client for forge and avatar requests. Nothing here logs.

use std::sync::OnceLock;
use std::time::Duration;

use crate::ipc::error::{AppError, AppResult, ErrorKind};

pub const USER_AGENT: &str = concat!("gittrunk/", env!("CARGO_PKG_VERSION"));
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// rustls with the ring provider installed once; under `embedded_git` the bundled
/// webpki roots (same reasoning as `ai::provider::build_client`); connect timeout 10 s;
/// `timeout` per request; errors map to `ErrorKind::Network` without echoing URLs.
pub fn client(timeout: Duration) -> AppResult<reqwest::Client> {
    static PROVIDER: OnceLock<()> = OnceLock::new();
    PROVIDER.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    let builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout);
    #[cfg(embedded_git)]
    let builder = {
        let roots = rustls::RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let tls = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        builder.use_preconfigured_tls(tls)
    };
    builder
        .build()
        .map_err(|_| AppError::new(ErrorKind::Network, "could not create HTTP client"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn requests_carry_the_user_agent() {
        let mut server = mockito::Server::new_async().await;
        let expected = format!("gittrunk/{}", env!("CARGO_PKG_VERSION"));
        let mock = server
            .mock("GET", "/ping")
            .match_header("user-agent", expected.as_str())
            .with_status(200)
            .create_async()
            .await;
        let client = client(Duration::from_secs(5)).unwrap();
        let resp = client
            .get(format!("{}/ping", server.url()))
            .send()
            .await
            .unwrap();
        assert!(resp.status().is_success());
        mock.assert_async().await;
    }
}
