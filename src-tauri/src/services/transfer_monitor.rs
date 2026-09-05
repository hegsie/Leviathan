//! Cancellation and progress reporting for a network transfer.
//!
//! `clone_repository` has always done both: it checks a cancel flag inside
//! git2's `transfer_progress` callback (the only abort point libgit2 offers)
//! and emits a progress event from the same place, throttled so a large
//! transfer does not flood IPC. Fetch, pull and push accepted an
//! `operation_id` and did neither — nothing was ever registered with the
//! `CancellationRegistry`, so `cancel_operation` always answered `false`, and
//! no backend code emitted the `operation-progress` event the frontend
//! listens for. This module is that behaviour, factored out so all of them
//! share one implementation.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde::Serialize;

use crate::services::cancellation::CancellationToken;

/// One `operation-progress` event.
///
/// `operationId` is the id the FRONTEND generated in
/// `progress.service.ts::startOperation` and passed into the command, so the
/// event lands on the row the user is looking at.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgress {
    pub operation_id: String,
    pub message: String,
    /// 0-100, or `None` while the remote has not announced a total yet — the
    /// indicator shows its indeterminate stripe for `None`.
    pub progress: Option<u8>,
    pub received_objects: usize,
    pub total_objects: usize,
    pub received_bytes: usize,
}

/// Where a progress event goes. Boxed rather than an `AppHandle` so the
/// throttling and the percent maths are unit-testable without a Tauri app.
pub type ProgressSink = Arc<dyn Fn(OperationProgress) + Send + Sync>;

/// Percent of a transfer, or `None` when the total is not known yet.
fn percent_of(done: usize, total: usize) -> Option<u8> {
    if total == 0 {
        return None;
    }
    Some(((done.min(total) * 100 / total) as u8).min(100))
}

/// Cancellation flag plus throttled progress reporting for one transfer.
///
/// Cloning shares the throttle state and the token: the same monitor is used
/// from the git2 callback and from the error site that has to say WHY the
/// transfer stopped.
#[derive(Clone)]
pub struct TransferMonitor {
    operation_id: Option<String>,
    message: String,
    cancel: Option<CancellationToken>,
    sink: Option<ProgressSink>,
    /// Last emitted percent, or `usize::MAX` before the first emission so the
    /// very first callback always reports something.
    last_percent: Arc<AtomicUsize>,
}

impl Default for TransferMonitor {
    fn default() -> Self {
        Self::disabled()
    }
}

impl TransferMonitor {
    /// A monitor that reports nothing and is never cancelled — for callers
    /// that did not ask for either (the background fetch, the auto-fetch
    /// service, an internal fetch, and every unit test that only cares about
    /// the git plumbing).
    pub fn disabled() -> Self {
        Self {
            operation_id: None,
            message: String::new(),
            cancel: None,
            sink: None,
            last_percent: Arc::new(AtomicUsize::new(usize::MAX)),
        }
    }

    /// A monitor that honours `cancel` and reports progress to `sink`.
    ///
    /// `operation_id` is `None` when the caller did not pass one, in which
    /// case no event can be addressed to a row and none is emitted — but the
    /// token is still honoured.
    pub fn new(
        operation_id: Option<String>,
        message: impl Into<String>,
        cancel: CancellationToken,
        sink: ProgressSink,
    ) -> Self {
        Self {
            operation_id,
            message: message.into(),
            cancel: Some(cancel),
            sink: Some(sink),
            last_percent: Arc::new(AtomicUsize::new(usize::MAX)),
        }
    }

