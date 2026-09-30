//! `git cherry-pick` and `git revert`: `[--no-edit] [-n] [-m <parent>] [-x]
//! <commit>...` and `--continue | --abort | --skip | --quit`.

use std::cell::RefCell;
use std::rc::Rc;

use git2::build::CheckoutBuilder;
use git2::{
    CherrypickOptions, Commit, MergeOptions, Oid, Repository, RepositoryState, RevertOptions,
};

use super::reset::reset_merge;
use super::{
    clean_message, clear_pick_state, conflict_lines, fail, git_file, ok, overwritten_message,
    sequencer, staged_changes, unsupported, AppResult, CliOutput, Ctx, Res,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    CherryPick,
    Revert,
}

impl Kind {
    pub fn verb(self) -> &'static str {
        match self {
            Kind::CherryPick => "cherry-pick",
            Kind::Revert => "revert",
        }
    }

    pub fn todo_word(self) -> &'static str {
        match self {
            Kind::CherryPick => "pick",
            Kind::Revert => "revert",
        }
    }

    fn head_file(self) -> &'static str {
        match self {
            Kind::CherryPick => "CHERRY_PICK_HEAD",
            Kind::Revert => "REVERT_HEAD",
        }
    }
}

#[derive(Clone, Copy)]
enum Control {
    Continue,
    Abort,
    Skip,
    Quit,
}

#[derive(Clone, Copy, Default)]
struct Opts {
    no_commit: bool,
    mainline: Option<u32>,
    record_origin: bool,
}

/// Outcome of applying one commit.
enum Step {
    Done,
    Stopped(CliOutput),
}

pub fn run(ctx: &Ctx, kind: Kind, args: &[String]) -> Res {
    let mut opts = Opts::default();
    let mut control: Option<Control> = None;
    let mut specs: Vec<&String> = Vec::new();
    let mut only_specs = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if only_specs {
            specs.push(a);
            continue;
        }
        match a.as_str() {
            "--" => only_specs = true,
            "--no-edit"
            | "--edit"
            | "-e"
            | "-q"
            | "--quiet"
            | "--allow-empty"
            | "--keep-redundant-commits" => {}
            "-n" | "--no-commit" => opts.no_commit = true,
            "-x" => opts.record_origin = true,
            "--continue" => control = Some(Control::Continue),
            "--abort" => control = Some(Control::Abort),
            "--skip" => control = Some(Control::Skip),
            "--quit" => control = Some(Control::Quit),
            "-m" | "--mainline" => match it.next().and_then(|v| v.parse::<u32>().ok()) {
                Some(n) if n > 0 => opts.mainline = Some(n),
                _ => return Ok(fail(129, "error: switch `m' expects a numerical value")),
            },
            s if s.starts_with('-') && s.len() > 1 => {
                let mut full = vec![kind.verb().to_string()];
                full.extend(args.iter().cloned());
                return Ok(unsupported(&full));
            }
            _ => specs.push(a),
        }
    }
    let repo = ctx.open()?;
    if let Some(c) = control {
        return control_op(ctx, &repo, c);
    }
    start(ctx, &repo, kind, opts, &specs)
}

fn start(ctx: &Ctx, repo: &Repository, kind: Kind, opts: Opts, specs: &[&String]) -> Res {
    let verb = kind.verb();
    if specs.is_empty() {
        return Ok(fail(128, &format!("fatal: {verb}: no commit specified")));
    }
    match repo.state() {
        RepositoryState::Clean => {}
        RepositoryState::CherryPick
        | RepositoryState::CherryPickSequence
        | RepositoryState::Revert
        | RepositoryState::RevertSequence => {
            return Ok(fail(
                128,
                &format!(
                    "error: a cherry-pick or revert is already in progress\nhint: try \"git cherry-pick (--continue | --skip | --abort | --quit)\"\nfatal: {verb} failed"
                ),
            ));
        }
        other => {
            return Ok(fail(
                128,
                &format!("fatal: {verb} is not possible while a {other:?} is in progress"),
            ));
        }
    }
    let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) else {
        return Ok(fail(
            128,
            &format!("fatal: {verb}: your current branch does not have any commits yet"),
        ));
    };
    let mut items = Vec::new();
    for spec in specs {
        if spec.contains("..") {
            let mut full = vec![verb.to_string()];
            full.extend(specs.iter().map(|s| (*s).clone()));
            return Ok(unsupported(&full));
        }
        match repo.revparse_single(spec).and_then(|o| o.peel_to_commit()) {
            Ok(c) => items.push(c.id()),
            Err(_) => return Ok(fail(128, &format!("fatal: bad revision '{spec}'"))),
        }
    }
    if !opts.no_commit && staged_changes(repo)? {
        return Ok(fail(
            128,
            &format!(
                "error: your local changes would be overwritten by {verb}.\nhint: commit your changes or stash them to proceed.\nfatal: {verb} failed"
            ),
        ));
    }
    if items.len() > 1 && !opts.no_commit {
        sequencer::start(repo, head.id(), kind, &items, opts.mainline)?;
    }
    run_items(ctx, repo, kind, &items, opts)
}

