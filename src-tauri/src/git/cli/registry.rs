use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use crate::ipc::types::OpId;

/// Cancellation handle of one running operation.
#[derive(Default)]
pub struct OpHandle {
    cancelled: AtomicBool,
    child: Mutex<Option<Arc<Mutex<Child>>>>,
}

impl OpHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Called by the runner once the child exists.
    pub(crate) fn attach(&self, child: Arc<Mutex<Child>>) {
        if self.is_cancelled() {
            super::kill(&child);
        }
        *self.child.lock() = Some(child);
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = self.child.lock().as_ref() {
            super::kill(child);
        }
    }
}

/// Maps `OpId` to the running child so `op_cancel` can kill it.
#[derive(Clone, Default)]
pub struct OpRegistry {
    ops: Arc<Mutex<HashMap<OpId, Arc<OpHandle>>>>,
}

impl OpRegistry {
    /// Registers an operation; it stays registered until `finish`.
    pub fn register(&self, id: &str) -> Arc<OpHandle> {
        let handle = Arc::new(OpHandle::default());
        self.ops.lock().insert(id.to_string(), handle.clone());
        handle
    }

    pub fn finish(&self, id: &str) {
        self.ops.lock().remove(id);
    }

    /// Cancels `id`; returns whether such an operation was running.
    pub fn cancel(&self, id: &str) -> bool {
        let handle = self.ops.lock().get(id).cloned();
        match handle {
            Some(h) => {
                h.cancel();
                true
            }
            None => false,
        }
    }
}