    /// The same monitor with a different row message.
    ///
    /// The remote a pull or push actually contacts is only known once the
    /// branch's upstream has been resolved, deeper in than the command that
    /// built the monitor — this is how the row gets to say "Pulling from
    /// upstream" rather than a generic "Pulling".
    pub fn with_message(&self, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            ..self.clone()
        }
    }

    /// Whether the user asked for this operation to stop.
    pub fn is_cancelled(&self) -> bool {
        self.cancel.as_ref().is_some_and(|t| t.is_cancelled())
    }

    /// Report a transfer snapshot, throttled to one event per whole percent.
    ///
    /// Unthrottled this fires for every packet libgit2 receives — tens of
    /// thousands of IPC messages on a big clone, each one re-rendering the
    /// progress row. `clone_repository` throttles the same way.
    pub fn report(&self, done: usize, total: usize, bytes: usize) {
        let (Some(sink), Some(operation_id)) = (self.sink.as_ref(), self.operation_id.as_ref())
        else {
            return;
        };
        let progress = percent_of(done, total);
        // `None` (no total yet) is keyed as 101 so it is distinct from 0% and
        // still reported exactly once.
        let key = progress.map_or(101usize, |p| p as usize);
        if self.last_percent.swap(key, Ordering::Relaxed) == key {
            return;
        }
        sink(OperationProgress {
            operation_id: operation_id.clone(),
            message: self.message.clone(),
            progress,
            received_objects: done,
            total_objects: total,
            received_bytes: bytes,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn recording() -> (
        TransferMonitor,
        CancellationToken,
        Arc<Mutex<Vec<OperationProgress>>>,
    ) {
        let events: Arc<Mutex<Vec<OperationProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        let token = CancellationToken::new();
        let monitor = TransferMonitor::new(
            Some("op-1".to_string()),
            "Fetching from origin",
            token.clone(),
            Arc::new(move |p| sink_events.lock().unwrap().push(p)),
        );
        (monitor, token, events)
    }

    #[test]
    fn percent_is_none_until_the_total_is_known() {
        assert_eq!(percent_of(0, 0), None);
        assert_eq!(percent_of(5, 0), None);
        assert_eq!(percent_of(0, 10), Some(0));
        assert_eq!(percent_of(5, 10), Some(50));
        assert_eq!(percent_of(10, 10), Some(100));
    }

    /// libgit2 can report more received than total mid-transfer; the bar must
    /// not run past 100.
    #[test]
    fn percent_is_clamped() {
        assert_eq!(percent_of(30, 10), Some(100));
    }

    #[test]
    fn reports_real_counts_for_the_operation_id() {
        let (monitor, _token, events) = recording();
        monitor.report(25, 100, 4096);

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            OperationProgress {
                operation_id: "op-1".to_string(),
                message: "Fetching from origin".to_string(),
                progress: Some(25),
                received_objects: 25,
                total_objects: 100,
                received_bytes: 4096,
            }
        );
    }

    #[test]
    fn throttles_to_one_event_per_percent() {
        let (monitor, _token, events) = recording();
        // 1000 objects, so ten callbacks land inside the same whole percent.
        for received in 0..10 {
            monitor.report(received, 1000, received * 100);
        }
        monitor.report(50, 1000, 5000);

        let events = events.lock().unwrap();
        assert_eq!(
            events.len(),
            2,
            "one event for 0% and one for 5%, not one per callback"
        );
        assert_eq!(events[0].progress, Some(0));
        assert_eq!(events[1].progress, Some(5));
    }

    #[test]
    fn reports_the_unknown_total_once() {
        let (monitor, _token, events) = recording();
        monitor.report(0, 0, 0);
        monitor.report(0, 0, 0);

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].progress, None);
    }

    #[test]
    fn a_disabled_monitor_emits_nothing_and_never_cancels() {
        let monitor = TransferMonitor::disabled();
        monitor.report(1, 2, 3);
        assert!(!monitor.is_cancelled());
    }

    #[test]
    fn cancellation_is_visible_through_a_clone() {
        let (monitor, token, _events) = recording();
        let in_callback = monitor.clone();
        assert!(!in_callback.is_cancelled());
        token.cancel();
        assert!(in_callback.is_cancelled());
    }

    #[test]
    fn without_an_operation_id_nothing_is_emitted_but_cancel_still_works() {
        let events: Arc<Mutex<Vec<OperationProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        let token = CancellationToken::new();
        let monitor = TransferMonitor::new(
            None,
            "Fetching",
            token.clone(),
            Arc::new(move |p| sink_events.lock().unwrap().push(p)),
        );
        monitor.report(1, 2, 3);
        assert!(events.lock().unwrap().is_empty());
        token.cancel();
        assert!(monitor.is_cancelled());
    }
}
