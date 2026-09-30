//! `git log --follow [--no-color] [-n<N>] [--name-status] [--format=...]
//! [<rev>] -- <path>`: the single-file history query of the file history
//! view. Anything else (`log` without `--follow`, graphs, several paths,
//! unknown options) is unsupported.
//!
//! Known divergences from git: commits are walked newest-commit-time first
//! with a per-commit TREESAME test (a merge that is TREESAME to a parent
//! follows only that parent, others are shown without a diff), rename
//! detection is libgit2's (default 50% similarity, renames only) and is run
//! only for commits that add the followed path, and only the placeholders
//! `%H %h %an %ae %at %cn %ce %ct %s %n %%` of `--format` are expanded.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};

use git2::{Delta, Diff, DiffFindOptions, DiffOptions, Oid, Repository, Tree};

use super::{fail, ok, split_dashdash, unsupported, AppResult, Ctx, Res};

struct Opts {
    limit: Option<usize>,
    name_status: bool,
    format: Option<String>,
}

pub fn run(ctx: &Ctx, args: &[String]) -> Res {
    let (flags, paths) = split_dashdash(args);
    let mut o = Opts {
        limit: None,
        name_status: false,
        format: None,
    };
    let mut follow = false;
    let mut revs: Vec<&String> = Vec::new();
    let mut it = flags.iter();
    while let Some(raw) = it.next() {
        let a = raw.as_str();
        match a {
            "--follow" => follow = true,
            "--no-color" | "--no-decorate" | "--no-abbrev-commit" => {}
            "--name-status" => o.name_status = true,
            "-n" | "--max-count" => match it.next().and_then(|v| v.parse::<usize>().ok()) {
                Some(n) => o.limit = Some(n),
                None => return Ok(fail(128, "fatal: -n requires a number")),
            },
            _ if a.starts_with("--format=") || a.starts_with("--pretty=format:") => {
                o.format = Some(
                    a.trim_start_matches("--format=")
                        .trim_start_matches("--pretty=format:")
                        .to_string(),
                );
            }
            _ if a.starts_with("--max-count=") => {
                match a["--max-count=".len()..].parse::<usize>() {
                    Ok(n) => o.limit = Some(n),
                    Err(_) => return Ok(fail(128, "fatal: --max-count requires a number")),
                }
            }
            _ if a.starts_with("-n") && a[2..].parse::<usize>().is_ok() => {
                o.limit = a[2..].parse().ok();
            }
            _ if a.starts_with('-') => return Ok(unsupported(&full(args))),
            _ => revs.push(raw),
        }
    }
    if revs.len() > 1 {
        return Ok(unsupported(&full(args)));
    }
    let rev = revs.first().copied();
    let [path] = paths else {
        return Ok(unsupported(&full(args)));
    };
    if !follow {
        return Ok(unsupported(&full(args)));
    }
    let repo = ctx.open()?;
    let start = match rev {
        Some(r) => repo.revparse_single(r).and_then(|o| o.peel_to_commit()),
        None => repo.head().and_then(|h| h.peel_to_commit()),
    };
    let Ok(start) = start else {
        return Ok(fail(
            128,
            "fatal: your current branch does not have any commits yet",
        ));
    };
    let text = follow_history(&repo, start.id(), path, &o)?;
    Ok(ok(text))
}

fn full(args: &[String]) -> Vec<String> {
    let mut v = vec!["log".to_string()];
    v.extend(args.iter().cloned());
    v
}

fn path_diff<'r>(
    repo: &'r Repository,
    parent: Option<&Tree<'r>>,
    tree: &Tree<'r>,
    path: Option<&str>,
) -> AppResult<Diff<'r>> {
    let mut opts = DiffOptions::new();
    if let Some(p) = path {
        opts.pathspec(p).disable_pathspec_match(true);
    }
    Ok(repo.diff_tree_to_tree(parent, Some(tree), Some(&mut opts))?)
}

/// What one commit did to the followed path.
enum Change {
    /// The path is untouched.
    None,
    /// `(status letter with score, old path, new path)`.
    Touched(String, Option<String>, String),
}

fn letter(d: Delta) -> &'static str {
    match d {
        Delta::Added => "A",
        Delta::Deleted => "D",
        Delta::Typechange => "T",
        Delta::Copied => "C",
        _ => "M",
    }
}

fn change_of(
    repo: &Repository,
    parent: Option<&Tree<'_>>,
    tree: &Tree<'_>,
    path: &str,
) -> AppResult<Change> {
    let diff = path_diff(repo, parent, tree, Some(path))?;
    let Some(delta) = diff.deltas().next() else {
        return Ok(Change::None);
    };
    let status = delta.status();
    if status == Delta::Added {
        // Was the file renamed here? Detect over the whole commit diff.
        let mut all = path_diff(repo, parent, tree, None)?;
        let mut find = DiffFindOptions::new();
        find.renames(true);
        all.find_similar(Some(&mut find))?;
        for d in all.deltas() {
            let new = d
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
            if d.status() == Delta::Renamed && new.as_deref() == Some(path) {
                let old = d
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                let score = similarity(repo, &old, path, parent, tree);
                return Ok(Change::Touched(
                    format!("R{score:03}"),
                    Some(old),
                    path.to_string(),
                ));
            }
        }
    }
    Ok(Change::Touched(
        letter(status).to_string(),
        None,
        path.to_string(),
    ))
}

