//! Git layer: the `GitService` trait with a libgit2 implementation for reads,
//! graph, diffs and simple writes, and a git CLI runner for network operations,
//! sequencer operations, submodules and worktrees.
//!
//! Owned by `rust-git-agent`. Filled in during M1 (see docs/PLAN.md).

/// Backend state managed by Tauri (`State<'_, GitState>` in command handlers).
/// Holds the open-repository registry; fields are added by `rust-git-agent`.
#[derive(Default)]
pub struct GitState {}
