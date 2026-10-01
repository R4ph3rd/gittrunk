//! Maps an avatar subject to a cache key and a request URL.

use sha2::{Digest, Sha256};

use super::cache::hex;
use crate::ipc::types::{AvatarMode, AvatarSubject};

const NOREPLY_DOMAIN: &str = "users.noreply.github.com";
const MAX_EMAIL: usize = 254;

/// Base URLs of the avatar providers (injectable for tests).
#[derive(Debug, Clone)]
pub struct Sources {
    pub github_avatars: String,
    pub github_web: String,
    pub gravatar: String,
}

impl Default for Sources {
    fn default() -> Self {
        Self {
            github_avatars: "https://avatars.githubusercontent.com".into(),
            github_web: "https://github.com".into(),
            gravatar: "https://www.gravatar.com".into(),
        }
    }
}

/// `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`
fn valid_login(login: &str) -> bool {
    let b = login.as_bytes();
    !b.is_empty()
        && b.len() <= 39
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
}

fn normalize_email(email: &str) -> Option<String> {
    let e = email.trim().to_lowercase();
    let mut parts = e.split('@');
    let (local, domain) = (parts.next()?, parts.next()?);
    if parts.next().is_some() || local.is_empty() || domain.is_empty() || e.len() > MAX_EMAIL {
        return None;
    }
    Some(e)
}

/// `(cache key, url)`, or `None` when the subject gets no avatar in this mode
/// (invalid input, or a non-GitHub email without Gravatar).
pub(super) fn resolve(
    sources: &Sources,
    mode: AvatarMode,
    subject: &AvatarSubject,
    size: u32,
) -> Option<(String, String)> {
    match subject {
        AvatarSubject::GithubLogin { login } => {
            let login = login.trim();
            valid_login(login).then(|| {
                (
                    format!("github:{}", login.to_lowercase()),
                    format!("{}/{login}.png?size={size}", sources.github_web),
                )
            })
        }
        AvatarSubject::Email { email } => {
            let email = normalize_email(email)?;
            let (local, domain) = email.split_once('@')?;
            let key = format!("email:{email}");
            if domain == NOREPLY_DOMAIN {
                let url = match local.split_once('+') {
                    Some((id, login))
                        if !id.is_empty()
                            && id.bytes().all(|b| b.is_ascii_digit())
                            && valid_login(login) =>
                    {
                        format!("{}/u/{id}?s={size}&v=4", sources.github_avatars)
                    }
                    None if valid_login(local) => {
                        format!("{}/{local}.png?size={size}", sources.github_web)
                    }
                    _ => return None,
                };
                return Some((key, url));
            }
            if mode != AvatarMode::GithubAndGravatar {
                return None;
            }
            let hash = hex(&Sha256::digest(email.as_bytes()));
            Some((
                key,
                format!("{}/avatar/{hash}?s={size}&d=404", sources.gravatar),
            ))
        }
    }
}