/// Similarity percentage of a rename (git prints it after `R`); libgit2
/// does not expose the score through the delta, so compute the share of
/// unchanged lines and clamp to 50..=100 like the detection threshold.
fn similarity(
    repo: &Repository,
    old: &str,
    new: &str,
    parent: Option<&Tree<'_>>,
    tree: &Tree<'_>,
) -> u32 {
    let blob = |t: Option<&Tree<'_>>, p: &str| -> Option<Vec<u8>> {
        let e = t?.get_path(std::path::Path::new(p)).ok()?;
        Some(repo.find_blob(e.id()).ok()?.content().to_vec())
    };
    let (Some(a), Some(b)) = (blob(parent, old), blob(Some(tree), new)) else {
        return 100;
    };
    if a == b {
        return 100;
    }
    let la: Vec<&[u8]> = a.split(|c| *c == b'\n').collect();
    let lb: Vec<&[u8]> = b.split(|c| *c == b'\n').collect();
    let mut used = vec![false; lb.len()];
    let mut same = 0usize;
    for l in &la {
        if let Some(i) = (0..lb.len()).find(|i| !used[*i] && lb[*i] == *l) {
            used[i] = true;
            same += 1;
        }
    }
    let total = la.len().max(lb.len()).max(1);
    ((same * 100 / total) as u32).clamp(50, 99)
}

fn follow_history(repo: &Repository, start: Oid, path: &str, o: &Opts) -> AppResult<String> {
    let mut cur = path.replace('\\', "/");
    let mut out = String::new();
    let mut shown = 0usize;
    let mut seen: HashSet<Oid> = HashSet::new();
    let mut heap: BinaryHeap<(i64, Reverse<u64>, Oid)> = BinaryHeap::new();
    let mut seq = 0u64;
    let mut push = |heap: &mut BinaryHeap<_>, oid: Oid, repo: &Repository| -> AppResult<()> {
        if seen.insert(oid) {
            let t = repo.find_commit(oid)?.time().seconds();
            seq += 1;
            heap.push((t, Reverse(seq), oid));
        }
        Ok(())
    };
    push(&mut heap, start, repo)?;
    while let Some((_, _, oid)) = heap.pop() {
        if o.limit.is_some_and(|l| shown >= l) {
            break;
        }
        let commit = repo.find_commit(oid)?;
        let tree = commit.tree()?;
        let parents: Vec<_> = commit.parents().collect();
        let mut display: Option<Change> = None;
        let mut follow_parents: Vec<Oid> = parents.iter().map(|p| p.id()).collect();
        match parents.len() {
            0 => {
                let c = change_of(repo, None, &tree, &cur)?;
                if !matches!(c, Change::None) {
                    display = Some(c);
                }
            }
            1 => {
                let ptree = parents[0].tree()?;
                let c = change_of(repo, Some(&ptree), &tree, &cur)?;
                if !matches!(c, Change::None) {
                    display = Some(c);
                }
            }
            _ => {
                let mut same_parent = None;
                for p in &parents {
                    let ptree = p.tree()?;
                    if path_diff(repo, Some(&ptree), &tree, Some(&cur))?
                        .deltas()
                        .len()
                        == 0
                    {
                        same_parent = Some(p.id());
                        break;
                    }
                }
                match same_parent {
                    Some(p) => follow_parents = vec![p],
                    None => {
                        display = Some(Change::Touched(String::new(), None, cur.clone()));
                    }
                }
            }
        }
        if let Some(change) = display {
            out.push_str(&render(&commit, &change, o));
            shown += 1;
            if let Change::Touched(_, Some(old), _) = &change {
                cur = old.clone();
            }
        }
        for p in follow_parents {
            push(&mut heap, p, repo)?;
        }
    }
    Ok(out)
}

fn render(commit: &git2::Commit<'_>, change: &Change, o: &Opts) -> String {
    let mut s = match &o.format {
        Some(f) => format!("{}\n", expand(commit, f)),
        None => format!("commit {}\n\n", commit.id()),
    };
    if o.name_status {
        if let Change::Touched(status, old, new) = change {
            if !status.is_empty() {
                s.push('\n');
                match old {
                    Some(old) => s.push_str(&format!("{status}\t{old}\t{new}\n")),
                    None => s.push_str(&format!("{status}\t{new}\n")),
                }
            }
        }
    }
    s
}

fn expand(commit: &git2::Commit<'_>, fmt: &str) -> String {
    let id = commit.id().to_string();
    let author = commit.author();
    let committer = commit.committer();
    let mut out = String::new();
    let mut chars = fmt.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('H') => out.push_str(&id),
            Some('h') => out.push_str(&id[..7]),
            Some('s') => out.push_str(commit.summary().ok().flatten().unwrap_or("")),
            Some('n') => out.push('\n'),
            Some('%') => out.push('%'),
            Some('a') => match chars.next() {
                Some('n') => out.push_str(author.name().unwrap_or("")),
                Some('e') => out.push_str(author.email().unwrap_or("")),
                Some('t') => out.push_str(&author.when().seconds().to_string()),
                Some(x) => out.extend(['%', 'a', x]),
                None => out.push_str("%a"),
            },
            Some('c') => match chars.next() {
                Some('n') => out.push_str(committer.name().unwrap_or("")),
                Some('e') => out.push_str(committer.email().unwrap_or("")),
                Some('t') => out.push_str(&committer.when().seconds().to_string()),
                Some(x) => out.extend(['%', 'c', x]),
                None => out.push_str("%c"),
            },
            Some(x) => out.extend(['%', x]),
            None => out.push('%'),
        }
    }
    out
}
