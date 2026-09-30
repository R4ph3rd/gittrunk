//! IPC contract: command registry, events, and TypeScript export.
//!
//! This module and its children are owned by the orchestrator. The generated
//! `src/ipc/bindings.ts` must be regenerated (`pnpm bindings`) and committed
//! whenever anything here or in `commands/` changes signature.

pub mod error;
pub mod types;

use specta_typescript::Typescript;
use tauri_specta::{collect_commands, collect_events, Builder};

use crate::commands;
use types::{CredentialRequested, OpFinished, OpProgress, RepoChanged};

/// Absolute path of the generated bindings in the source tree.
pub const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/ipc/bindings.ts");

pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::repo::repo_open,
            commands::repo::repo_init,
            commands::repo::repo_clone,
            commands::repo::repo_close,
            commands::repo::repo_info,
            commands::repo::repo_recent,
            commands::graph::graph_load,
            commands::graph::graph_rows,
            commands::graph::graph_search,
            commands::graph::graph_find,
            commands::graph::commit_details,
            commands::graph::commit_file_diff,
            commands::refs::refs_list,
            commands::refs::branch_create,
            commands::refs::branch_delete,
            commands::refs::branch_rename,
            commands::refs::checkout,
            commands::refs::tag_create,
            commands::refs::tag_delete,
            commands::refs::ref_move,
            commands::worktree::status,
            commands::worktree::worktree_file_diff,
            commands::worktree::stage_paths,
            commands::worktree::unstage_paths,
            commands::worktree::discard_paths,
            commands::worktree::stage_lines,
            commands::worktree::unstage_lines,
            commands::worktree::discard_lines,
            commands::worktree::commit_create,
            commands::stash::stash_list,
            commands::stash::stash_save,
            commands::stash::stash_apply,
            commands::stash::stash_drop,
            commands::history::merge,
            commands::history::rebase,
            commands::history::rebase_todo_load,
            commands::history::rebase_interactive,
            commands::history::cherry_pick,
            commands::history::revert,
            commands::history::reset,
            commands::history::sequencer_control,
            commands::conflicts::conflict_list,
            commands::conflicts::conflict_file,
            commands::conflicts::conflict_resolve,
            commands::remotes::remote_list,
            commands::remotes::remote_add,
            commands::remotes::remote_remove,
            commands::remotes::remote_rename,
            commands::remotes::remote_set_url,
            commands::remotes::fetch,
            commands::remotes::pull,
            commands::remotes::push,
            commands::remotes::set_upstream,
            commands::remotes::credential_respond,
            commands::remotes::credential_store,
            commands::remotes::credential_clear,
            commands::advanced::submodule_list,
            commands::advanced::submodule_update,
            commands::advanced::worktree_list,
            commands::advanced::worktree_add,
            commands::advanced::worktree_remove,
            commands::advanced::blame,
            commands::advanced::file_history,
            commands::advanced::reflog,
            commands::oplog::oplog_list,
            commands::oplog::undo,
            commands::oplog::redo,
            commands::oplog::op_cancel,
            commands::ai::ai_settings_get,
            commands::ai::ai_settings_set,
            commands::ai::ai_key_set,
            commands::ai::ai_key_clear,
            commands::ai::ai_payload_preview,
            commands::ai::ai_run,
            commands::ai::ai_plan_execute,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::keybindings_get,
            commands::settings::keybindings_set,
        ])
        .events(collect_events![
            RepoChanged,
            OpProgress,
            OpFinished,
            CredentialRequested
        ])
}

pub fn export_bindings(builder: &Builder<tauri::Wry>, path: &str) {
    builder
        .export(
            Typescript::default().header("// @ts-nocheck\n/* eslint-disable */"),
            path,
        )
        .expect("failed to export TypeScript bindings");
}