/// Applies `items` in order, stopping at the first conflict.
fn run_items(ctx: &Ctx, repo: &Repository, kind: Kind, items: &[Oid], opts: Opts) -> Res {
    for (i, oid) in items.iter().enumerate() {
        if sequencer::exists(repo) {
            sequencer::write_todo(repo, kind, &items[i..])?;
        }
        if let Step::Stopped(out) = apply_one(ctx, repo, kind, *oid, opts)? {
            return Ok(out);
        }
    }
    sequencer::remove(repo);
    Ok(ok(""))
}

fn short(oid: Oid) -> String {
    oid.to_string()[..7].to_string()
}

fn apply_one(ctx: &Ctx, repo: &Repository, kind: Kind, oid: Oid, opts: Opts) -> AppResult<Step> {
    let verb = kind.verb();
    let commit = repo.find_commit(oid)?;
    if commit.parent_count() > 1 && opts.mainline.is_none() {
        sequencer::remove(repo);
        return Ok(Step::Stopped(fail(
            128,
            &format!(
                "error: commit {oid} is a merge but no -m option was given.\nfatal: {verb} failed"
            ),
        )));
    }
    let refused = Rc::new(RefCell::new(Vec::<String>::new()));
    let mut co = CheckoutBuilder::new();
    co.conflict_style_merge(true);
    co.notify_on(git2::CheckoutNotificationType::CONFLICT);
    {
        let refused = Rc::clone(&refused);
        co.notify(move |_, path, _, _, _| {
            if let Some(p) = path {
                refused
                    .borrow_mut()
                    .push(p.to_string_lossy().replace('\\', "/"));
            }
            true
        });
    }
    let applied = match kind {
        Kind::CherryPick => {
            let mut o = CherrypickOptions::new();
            if let Some(m) = opts.mainline {
                o.mainline(m);
            }
            o.merge_opts(MergeOptions::new());
            o.checkout_builder(co);
            repo.cherrypick(&commit, Some(&mut o))
        }
        Kind::Revert => {
            let mut o = RevertOptions::new();
            if let Some(m) = opts.mainline {
                o.mainline(m);
            }
            o.merge_opts(MergeOptions::new());
            o.checkout_builder(co);
            repo.revert(&commit, Some(&mut o))
        }
    };
    if let Err(e) = applied {
        // libgit2 writes the state files before it checks the working tree.
        clear_pick_state(repo);
        if sequencer::exists(repo) && !committed_any(repo) {
            // Nothing of the sequence was applied: it never got going.
            sequencer::remove(repo);
        }
        return if matches!(
            e.code(),
            git2::ErrorCode::Conflict
                | git2::ErrorCode::MergeConflict
                | git2::ErrorCode::Uncommitted
        ) {
            let files = refused.borrow().clone();
            let msg = if files.is_empty() {
                format!(
                    "error: your local changes would be overwritten by {verb}.\nhint: commit your changes or stash them to proceed.\nfatal: {verb} failed"
                )
            } else {
                format!(
                    "{}\nfatal: {verb} failed",
                    overwritten_message(&files, verb, verb)
                )
            };
            Ok(Step::Stopped(fail(1, &msg)))
        } else {
            Err(e.into())
        };
    }

    let mut index = repo.index()?;
    index.read(true)?;
    if index.has_conflicts() {
        let lines = conflict_lines(&index, &format!("{} ({})", short(oid), summary(&commit)))?;
        if opts.no_commit {
            clear_pick_state(repo);
        }
        let hint = format!(
            "error: could not {} {}... {}\nhint: After resolving the conflicts, mark them with\nhint: \"git add/rm <pathspec>\", then run\nhint: \"git {verb} --continue\".\nhint: You can instead skip this commit with \"git {verb} --skip\".\nhint: To abort and get back to the state before \"git {verb}\",\nhint: run \"git {verb} --abort\".",
            if kind == Kind::Revert { "revert" } else { "apply" },
            short(oid),
            summary(&commit)
        );
        return Ok(Step::Stopped(CliOutput {
            stdout: format!("{lines}\n").into_bytes(),
            stderr: format!("{hint}\n"),
            code: 1,
        }));
    }
    if opts.no_commit {
        clear_pick_state(repo);
        return Ok(Step::Done);
    }
    conclude(ctx, repo, kind, &commit, opts)
}

fn summary(c: &Commit<'_>) -> String {
    c.summary().ok().flatten().unwrap_or_default().to_string()
}

/// Whether HEAD moved since the sequence started.
fn committed_any(repo: &Repository) -> bool {
    match (
        sequencer::read_head(repo),
        repo.head().ok().and_then(|h| h.target()),
    ) {
        (Some(start), Some(now)) => start != now,
        _ => false,
    }
}

