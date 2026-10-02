//! Every type that crosses the IPC boundary.
//!
//! Conventions:
//! - Fields are camelCase on the wire.
//! - Object ids are full hex strings (`Oid`), refs are full or short names as documented.
//! - Timestamps are `f64` unix seconds; counts and indices are `u32`
//!   (specta forbids 64-bit integers to avoid silent precision loss in JS).
//! - Data-carrying enums are tagged with `kind`.
//!
//! Changes to this file are contract changes and go through the orchestrator.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::error::AppError;

/// Hex object id.
pub type Oid = String;
/// Opaque handle returned by `repo_open`.
pub type RepoId = String;
/// Handle for a long-running operation; progress arrives via `OpProgress`/`OpFinished` events.
pub type OpId = String;

macro_rules! wire {
    ($($item:item)*) => {
        $(
            #[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
            #[serde(rename_all = "camelCase")]
            $item
        )*
    };
}

macro_rules! wire_enum {
    ($($item:item)*) => {
        $(
            #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
            #[serde(rename_all = "camelCase")]
            $item
        )*
    };
}

macro_rules! wire_tagged {
    ($($item:item)*) => {
        $(
            #[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
            #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
            $item
        )*
    };
}

// ---------------------------------------------------------------- app

wire! {
    pub struct AppInfo {
        pub version: String,
        /// `git --version` output, `None` when git is not on PATH.
        pub git_version: Option<String>,
        pub platform: String,
    }
}

wire! {
    /// Compile-time platform facts the UI uses to hide unsupported features.
    pub struct PlatformInfo {
        /// `std::env::consts::OS`: "android" | "windows" | "macos" | "linux".
        pub os: String,
        pub mobile: bool,
        pub has_git_cli: bool,
        pub can_pick_folder: bool,
        pub supports_ssh: bool,
        pub supports_external_editor: bool,
        pub supports_rebase: bool,
        pub supports_interactive_rebase: bool,
        pub supports_worktrees: bool,
        pub supports_submodules: bool,
        pub supports_file_history: bool,
        pub supports_hooks: bool,
        pub read_only: bool,
        pub supports_terminal: bool,
        /// "file" or "keychain".
        pub secret_store: String,
        /// Where clones land by default on mobile/embedded builds.
        pub default_repos_dir: Option<String>,
    }
}

wire! {
    pub struct GitIdentity {
        pub name: Option<String>,
        pub email: Option<String>,
    }
}

// ---------------------------------------------------------------- repo

wire_enum! {
    pub enum RepoState {
        Clean,
        Merge,
        Revert,
        CherryPick,
        Bisect,
        Rebase,
        RebaseInteractive,
        ApplyMailbox,
    }
}

wire_tagged! {
    pub enum HeadState {
        Branch { name: String, oid: Oid },
        Detached { oid: Oid },
        Unborn { name: String },
    }
}

wire! {
    pub struct RepoInfo {
        pub id: RepoId,
        pub path: String,
        pub name: String,
        pub head: HeadState,
        pub state: RepoState,
        pub is_bare: bool,
    }

    pub struct RecentRepo {
        pub path: String,
        pub name: String,
        pub last_opened: f64,
    }

    pub struct KnownRepo {
        pub path: String,
        pub name: String,
        pub last_opened: f64,
        /// The folder still exists on disk.
        pub exists: bool,
    }

    pub struct CloneRequest {
        pub url: String,
        pub dest: String,
        pub bare: bool,
        pub recurse_submodules: bool,
    }

    pub struct InitRequest {
        pub path: String,
        pub bare: bool,
        pub initial_branch: Option<String>,
    }
}

wire_enum! {
    pub enum ChangeScope {
        Refs,
        Index,
        Worktree,
        Config,
    }
}

// ---------------------------------------------------------------- graph

wire_enum! {
    pub enum CommitOrder {
        Topo,
        Date,
    }

    pub enum RefKind {
        LocalBranch,
        RemoteBranch,
        Tag,
        Stash,
    }

    pub enum EdgeKind {
        /// A lane continuing to the next row (`from_lane == to_lane`).
        Straight,
        /// A line converging into an existing lane: joining a parent that is
        /// already reserved elsewhere, or a lane collapsing into the lane of
        /// the commit on the next row.
        MergeIn,
        /// A non-first parent of this row's commit opening a new lane.
        BranchOut,
    }
}

