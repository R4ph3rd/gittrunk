//! Parser for the `--progress` lines git writes to stderr.

/// One parsed progress line.
#[derive(Debug, Clone, PartialEq)]
pub struct Progress {
    pub phase: String,
    /// 0..=100, when the line carries a percentage.
    pub percent: Option<f64>,
    pub message: String,
}

const PHASES: [&str; 8] = [
    "Enumerating objects",
    "Counting objects",
    "Compressing objects",
    "Receiving objects",
    "Resolving deltas",
    "Writing objects",
    "Unpacking objects",
    "Updating files",
];

/// Parses e.g. `Receiving objects:  45% (9/20), 1.2 MiB | 3 MiB/s` or
/// `remote: Counting objects: 100% (5/5), done.`; `None` for other lines.
pub fn parse_progress(line: &str) -> Option<Progress> {
    let line = line.trim();
    let line = line.strip_prefix("remote:").unwrap_or(line).trim();
    if let Some(rest) = line.strip_prefix("Cloning into") {
        return Some(Progress {
            phase: "Cloning".into(),
            percent: None,
            message: format!("Cloning into{rest}"),
        });
    }
    let (phase, rest) = line.split_once(':')?;
    let phase = PHASES.iter().find(|p| **p == phase.trim())?;
    let rest = rest.trim();
    let percent = rest.split_once('%').and_then(|(num, _)| {
        num.trim()
            .parse::<f64>()
            .ok()
            .filter(|p| (0.0..=100.0).contains(p))
    });
    Some(Progress {
        phase: (*phase).to_string(),
        percent,
        message: rest.to_string(),
    })
}
