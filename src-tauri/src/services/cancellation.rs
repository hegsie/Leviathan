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

/// Registry for tracking active operations and their cancellation tokens
#[derive(Default)]
pub struct CancellationRegistry {
    tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl CancellationRegistry {
    /// Register a new operation and return its cancellation token
    pub fn register(&self, operation_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        let mut tokens = self.tokens.lock().unwrap();
        tokens.insert(operation_id, token.clone());
        token
    }

    /// Cancel an operation by ID
    pub fn cancel(&self, operation_id: &str) -> bool {
        let tokens = self.tokens.lock().unwrap();
        if let Some(token) = tokens.get(operation_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    /// Remove an operation from the registry
    pub fn remove(&self, operation_id: &str) {
        let mut tokens = self.tokens.lock().unwrap();
        tokens.remove(operation_id);
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
}