wire! {
    pub struct GraphFilter {
        /// `None` = all refs; otherwise short or full ref names to start the walk from.
        pub refs: Option<Vec<String>>,
        pub first_parent: bool,
        pub order: CommitOrder,
        pub author: Option<String>,
        pub path: Option<String>,
        pub since: Option<f64>,
        pub until: Option<f64>,
    }

    pub struct GraphMeta {
        pub row_count: u32,
        pub lane_count: u32,
        pub head_row: Option<u32>,
        /// Lane color of every non-stash ref whose commit is in this graph, sorted by full name.
        pub ref_colors: Vec<RefColor>,
    }

    pub struct RefColor {
        pub full_name: String,
        pub color: u32,
    }

    pub struct RefLabel {
        pub name: String,
        pub full_name: String,
        pub kind: RefKind,
        pub is_head: bool,
    }

    /// Edge drawn from this row down to the next row.
    pub struct GraphEdge {
        pub from_lane: u32,
        pub to_lane: u32,
        pub kind: EdgeKind,
        pub color: u32,
    }

    pub struct GraphRow {
        pub index: u32,
        pub oid: Oid,
        pub short_oid: String,
        pub summary: String,
        pub author_name: String,
        pub author_email: String,
        pub author_time: f64,
        pub parents: Vec<Oid>,
        pub lane: u32,
        pub color: u32,
        pub edges: Vec<GraphEdge>,
        pub refs: Vec<RefLabel>,
    }

    pub struct GraphSearch {
        /// Matches message, author, or oid prefix.
        pub text: String,
        pub max_results: u32,
    }
}

// ---------------------------------------------------------------- commits & diffs

wire_enum! {
    pub enum ChangeStatus {
        Added,
        Modified,
        Deleted,
        Renamed,
        Copied,
        TypeChange,
        Untracked,
        Conflicted,
    }

    pub enum LineKind {
        Context,
        Add,
        Delete,
        /// "\ No newline at end of file" marker.
        NoNewline,
    }
}

wire! {
    pub struct Signature {
        pub name: String,
        pub email: String,
        pub time: f64,
        pub offset_minutes: i32,
    }

    pub struct FileChange {
        pub path: String,
        pub old_path: Option<String>,
        pub status: ChangeStatus,
        pub additions: u32,
        pub deletions: u32,
        pub binary: bool,
    }

    pub struct CommitSummary {
        pub oid: Oid,
        pub short_oid: String,
        pub summary: String,
        pub author_name: String,
        pub author_time: f64,
    }

    pub struct CommitDetails {
        pub oid: Oid,
        pub parents: Vec<Oid>,
        pub author: Signature,
        pub committer: Signature,
        pub summary: String,
        pub body: String,
        pub files: Vec<FileChange>,
        pub refs: Vec<RefLabel>,
    }

    pub struct DiffOptions {
        pub context_lines: u32,
        pub ignore_whitespace: bool,
    }

    pub struct DiffLine {
        pub kind: LineKind,
        pub old_lineno: Option<u32>,
        pub new_lineno: Option<u32>,
        pub content: String,
    }

    pub struct Hunk {
        pub header: String,
        pub old_start: u32,
        pub old_lines: u32,
        pub new_start: u32,
        pub new_lines: u32,
        pub lines: Vec<DiffLine>,
    }

    pub struct FileDiff {
        pub path: String,
        pub old_path: Option<String>,
        pub status: ChangeStatus,
        pub binary: bool,
        pub hunks: Vec<Hunk>,
    }
}

// ---------------------------------------------------------------- refs

wire! {
    pub struct BranchInfo {
        pub name: String,
        pub full_name: String,
        pub oid: Oid,
        pub upstream: Option<String>,
        pub ahead: u32,
        pub behind: u32,
        pub is_head: bool,
        /// Remote name for remote-tracking branches.
        pub remote: Option<String>,
    }

    pub struct TagInfo {
        pub name: String,
        /// Peeled commit id.
        pub oid: Oid,
        pub annotated: bool,
        pub message: Option<String>,
    }

    pub struct StashEntry {
        pub index: u32,
        pub oid: Oid,
        pub message: String,
        pub branch: Option<String>,
        pub time: f64,
    }

    pub struct RefsSnapshot {
        pub head: HeadState,
        pub local: Vec<BranchInfo>,
        pub remote: Vec<BranchInfo>,
        pub tags: Vec<TagInfo>,
        pub stashes: Vec<StashEntry>,
    }

    pub struct BranchCreateRequest {
        pub name: String,
        /// Defaults to HEAD.
        pub start_point: Option<String>,
        pub checkout: bool,
    }

    pub struct BranchDeleteRequest {
        pub name: String,
        pub remote: bool,
        pub force: bool,
    }

    pub struct TagCreateRequest {
        pub name: String,
        pub target: String,
        /// `Some` creates an annotated tag.
        pub message: Option<String>,
    }

    pub struct RefMoveRequest {
        /// Full or short branch/tag name.
        pub name: String,
        pub target: Oid,
        pub force: bool,
    }
}

