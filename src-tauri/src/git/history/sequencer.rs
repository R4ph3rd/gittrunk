//! `sequencer_control`: continue, skip or abort the operation in progress.

use git2::RepositoryState as St;

use super::rebase::cleanup_temp;
use super::*;

pub(super) fn control(repo: &Repository, action: SequencerAction) -> AppResult<OpOutcome> {
    let state = repo.state();
    let (name, flag) = match action {
        SequencerAction::Continue => ("Continue", "--continue"),
        SequencerAction::Skip => ("Skip", "--skip"),
        SequencerAction::Abort => ("Abort", "--abort"),
    };
    let (kind, cmd): (&str, Vec<String>) = match state {
        St::Merge => match action {
            SequencerAction::Continue => ("merge", args(&["commit", "--no-edit"])),
            SequencerAction::Abort => ("merge", args(&["merge", "--abort"])),
            SequencerAction::Skip => {
                return Err(invalid("a merge cannot be skipped; continue or abort it"))
            }
        },
        St::Revert | St::RevertSequence => ("revert", args(&["revert", flag])),
        St::CherryPick | St::CherryPickSequence => ("cherry-pick", args(&["cherry-pick", flag])),
        s if is_rebase_state(s) => ("rebase", args(&["rebase", flag])),
        St::Clean if !conflicted_paths(repo)?.is_empty() => match action {
            // A squash merge or `--no-commit` pick: no state files, but the
            // index holds conflicts.
            SequencerAction::Abort => ("merge", args(&["reset", "--merge"])),
            _ => {
                return Err(invalid(
                    "no operation to continue: commit the staged changes",
                ))
            }
        },
        _ => {
            return Err(invalid(
                "no merge, rebase, cherry-pick or revert in progress",
            ))
        }
    };
    let description = format!("{name} {kind}");
    let (stop, entry) = record(
        repo,
        &format!("sequencer_{}", name.to_ascii_lowercase()),
        description,
        |repo| {
            let out = run_git(repo, &cmd, &[])?;
            interpret(repo, out)
        },
    )?;
    cleanup_temp(repo);
    let done = match action {
        SequencerAction::Abort => format!("Aborted {kind}"),
        SequencerAction::Skip => format!("Skipped and finished {kind}"),
        SequencerAction::Continue => format!("Finished {kind}"),
    };
    outcome(repo, stop, entry, done)
}
