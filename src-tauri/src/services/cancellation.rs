//! Cancellation service for long-running operations

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// A token that can be used to check if an operation has been cancelled
#[derive(Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Cancel the operation
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Check if the operation has been cancelled
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Get the underlying atomic flag for use in callbacks
    pub fn flag(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Registry for tracking active operations and their cancellation tokens.
///
/// Cloning shares one map: the registry is Tauri managed state, but the
/// blocking task that actually runs a fetch/pull/push outlives the command
/// future that borrowed the `State`, so it needs an owned handle onto the same
/// table to deregister itself when it really finishes.
#[derive(Default, Clone)]
pub struct CancellationRegistry {
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl CancellationRegistry {
    /// Register a new operation and return its cancellation token
    pub fn register(&self, operation_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(operation_id, token.clone());
        }
        token
    }

    /// Cancel an operation by ID
    pub fn cancel(&self, operation_id: &str) -> bool {
        if let Ok(tokens) = self.tokens.lock() {
            if let Some(token) = tokens.get(operation_id) {
                token.cancel();
                return true;
            }
        }
        false
    }

    /// Remove an operation from the registry
    pub fn remove(&self, operation_id: &str) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.remove(operation_id);
        }
    }

    /// How many operations are currently registered. Test/diagnostic only.
    pub fn len(&self) -> usize {
        self.tokens.lock().map(|t| t.len()).unwrap_or(0)
    }

    /// Whether no operation is currently registered.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Register `operation_id` and hand back a guard that deregisters it again
    /// when dropped.
    ///
    /// A guard rather than a matching `remove` call at the end of the command:
    /// fetch/pull/push are full of `?` early returns and can fail anywhere
    /// between the network and the merge, and a leaked registration is not
    /// harmless — the id would stay cancellable forever, and the frontend
    /// reuses nothing but still, a stale entry keeps a token alive for the
    /// life of the process.
    ///
    /// `operation_id` is `None` for callers that did not ask for
    /// cancellation (the background window-focus fetch, an internal fetch).
    /// The guard is then inert: it registers nothing and its token is never
    /// cancelled.
    pub fn guard(&self, operation_id: Option<String>) -> OperationGuard {
        match operation_id {
            Some(id) => {
                let token = self.register(id.clone());
                OperationGuard {
                    registry: Some(self.clone()),
                    operation_id: id,
                    token,
                }
            }
            None => OperationGuard {
                registry: None,
                operation_id: String::new(),
                token: CancellationToken::new(),
            },
        }
    }
}

/// Deregisters its operation when dropped — on success, on an early `?`
/// return, and on a panic unwinding out of the task.
pub struct OperationGuard {
    registry: Option<CancellationRegistry>,
    operation_id: String,
    token: CancellationToken,
}

impl OperationGuard {
    /// The token to hand to the git2 callbacks.
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }

    /// The operation id, when this guard actually registered one.
    pub fn operation_id(&self) -> Option<&str> {
        self.registry.as_ref().map(|_| self.operation_id.as_str())
    }

    /// Whether cancellation has been requested for this operation.
    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        if let Some(registry) = &self.registry {
            registry.remove(&self.operation_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cancellation_token_default_not_cancelled() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn test_cancellation_token_cancel() {
        let token = CancellationToken::new();
        token.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn test_cancellation_token_clone_shares_state() {
        let token = CancellationToken::new();
        let clone = token.clone();
        token.cancel();
        assert!(clone.is_cancelled());
    }

    #[test]
    fn test_cancellation_token_flag() {
        let token = CancellationToken::new();
        let flag = token.flag();
        flag.store(true, Ordering::SeqCst);
        assert!(token.is_cancelled());
    }

    #[test]
    fn test_registry_register_and_cancel() {
        let registry = CancellationRegistry::default();
        let token = registry.register("op-1".to_string());
        assert!(!token.is_cancelled());

        let cancelled = registry.cancel("op-1");
        assert!(cancelled);
        assert!(token.is_cancelled());
    }

    #[test]
    fn test_registry_cancel_nonexistent() {
        let registry = CancellationRegistry::default();
        let cancelled = registry.cancel("nonexistent");
        assert!(!cancelled);
    }

    #[test]
    fn test_registry_remove() {
        let registry = CancellationRegistry::default();
        let _token = registry.register("op-1".to_string());
        registry.remove("op-1");
        let cancelled = registry.cancel("op-1");
        assert!(!cancelled);
    }

    #[test]
    fn clones_share_one_table() {
        let registry = CancellationRegistry::default();
        let handle = registry.clone();
        let token = handle.register("op-1".to_string());

        // The clone the blocking task carries must cancel the very operation
        // the command registered, not a private copy of the map.
        assert!(registry.cancel("op-1"));
        assert!(token.is_cancelled());
    }

    #[test]
    fn guard_registers_and_deregisters_on_drop() {
        let registry = CancellationRegistry::default();
        {
            let guard = registry.guard(Some("op-1".to_string()));
            assert_eq!(guard.operation_id(), Some("op-1"));
            assert!(registry.cancel("op-1"), "the id must be cancellable");
            assert!(guard.is_cancelled());
        }
        assert!(registry.is_empty(), "the guard must deregister on drop");
        assert!(!registry.cancel("op-1"));
    }

    #[test]
    fn guard_deregisters_when_the_operation_fails() {
        let registry = CancellationRegistry::default();
        fn run(registry: &CancellationRegistry) -> std::result::Result<(), &'static str> {
            let _guard = registry.guard(Some("op-1".to_string()));
            Err("network blew up")
        }
        let failed = run(&registry);
        assert!(failed.is_err());
        assert!(
            registry.is_empty(),
            "an early return must not leak a registration"
        );
    }

    #[test]
    fn guard_deregisters_when_the_operation_panics() {
        let registry = CancellationRegistry::default();
        let handle = registry.clone();
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = handle.guard(Some("op-1".to_string()));
            panic!("boom");
        }));
        assert!(panicked.is_err());
        assert!(
            registry.is_empty(),
            "a panic must not leak a registration either"
        );
    }

    #[test]
    fn guard_without_an_id_registers_nothing() {
        let registry = CancellationRegistry::default();
        let guard = registry.guard(None);
        assert_eq!(guard.operation_id(), None);
        assert!(!guard.is_cancelled());
        assert!(registry.is_empty());
    }
}
