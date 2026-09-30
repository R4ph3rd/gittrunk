//! Builds unified-diff patches that contain only selected lines of a file
//! diff. Works on owned, byte-exact data so CRLF content and missing final
//! newlines survive a round trip.

use std::collections::{BTreeMap, HashSet};

use crate::ipc::error::{AppError, AppResult, ErrorKind};
use crate::ipc::types::{ChangeStatus, HunkSelection};

/// Which way the built patch moves the target file relative to the diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Apply the selected changes (target holds the diff's old side).
    Forward,
    /// Undo the selected changes (target holds the diff's new side).
    Reverse,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawLine {
    /// Diff origin: ' ', '+', '-' or '\\' for the "no newline" marker.
    pub origin: char,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct RawHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<RawLine>,
}

#[derive(Debug, Clone)]
pub struct RawFile {
    pub status: ChangeStatus,
    /// Octal file mode string of the side that exists (`100644`, ...).
    pub mode: String,
    pub hunks: Vec<RawHunk>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltPatch {
    pub bytes: Vec<u8>,
    pub hunks: usize,
    pub lines: usize,
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidInput, msg)
}

/// Quotes a path for a diff header the way git does when needed.
fn header_path(prefix: &str, path: &str) -> String {
    let needs_quote = path
        .bytes()
        .any(|b| b == b'"' || b == b'\\' || b == b' ' || b < 0x20 || b == 0x7f);
    if !needs_quote {
        return format!("{prefix}/{path}");
    }
    let mut out = String::from("\"");
    for c in format!("{prefix}/{path}").chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\{:03o}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

type Selected = BTreeMap<usize, Option<HashSet<usize>>>;

/// Normalises a selection into `hunk -> None (all) | Some(line indices)`.
fn normalise(file: &RawFile, selection: &[HunkSelection]) -> AppResult<Selected> {
    let mut map: Selected = BTreeMap::new();
    for sel in selection {
        let h = sel.hunk_index as usize;
        let Some(hunk) = file.hunks.get(h) else {
            return Err(invalid(format!("hunk {h} does not exist")));
        };
        match &sel.lines {
            None => {
                map.insert(h, None);
            }
            Some(lines) => {
                for &l in lines {
                    if l as usize >= hunk.lines.len() {
                        return Err(invalid(format!("line {l} does not exist in hunk {h}")));
                    }
                }
                if let Some(set) = map.entry(h).or_insert_with(|| Some(HashSet::new())) {
                    set.extend(lines.iter().map(|&l| l as usize));
                }
            }
        }
    }
    Ok(map)
}

/// Builds the patch for `selection`, or `None` when it changes nothing.
pub fn build(
    file: &RawFile,
    path: &str,
    dir: Direction,
    selection: &[HunkSelection],
) -> AppResult<Option<BuiltPatch>> {
    let map = normalise(file, selection)?;
    let is_selected = |h: usize, l: usize| match map.get(&h) {
        None => false,
        Some(None) => true,
        Some(Some(set)) => set.contains(&l),
    };

    let mut all_selected = true;
    for (h, hunk) in file.hunks.iter().enumerate() {
        for (l, line) in hunk.lines.iter().enumerate() {
            if matches!(line.origin, '+' | '-') && !is_selected(h, l) {
                all_selected = false;
            }
        }
    }

    let mut body: Vec<u8> = Vec::new();
    let mut delta: i64 = 0;
    let mut hunks = 0;
    let mut changed_lines = 0;
    for (h, hunk) in file.hunks.iter().enumerate() {
        if !map.contains_key(&h) {
            continue;
        }
        let mut segs: Vec<(char, Vec<u8>)> = Vec::new();
        let (mut old, mut new) = (0u32, 0u32);
        let mut changed = 0;
        let mut last_emitted = false;
        for (l, line) in hunk.lines.iter().enumerate() {
            let sel = is_selected(h, l);
            // (emit as, counts on old side, counts on new side)
            let action: Option<(char, bool, bool)> = match (line.origin, dir) {
                (' ', _) => Some((' ', true, true)),
                ('+', Direction::Forward) => sel.then_some(('+', false, true)),
                ('-', Direction::Forward) => Some(if sel {
                    ('-', true, false)
                } else {
                    (' ', true, true)
                }),
                ('+', Direction::Reverse) => Some(if sel {
                    ('-', true, false)
                } else {
                    (' ', true, true)
                }),
                ('-', Direction::Reverse) => sel.then_some(('+', false, true)),
                ('\\', _) => {
                    if let (true, Some(last)) = (last_emitted, segs.last_mut()) {
                        last.1.extend_from_slice(b"\\ No newline at end of file\n");
                    }
                    continue;
                }
                _ => None,
            };
            let Some((emit, on_old, on_new)) = action else {
                last_emitted = false;
                continue;
            };
            if emit != ' ' {
                changed += 1;
            }
            let mut bytes = vec![emit as u8];
            bytes.extend_from_slice(&line.content);
            if !line.content.ends_with(b"\n") {
                bytes.push(b'\n');
            }
            segs.push((emit, bytes));
            old += on_old as u32;
            new += on_new as u32;
            last_emitted = true;
        }
        if changed == 0 {
            continue;
        }
        // Within a run of changes, deletions precede additions.
        let mut out: Vec<u8> = Vec::new();
        let mut i = 0;
        while i < segs.len() {
            if segs[i].0 == ' ' {
                out.extend_from_slice(&segs[i].1);
                i += 1;
                continue;
            }
            let end = segs[i..]
                .iter()
                .position(|s| s.0 == ' ')
                .map_or(segs.len(), |n| i + n);
            for want in ['-', '+'] {
                for seg in segs[i..end].iter().filter(|s| s.0 == want) {
                    out.extend_from_slice(&seg.1);
                }
            }
            i = end;
        }
        // Side of the diff the patch's "old" side corresponds to.
        let (src_start, src_lines) = match dir {
            Direction::Forward => (hunk.old_start, hunk.old_lines),
            Direction::Reverse => (hunk.new_start, hunk.new_lines),
        };
        let old_first = if src_lines == 0 {
            i64::from(src_start) + 1
        } else {
            i64::from(src_start)
        };
        let new_first = old_first + delta;
        let new_start = if new == 0 { new_first - 1 } else { new_first };
        body.extend_from_slice(format!("@@ -{src_start},{old} +{new_start},{new} @@\n").as_bytes());
        body.extend_from_slice(&out);
        delta += i64::from(new) - i64::from(old);
        hunks += 1;
        changed_lines += changed;
    }
    if hunks == 0 {
        return Ok(None);
    }

    let added = matches!(file.status, ChangeStatus::Added | ChangeStatus::Untracked);
    let (old_exists, new_exists) = match dir {
        Direction::Forward => (
            !added,
            !(file.status == ChangeStatus::Deleted && all_selected),
        ),
        Direction::Reverse => (
            file.status != ChangeStatus::Deleted,
            !(added && all_selected),
        ),
    };
    let a = header_path("a", path);
    let b = header_path("b", path);
    let mut bytes = format!("diff --git {a} {b}\n").into_bytes();
    if !old_exists {
        bytes.extend_from_slice(format!("new file mode {}\n", file.mode).as_bytes());
        bytes.extend_from_slice(format!("--- /dev/null\n+++ {b}\n").as_bytes());
    } else if !new_exists {
        bytes.extend_from_slice(format!("deleted file mode {}\n", file.mode).as_bytes());
        bytes.extend_from_slice(format!("--- {a}\n+++ /dev/null\n").as_bytes());
    } else {
        bytes.extend_from_slice(format!("--- {a}\n+++ {b}\n").as_bytes());
    }
    bytes.extend_from_slice(&body);
    Ok(Some(BuiltPatch {
        bytes,
        hunks,
        lines: changed_lines,
    }))
}