wire_tagged! {
    pub enum CheckoutTarget {
        Branch { name: String },
        Commit { oid: Oid },
        /// Creates `local_name` tracking `name` (e.g. `origin/feature`).
        RemoteBranch { name: String, local_name: String },
    }
}

// ---------------------------------------------------------------- working copy

wire! {
    pub struct StatusSnapshot {
        pub state: RepoState,
        pub staged: Vec<FileChange>,
        pub unstaged: Vec<FileChange>,
        pub conflicted: Vec<FileChange>,
    }

    /// Selects part of a file diff. `lines = None` selects the whole hunk;
    /// otherwise indices into `Hunk.lines`.
    pub struct HunkSelection {
        pub hunk_index: u32,
        pub lines: Option<Vec<u32>>,
    }

    /// `hunk_index`/`lines` refer to the diff produced with exactly `options`
    /// (the backend re-diffs with them). Staging requires
    /// `options.ignore_whitespace == false`.
    pub struct LineSelection {
        pub path: String,
        pub options: DiffOptions,
        pub hunks: Vec<HunkSelection>,
    }

    pub struct CommitRequest {
        pub message: String,
        pub amend: bool,
        pub sign_off: bool,
        pub allow_empty: bool,
    }

    pub struct StashSaveRequest {
        pub message: Option<String>,
        pub include_untracked: bool,
        pub keep_index: bool,
    }
}

// ---------------------------------------------------------------- history operations

wire_enum! {
    pub enum MergeStrategy {
        Auto,
        NoFf,
        FfOnly,
        Squash,
    }

    pub enum RebaseAction {
        Pick,
        Reword,
        Edit,
        Squash,
        Fixup,
        Drop,
    }

    pub enum SequencerAction {
        Continue,
        Skip,
        Abort,
    }

    pub enum ResetMode {
        Soft,
        Mixed,
        Hard,
    }
}

wire! {
    pub struct MergeRequest {
        /// Ref or oid merged into HEAD (or into `into` when set).
        pub source: String,
        /// Branch to merge into; checked out first when it is not HEAD.
        pub into: Option<String>,
        pub strategy: MergeStrategy,
        pub message: Option<String>,
    }

    pub struct RebaseRequest {
        pub onto: String,
        /// Branch to rebase; defaults to HEAD.
        pub branch: Option<String>,
    }

    pub struct RebaseTodoItem {
        pub action: RebaseAction,
        pub oid: Oid,
        pub summary: String,
        /// New message for `reword`, or combined message for `squash`.
        pub message: Option<String>,
    }

    pub struct InteractiveRebaseRequest {
        /// Exclusive base commit; items apply on top of it.
        pub base: Oid,
        pub todo: Vec<RebaseTodoItem>,
    }

    pub struct CherryPickRequest {
        pub commits: Vec<Oid>,
        /// Branch to apply onto; checked out first when it is not HEAD.
        pub target_branch: Option<String>,
        pub no_commit: bool,
    }

    pub struct RevertRequest {
        pub commits: Vec<Oid>,
        pub no_commit: bool,
    }

    pub struct ResetRequest {
        pub target: String,
        pub mode: ResetMode,
    }

    pub struct RefUpdate {
        pub name: String,
        pub from: Option<Oid>,
        pub to: Option<Oid>,
    }

    /// Result of a `dry_run`, shown in every confirmation dialog.
    pub struct OpPreview {
        pub summary: String,
        pub ref_updates: Vec<RefUpdate>,
        pub commits_created: u32,
        pub commits_dropped: Vec<CommitSummary>,
        pub predicted_conflicts: Vec<String>,
        pub warnings: Vec<String>,
    }
}

wire_tagged! {
    /// Outcome of every mutating command.
    pub enum OpOutcome {
        Preview { preview: OpPreview },
        Applied { oplog_id: String, head: HeadState, message: String },
        Conflicted { oplog_id: String, files: Vec<String> },
    }
}

// ---------------------------------------------------------------- conflicts

