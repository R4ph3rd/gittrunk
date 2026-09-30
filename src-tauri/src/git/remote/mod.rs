//! Remotes, network operations and credentials.
//!
//! - `manage`: remote CRUD and upstream (libgit2), trait `RemoteService`
//! - `net`: synchronous cores of fetch/pull/push/clone/remote branch delete
//! - `ops`: background op plumbing (op ids, progress events, `OpFinished`)
//! - `creds` / `keychain`: askpass bridge, prompt classification, OS keychain
//! - `progress`, `provider`, `validate`: pure helpers

pub mod creds;
pub mod keychain;
pub mod manage;
pub mod net;
pub mod ops;
pub mod progress;
pub mod provider;
pub mod validate;

pub use manage::RemoteService;

#[cfg(test)]
mod tests;
