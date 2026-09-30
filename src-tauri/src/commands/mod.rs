//! Thin IPC handlers. Each file is owned by one agent (see docs/PLAN.md §3).

pub mod advanced;
pub mod ai;
pub mod app;
pub mod conflicts;
pub mod graph;
pub mod history;
pub mod oplog;
pub mod refs;
pub mod remotes;
pub mod repo;
pub mod settings;
pub mod stash;
pub mod worktree;