wire! {
    pub struct ConflictFile {
        pub path: String,
        pub binary: bool,
        pub base: Option<String>,
        pub ours: Option<String>,
        pub theirs: Option<String>,
        /// Working-tree content with conflict markers.
        pub merged: String,
        pub ours_label: String,
        pub theirs_label: String,
    }
}

wire_tagged! {
    pub enum ConflictResolution {
        Ours,
        Theirs,
        Content { content: String },
    }
}

// ---------------------------------------------------------------- remotes

wire_enum! {
    pub enum RemoteProvider {
        GitHub,
        GitLab,
        Bitbucket,
        AzureDevOps,
        Other,
    }

    pub enum PullStrategy {
        Merge,
        Rebase,
        FfOnly,
    }

    pub enum CredentialKind {
        Username,
        Password,
        Passphrase,
    }
}

wire! {
    pub struct RemoteInfo {
        pub name: String,
        pub fetch_url: String,
        pub push_url: Option<String>,
        pub provider: RemoteProvider,
    }

    pub struct RemoteAddRequest {
        pub name: String,
        pub url: String,
        pub fetch: bool,
    }

    pub struct FetchRequest {
        /// `None` fetches all remotes.
        pub remote: Option<String>,
        pub prune: bool,
        pub tags: bool,
    }

    pub struct PullRequest {
        pub remote: Option<String>,
        pub branch: Option<String>,
        pub strategy: PullStrategy,
    }

    pub struct PushRequest {
        pub remote: String,
        pub refspecs: Vec<String>,
        pub force_with_lease: bool,
        pub set_upstream: bool,
        pub tags: bool,
    }

    pub struct CredentialStoreRequest {
        pub host: String,
        pub username: String,
        pub secret: String,
    }
}

// ---------------------------------------------------------------- advanced

wire_enum! {
    pub enum SubmoduleStatus {
        Uninitialized,
        UpToDate,
        Modified,
        OutOfDate,
    }
}

wire! {
    pub struct SubmoduleInfo {
        pub name: String,
        pub path: String,
        pub url: Option<String>,
        pub head_oid: Option<Oid>,
        pub status: SubmoduleStatus,
    }

    pub struct SubmoduleUpdateRequest {
        /// Empty = all submodules.
        pub paths: Vec<String>,
        pub init: bool,
        pub recursive: bool,
    }

    pub struct WorktreeInfo {
        pub path: String,
        pub branch: Option<String>,
        pub head: Option<Oid>,
        pub is_main: bool,
        pub locked: bool,
        pub prunable: bool,
    }

    pub struct WorktreeAddRequest {
        pub path: String,
        pub branch: String,
        pub create_branch: bool,
    }

    pub struct BlameHunk {
        pub oid: Oid,
        pub author_name: String,
        pub author_time: f64,
        pub summary: String,
        /// 1-based first line in the final file.
        pub start_line: u32,
        pub line_count: u32,
        pub orig_path: String,
    }

    pub struct BlameResult {
        pub path: String,
        pub lines: Vec<String>,
        pub hunks: Vec<BlameHunk>,
    }

    pub struct FileHistoryEntry {
        pub commit: CommitSummary,
        /// Path of the file at this commit (follows renames).
        pub path: String,
        pub status: ChangeStatus,
    }

    pub struct ReflogEntry {
        pub index: u32,
        pub old_oid: Oid,
        pub new_oid: Oid,
        pub message: String,
        pub committer: Signature,
    }

    pub struct OplogEntry {
        pub id: String,
        pub time: f64,
        /// Command name, e.g. `merge`, `rebase_interactive`.
        pub operation: String,
        pub description: String,
        pub head_before: Option<Oid>,
        pub head_after: Option<Oid>,
        pub undone: bool,
    }

    pub struct OplogState {
        pub can_undo: bool,
        pub can_redo: bool,
        /// Description of the entry `undo` would revert.
        pub undo_description: Option<String>,
        pub redo_description: Option<String>,
    }
}

// ---------------------------------------------------------------- AI

wire_enum! {
    pub enum AiProviderKind {
        Anthropic,
        OpenAiCompatible,
    }
}

