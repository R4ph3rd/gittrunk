//! Integrated terminal (PTY sessions).
//!
//! Pure helpers live here; the `portable_pty` backed sessions live in
//! `session.rs`, which does not exist on Android.
#![cfg_attr(target_os = "android", allow(dead_code))]

#[cfg(not(target_os = "android"))]
mod session;
#[cfg(not(target_os = "android"))]
pub use session::Terminals;

/// Open terminal sessions (none on Android).
#[cfg(target_os = "android")]
#[derive(Default)]
pub struct Terminals {}

/// Maximum number of live sessions.
pub const MAX_SESSIONS: usize = 16;

/// Event produced by a session's reader thread.
#[derive(Debug, Clone, PartialEq)]
pub enum TermEvent {
    Output { id: String, data: String },
    Exit { id: String, code: Option<i32> },
}

/// Callback receiving session events (the command wires it to Tauri events).
pub type EmitFn = std::sync::Arc<dyn Fn(TermEvent) + Send + Sync>;

pub fn clamp_cols(cols: u32) -> u16 {
    cols.clamp(2, 1000) as u16
}

pub fn clamp_rows(rows: u32) -> u16 {
    rows.clamp(1, 500) as u16
}

fn on_path(env: &impl Fn(&str) -> Option<String>, os: &str, file: &str) -> bool {
    let Some(path) = env("PATH").or_else(|| env("Path")) else {
        return false;
    };
    let sep = if os == "windows" { ';' } else { ':' };
    path.split(sep)
        .filter(|d| !d.is_empty())
        .any(|d| std::path::Path::new(d).join(file).is_file())
}

/// Program and arguments of the shell to run for `os` ("windows" or unix-like).
pub fn shell_command(env: &impl Fn(&str) -> Option<String>, os: &str) -> (String, Vec<String>) {
    if os == "windows" {
        if on_path(env, os, "pwsh.exe") {
            return ("pwsh.exe".into(), vec!["-NoLogo".into()]);
        }
        if on_path(env, os, "powershell.exe") {
            return ("powershell.exe".into(), vec!["-NoLogo".into()]);
        }
        let comspec = env("COMSPEC")
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| "cmd.exe".into());
        return (comspec, Vec::new());
    }
    let shell = env("SHELL")
        .filter(|s| s.starts_with('/'))
        .unwrap_or_else(|| "/bin/sh".into());
    let base = shell.rsplit('/').next().unwrap_or("");
    let args = if matches!(base, "sh" | "bash" | "zsh" | "fish" | "ksh" | "dash") {
        vec!["-l".to_string()]
    } else {
        Vec::new()
    };
    (shell, args)
}

/// Decodes a byte stream into UTF-8 strings, carrying an incomplete trailing
/// sequence to the next chunk and replacing invalid bytes with U+FFFD.
#[derive(Default)]
pub struct Utf8Carry {
    pending: Vec<u8>,
}

impl Utf8Carry {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        let mut rest: &[u8] = &self.pending;
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    out.push_str(s);
                    rest = &[];
                    break;
                }
                Err(e) => {
                    let (valid, after) = rest.split_at(e.valid_up_to());
                    out.push_str(&String::from_utf8_lossy(valid));
                    match e.error_len() {
                        Some(n) => {
                            out.push('\u{FFFD}');
                            rest = &after[n..];
                        }
                        None => {
                            rest = after;
                            break;
                        }
                    }
                }
            }
        }
        self.pending = rest.to_vec();
        out
    }

    /// Flushes an incomplete sequence at end of stream.
    pub fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            String::new()
        } else {
            self.pending.clear();
            "\u{FFFD}".into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned()
    }

    #[test]
    fn unix_shell_table() {
        let login = vec!["-l".to_string()];
        type Case<'a> = (Vec<(&'a str, &'a str)>, &'a str, Vec<String>);
        let cases: Vec<Case> = vec![
            (vec![("SHELL", "/bin/zsh")], "/bin/zsh", login.clone()),
            (
                vec![("SHELL", "/usr/bin/fish")],
                "/usr/bin/fish",
                login.clone(),
            ),
            (vec![("SHELL", "/bin/bash")], "/bin/bash", login.clone()),
            (vec![("SHELL", "/usr/bin/nu")], "/usr/bin/nu", vec![]),
            (vec![("SHELL", "zsh")], "/bin/sh", login.clone()),
            (vec![("SHELL", "")], "/bin/sh", login.clone()),
            (vec![], "/bin/sh", login),
        ];
        for (env, prog, args) in cases {
            let (p, a) = shell_command(&env_of(&env), "linux");
            assert_eq!((p.as_str(), a), (prog, args), "{env:?}");
        }
        assert_eq!(shell_command(&env_of(&[]), "macos").0, "/bin/sh");
    }

    #[test]
    fn windows_shell_table() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        let args = vec!["-NoLogo".to_string()];
        let env = env_of(&[("PATH", &path), ("COMSPEC", "C:\\cmd.exe")]);
        assert_eq!(
            shell_command(&env, "windows"),
            ("C:\\cmd.exe".to_string(), vec![])
        );
        assert_eq!(
            shell_command(&env_of(&[]), "windows"),
            ("cmd.exe".to_string(), vec![])
        );
        std::fs::write(dir.path().join("powershell.exe"), b"").unwrap();
        assert_eq!(
            shell_command(&env, "windows"),
            ("powershell.exe".to_string(), args.clone())
        );
        std::fs::write(dir.path().join("pwsh.exe"), b"").unwrap();
        assert_eq!(
            shell_command(&env, "windows"),
            ("pwsh.exe".to_string(), args)
        );
    }

    #[test]
    fn clamps() {
        assert_eq!(
            (clamp_cols(0), clamp_cols(80), clamp_cols(5000)),
            (2, 80, 1000)
        );
        assert_eq!(
            (clamp_rows(0), clamp_rows(24), clamp_rows(9999)),
            (1, 24, 500)
        );
    }

    #[test]
    fn utf8_carry_splits_sequences() {
        for s in ["é", "€", "😀"] {
            let b = s.as_bytes();
            for cut in 1..b.len() {
                let mut d = Utf8Carry::default();
                assert_eq!(d.push(&b[..cut]), "", "{s} cut {cut}");
                assert_eq!(d.push(&b[cut..]), s);
                assert_eq!(d.finish(), "");
            }
        }
        let mut d = Utf8Carry::default();
        assert_eq!(d.push(b"ab\xffcd\xe2\x82"), "ab\u{FFFD}cd");
        assert_eq!(d.push(b"\xac!"), "€!");
        let mut d = Utf8Carry::default();
        assert_eq!(d.push(b"x\xe2\x82"), "x");
        assert_eq!(d.finish(), "\u{FFFD}");
    }
}
