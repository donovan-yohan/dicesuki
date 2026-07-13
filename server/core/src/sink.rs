//! Output seam for room broadcasts.
//!
//! Core game logic never talks to a socket directly. It emits
//! [`ServerMessage`]s through a [`MessageSink`], which each host implements:
//! the native server wraps a `tokio::sync::mpsc::UnboundedSender`; a future
//! wasm room worker (issue #113) wraps `postMessage`. This is the only place
//! the runtime crosses into core, and it carries no game logic — so there is no
//! wasm-specific behavior fork (epic #111 anti-drift guardrail).

use crate::messages::ServerMessage;

/// A destination a [`Player`](crate::player::Player) can be handed so the room
/// can push protocol messages to it. `Send + Sync` because a `Room` is shared
/// across async tasks behind `Arc<RwLock<..>>` on the server.
pub trait MessageSink: Send + Sync {
    /// Deliver one message. Returns `false` if the destination is gone (e.g. the
    /// client's receiver was dropped), matching tokio mpsc's send semantics.
    fn send(&self, msg: &ServerMessage) -> bool;
}

#[cfg(test)]
pub mod testing {
    //! Runtime-free drop-in for `tokio::sync::mpsc::unbounded_channel()` used by
    //! the core `player`/`room` unit tests, so those tests need no async runtime.
    //!
    //! Faithfully mirrors tokio's liveness semantics: once the receiver is
    //! dropped, [`TestSink::send`] returns `false` (via a `Weak` upgrade).

    use super::MessageSink;
    use crate::messages::ServerMessage;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex, Weak};

    type Buf = Mutex<VecDeque<ServerMessage>>;

    #[derive(Clone)]
    pub struct TestSink {
        buf: Weak<Buf>,
    }

    pub struct TestReceiver {
        buf: Arc<Buf>,
    }

    impl MessageSink for TestSink {
        fn send(&self, msg: &ServerMessage) -> bool {
            match self.buf.upgrade() {
                Some(buf) => {
                    buf.lock().expect("test buffer poisoned").push_back(msg.clone());
                    true
                }
                None => false,
            }
        }
    }

    impl TestReceiver {
        /// `Ok(msg)` when a message is queued, `Err(())` when empty — matching the
        /// `.is_ok()` / `.is_err()` checks in the broadcast tests. The unit error
        /// mirrors tokio's `try_recv` shape closely enough for those assertions.
        #[allow(clippy::result_unit_err)]
        pub fn try_recv(&mut self) -> Result<ServerMessage, ()> {
            self.buf.lock().expect("test buffer poisoned").pop_front().ok_or(())
        }
    }

    #[must_use]
    pub fn unbounded_channel() -> (TestSink, TestReceiver) {
        let buf = Arc::new(Mutex::new(VecDeque::new()));
        let sink = TestSink { buf: Arc::downgrade(&buf) };
        (sink, TestReceiver { buf })
    }
}
