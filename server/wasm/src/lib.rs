//! `dicesuki-wasm` — the in-browser room worker's engine module (issue #113).
//!
//! This crate is **platform glue only**. The dice engine — physics stepping,
//! dice impulse, room simulation, the JSON protocol, and face detection — is
//! `dicesuki-core`, compiled here to `wasm32-unknown-unknown`. It is the *same
//! crate* the native multiplayer server links, never a re-implementation (epic
//! #111 anti-drift guardrail).
//!
//! The public surface is a single [`WasmRoom`] the Web Worker instantiates and
//! drives:
//! - construct → an empty solo room,
//! - `handle_message(json)` → decode one client protocol message and mutate the
//!   room (join / spawn_dice / roll / drag_* / motion_impulse / update_settings / …),
//! - `tick(dt)` → advance the 60Hz simulation one fixed step,
//! - both return the resulting `ServerMessage`s as a JS array of JSON strings
//!   **and** invoke the optional outbound callback passed to the constructor.
//!
//! All orchestration (which room method to call, which messages to fan out)
//! lives in the pure-Rust [`host::RoomHost`], so the JS worker shim carries zero
//! game logic and the logic is unit-tested on the native target.

pub mod host;

#[cfg(target_arch = "wasm32")]
mod wasm {
    use crate::host::RoomHost;
    use dicesuki_core::config::EngineConfig;
    use js_sys::{Array, Function};
    use wasm_bindgen::prelude::*;

    /// The engine physics constants, as a JSON string, from the SAME
    /// `dicesuki-core` build that runs the room. This is the single-source
    /// surface for values the browser needs *before* a room exists (e.g. arena
    /// bounds for an initial camera fit); once a room is joined the identical
    /// config also rides on every `room_state` message. Never a copied literal
    /// (epic #111, Shared-ADR-007).
    #[wasm_bindgen(js_name = engineConfigJson)]
    #[must_use]
    pub fn engine_config_json() -> String {
        EngineConfig::current_json()
    }

    /// A solo in-browser room: `dicesuki-core` compiled to wasm, driven by the
    /// Web Worker host shim. One instance per worker.
    #[wasm_bindgen]
    pub struct WasmRoom {
        host: RoomHost,
        /// Optional JS callback invoked once per outbound message with its
        /// protocol JSON string. Set via the constructor; when absent, callers
        /// read the returned array instead.
        on_message: Option<Function>,
    }

    #[wasm_bindgen]
    impl WasmRoom {
        /// Construct an empty solo room.
        ///
        /// `room_id` labels the room in `room_state`. `on_message` (optional) is
        /// called with each outbound protocol JSON string as it is produced; it
        /// is the worker's `postMessage` pump. Every mutating method also returns
        /// the same messages as an array, so a purely polling host works too.
        #[wasm_bindgen(constructor)]
        #[must_use]
        pub fn new(room_id: String, on_message: Option<Function>) -> Self {
            // Readable panics in the browser console during development.
            console_error_panic_hook::set_once();
            Self {
                host: RoomHost::new(room_id),
                on_message,
            }
        }

        /// Decode and apply one inbound client protocol message. Returns the
        /// resulting outbound messages (JSON strings); also invokes `on_message`.
        #[wasm_bindgen(js_name = handleMessage)]
        pub fn handle_message(&mut self, json: &str) -> Array {
            self.host.handle_message(json);
            self.flush()
        }

        /// Advance the simulation one fixed 60Hz step. `dt_ms` is accepted for
        /// symmetry with a wall-clock driver but ignored (core uses a fixed
        /// timestep). Returns the outbound messages; also invokes `on_message`.
        pub fn tick(&mut self, dt_ms: f64) -> Array {
            self.host.tick(dt_ms);
            self.flush()
        }

        /// Whether the room currently wants ticks. The worker can pause its timer
        /// while this is `false` to avoid burning a frame budget on an idle room.
        #[wasm_bindgen(js_name = isSimulating)]
        #[must_use]
        pub fn is_simulating(&self) -> bool {
            self.host.is_simulating()
        }

        /// Drain queued messages: push each JSON string to `on_message` (if set)
        /// and collect them into the returned array.
        fn flush(&mut self) -> Array {
            let out = Array::new();
            for json in self.host.drain_json() {
                let value = JsValue::from_str(&json);
                if let Some(cb) = &self.on_message {
                    // A throwing callback must not corrupt room state; ignore the
                    // result. The array return remains authoritative.
                    let _ = cb.call1(&JsValue::NULL, &value);
                }
                out.push(&value);
            }
            out
        }
    }
}