/// Commits the index as the result of `commit` (which is being picked or
/// reverted) and clears the per-commit state.
fn conclude(
    ctx: &Ctx,
    repo: &Repository,
    kind: Kind,
    commit: &Commit<'_>,
    opts: Opts,
) -> AppResult<Step> {
    let verb = kind.verb();
    let head = repo.head()?.peel_to_commit()?;
    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    if tree.id() == head.tree_id() {
        // Applied cleanly but changes nothing (already present, or emptied
        // by the conflict resolution): git stops here.
        let _ = std::fs::write(
            git_file(repo, kind.head_file()),
            format!("{}\n", commit.id()),
        );
        return Ok(Step::Stopped(fail(
            1,
            &format!(
                "The previous {verb} is now empty, possibly due to conflict resolution.\nIf you wish to commit it anyway, use:\n\n    git commit --allow-empty\n\nOtherwise, please use 'git {verb} --skip'"
            ),
        )));
    }
    let (author, message) = match kind {
        Kind::CherryPick => {
            let a = commit.author();
            let author = git2::Signature::new(
                a.name().ok().unwrap_or_default(),
                a.email().ok().unwrap_or_default(),
                &a.when(),
            )?;
            let mut m = commit.message().ok().unwrap_or_default().to_string();
            if opts.record_origin {
                m = format!(
                    "{}\n\n(cherry picked from commit {})\n",
                    m.trim_end(),
                    commit.id()
                );
            }
            (author, m)
        }
        Kind::Revert => {
            let author = match ctx.author(repo) {
                Ok(s) => s,
                Err(out) => return Ok(Step::Stopped(out)),
            };
            let m = repo.message().unwrap_or_else(|_| {
                format!(
                    "Revert \"{}\"\n\nThis reverts commit {}.\n",
                    summary(commit),
                    commit.id()
                )
            });
            (author, clean_message(&m, true))
        }
    };
    let committer = match ctx.committer(repo) {
        Ok(s) => s,
        Err(out) => return Ok(Step::Stopped(out)),
    };
    repo.commit(Some("HEAD"), &author, &committer, &message, &tree, &[&head])?;
    clear_pick_state(repo);
    Ok(Step::Done)
}

fn state_kind(repo: &Repository) -> Option<Kind> {
    match repo.state() {
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => Some(Kind::CherryPick),
        RepositoryState::Revert | RepositoryState::RevertSequence => Some(Kind::Revert),
        _ => None,
    }
}

fn control_op(ctx: &Ctx, repo: &Repository, c: Control) -> Res {
    // A sequencer directory without *_HEAD (the last pick was committed by
    // hand) still counts for --abort, --skip and --quit.
    let Some(kind) = state_kind(repo).or_else(|| {
        sequencer::exists(repo).then(|| {
            std::fs::read_to_string(git_file(repo, "sequencer/todo"))
                .ok()
                .filter(|t| t.starts_with("revert"))
                .map_or(Kind::CherryPick, |_| Kind::Revert)
        })
    }) else {
        return Ok(fail(128, "fatal: no cherry-pick or revert in progress"));
    };
    let mainline = sequencer::read_mainline(repo);
    let opts = Opts {
        mainline,
        ..Opts::default()
    };
    match c {
        Control::Quit => {
            clear_pick_state(repo);
            sequencer::remove(repo);
            Ok(ok(""))
        }
        Control::Abort => {
            let target = sequencer::read_head(repo)
                .and_then(|o| repo.find_commit(o).ok())
                .map_or_else(|| repo.head()?.peel_to_commit(), Ok)?;
            reset_merge(repo, &target)?;
            super::reset::clear_merge_state(repo);
            sequencer::remove(repo);
            Ok(ok(""))
        }
        Control::Skip => {
            let head = repo.head()?.peel_to_commit()?;
            reset_merge(repo, &head)?;
            clear_pick_state(repo);
            let mut todo = sequencer::read_todo(repo);
            if !todo.is_empty() {
                todo.remove(0);
            }
            if todo.is_empty() {
                sequencer::remove(repo);
                return Ok(ok(""));
            }
            run_items(ctx, repo, kind, &todo, opts)
        }
        Control::Continue => {
            let mut index = repo.index()?;
            index.read(true)?;
            if index.has_conflicts() {
                return Ok(fail(
                    128,
                    "error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.",
                ));
            }
            let mut todo = sequencer::read_todo(repo);
            let pending = std::fs::read_to_string(git_file(repo, kind.head_file()))
                .ok()
                .and_then(|t| Oid::from_str(t.trim()).ok());
            if let Some(pending) = pending {
                let commit = repo.find_commit(pending)?;
                if let Step::Stopped(out) = conclude(ctx, repo, kind, &commit, opts)? {
                    return Ok(out);
                }
            }
            // The stopped commit is done (committed here or by hand).
            if !todo.is_empty() {
                todo.remove(0);
            }
            if todo.is_empty() {
                sequencer::remove(repo);
                return Ok(ok(""));
            }
            run_items(ctx, repo, kind, &todo, opts)
        }
    }
}