wire! {
    pub struct AiSettings {
        /// Off by default; no repository content leaves the machine while false.
        pub enabled: bool,
        pub provider: AiProviderKind,
        pub model: String,
        pub base_url: Option<String>,
        pub max_diff_bytes: u32,
        /// Read-only: whether a key for `provider` is in the OS keychain.
        pub has_key: bool,
    }

    pub struct AiPayloadPreview {
        pub bytes: u32,
        pub files: Vec<String>,
        pub truncated: bool,
        /// The exact text that would be sent.
        pub content: String,
    }

    pub struct PlannedStep {
        pub description: String,
        pub command: PlannedCommand,
    }

    pub struct AiPlan {
        pub id: String,
        pub prompt: String,
        pub explanation: String,
        pub steps: Vec<PlannedStep>,
        pub preview: OpPreview,
    }
}

wire_tagged! {
    pub enum SummaryTarget {
        Commit { oid: Oid },
        Branch { name: String, base: String },
    }

    pub enum AiRequest {
        CommitMessage,
        ConflictSuggestion { path: String },
        Summarize { target: SummaryTarget },
        PrDescription { base: String, head: String },
        Plan { prompt: String },
    }

    pub enum AiResponse {
        Text { text: String },
        Plan { plan: AiPlan },
    }

    /// The only operations an AI plan may contain.
    pub enum PlannedCommand {
        Checkout { target: CheckoutTarget },
        BranchCreate { request: BranchCreateRequest },
        Merge { request: MergeRequest },
        Rebase { request: RebaseRequest },
        CherryPick { request: CherryPickRequest },
        Revert { request: RevertRequest },
        Reset { request: ResetRequest },
        TagCreate { request: TagCreateRequest },
        StashSave { request: StashSaveRequest },
        Fetch { request: FetchRequest },
        Pull { request: PullRequest },
        Push { request: PushRequest },
    }
}

// ---------------------------------------------------------------- settings

wire_enum! {
    pub enum ThemePreference {
        Dark,
        Light,
        System,
    }
}

wire_enum! {
    pub enum AvatarMode {
        Off,
        Github,
        GithubAndGravatar,
    }
}

wire! {
    pub struct AppSettings {
        pub theme: ThemePreference,
        /// Custom git executable; `None` uses PATH.
        pub git_path: Option<String>,
        pub pull_strategy: PullStrategy,
        pub confirm_destructive: bool,
        pub graph_order: CommitOrder,
        pub diff_context_lines: u32,
        /// Where avatars may be fetched from (by the backend; the webview never contacts avatar hosts).
        pub avatars: AvatarMode,
        /// Decorative gradients behind the graph and on the Home page.
        pub backdrop: bool,
        /// Named groups of repository paths (Home page).
        pub workspaces: Vec<Workspace>,
    }

    /// A named group of repositories shown on the Home page.
    pub struct Workspace {
        pub id: String,
        pub name: String,
        /// Repository paths, in display order.
        pub repos: Vec<String>,
    }

    pub struct Keybinding {
        pub action: String,
        pub keys: String,
    }
}

// ---------------------------------------------------------------- avatars

wire_tagged! {
    pub enum AvatarSubject {
        Email { email: String },
        GithubLogin { login: String },
    }
}

// ---------------------------------------------------------------- forge

wire_enum! {
    pub enum ForgeKind {
        Github,
        Gitlab,
    }

    pub enum ForgeTokenSource {
        Forge,
        GitCredential,
        None,
    }

    pub enum IssueState {
        Open,
        Closed,
    }

    pub enum IssueStateFilter {
        Open,
        Closed,
        All,
    }

    pub enum PullState {
        Open,
        Closed,
        Merged,
    }

    pub enum PullStateFilter {
        Open,
        Closed,
        All,
    }
}

wire! {
    pub struct ForgeRepo {
        pub kind: ForgeKind,
        /// e.g. "github.com"
        pub host: String,
        pub owner: String,
        pub name: String,
        /// https://github.com/<owner>/<name>
        pub web_url: String,
        /// Remote the repo was derived from, e.g. "origin".
        pub remote: String,
    }

    pub struct ForgeStatus {
        /// None when no remote points at a known forge.
        pub repo: Option<ForgeRepo>,
        /// This build can talk to `repo.kind` (GitHub only for now).
        pub supported: bool,
        pub token_source: ForgeTokenSource,
    }

    pub struct ForgeUser {
        pub login: String,
    }

    pub struct Issue {
        pub number: u32,
        pub title: String,
        pub state: IssueState,
        pub author: ForgeUser,
        pub labels: Vec<String>,
        pub comments: u32,
        pub created_at: f64,
        pub updated_at: f64,
        /// Web URL of the issue.
        pub url: String,
    }

    pub struct IssueQuery {
        pub state: IssueStateFilter,
        pub page: u32,
        pub per_page: u32,
    }

    pub struct IssuePage {
        pub items: Vec<Issue>,
        pub next_page: Option<u32>,
    }

    pub struct ForgeComment {
        /// Forge id as a string (GitHub ids exceed u32).
        pub id: String,
        pub author: ForgeUser,
        /// Plain text as written (Markdown source); never rendered as HTML.
        pub body: String,
        pub created_at: f64,
        pub url: String,
    }

    pub struct IssueDetail {
        pub issue: Issue,
        pub body: String,
        pub comments: Vec<ForgeComment>,
    }

    pub struct IssueCreateRequest {
        pub title: String,
        pub body: String,
    }

    pub struct PullBranch {
        /// Branch name, e.g. "feature/login".
        pub name: String,
        /// "owner:branch" as GitHub shows it.
        pub label: String,
        pub sha: Oid,
        /// "owner/name" of the repository holding the branch; None when it was deleted.
        pub repo: Option<String>,
        /// The branch lives in another repository than the base.
        pub is_fork: bool,
    }

    pub struct ForgePull {
        pub number: u32,
        pub title: String,
        pub state: PullState,
        pub draft: bool,
        pub author: ForgeUser,
        pub head: PullBranch,
        pub base: PullBranch,
        pub labels: Vec<String>,
        pub created_at: f64,
        pub updated_at: f64,
        /// Web URL of the pull request.
        pub url: String,
    }

    pub struct PullQuery {
        pub state: PullStateFilter,
        pub page: u32,
        pub per_page: u32,
    }

    pub struct PullPage {
        pub items: Vec<ForgePull>,
        pub next_page: Option<u32>,
    }

    pub struct PullDetail {
        pub pull: ForgePull,
        /// Plain text as written (Markdown source); never rendered as HTML.
        pub body: String,
        /// Conversation comments (not review comments).
        pub comments: Vec<ForgeComment>,
        pub commits: u32,
        pub additions: u32,
        pub deletions: u32,
        pub changed_files: u32,
        /// None while GitHub is still computing it.
        pub mergeable: Option<bool>,
    }

    pub struct ForgeNotification {
        pub id: String,
        pub title: String,
        /// GitHub subject type: "Issue", "PullRequest", "Commit", "Release", "Discussion", ...
        pub kind: String,
        /// GitHub reason: "mention", "review_requested", "subscribed", ...
        pub reason: String,
        /// "owner/name"
        pub repo: String,
        pub unread: bool,
        pub updated_at: f64,
        /// https://github.com/... page of the subject; None when unknown.
        pub url: Option<String>,
    }
}

// ---------------------------------------------------------------- ssh

wire! {
    pub struct SshKey {
        /// File stem, e.g. "id_ed25519".
        pub name: String,
        /// Path of the private key file (it may not exist, see has_private_key).
        pub path: String,
        /// The whole public key line ("ssh-ed25519 AAAA... comment").
        pub public_key: String,
        /// e.g. "ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256".
        pub algorithm: String,
        /// "SHA256:..."
        pub fingerprint: String,
        pub comment: String,
        pub has_private_key: bool,
    }

    pub struct SshKeyList {
        /// The ~/.ssh directory (it may not exist yet).
        pub dir: String,
        pub keys: Vec<SshKey>,
    }

    pub struct SshKeyGenerateRequest {
        /// File stem to create in ~/.ssh, e.g. "id_ed25519_gittrunk".
        pub name: String,
        pub comment: String,
        /// None or empty = unencrypted private key.
        pub passphrase: Option<String>,
    }
}

// ---------------------------------------------------------------- terminal

wire! {
    pub struct TerminalOpenRequest {
        pub cwd: String,
        pub cols: u32,
        pub rows: u32,
    }
}

// ---------------------------------------------------------------- events

wire! {
    pub struct OpFinishedPayload {
        pub op_id: OpId,
        pub outcome: Option<OpOutcome>,
        pub error: Option<AppError>,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct RepoChanged {
    pub repo_id: RepoId,
    pub scopes: Vec<ChangeScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct OpProgress {
    pub op_id: OpId,
    pub phase: String,
    pub percent: Option<f64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct OpFinished(pub OpFinishedPayload);

/// Git needs a credential; answer with `credential_respond`.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRequested {
    pub request_id: String,
    pub url: String,
    pub username: Option<String>,
    pub kind: CredentialKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub id: String,
    pub code: Option<i32>,
}
