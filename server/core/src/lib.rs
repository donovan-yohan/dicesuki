//! `dicesuki-core` — the pure game engine shared by the native multiplayer
//! server and (via issue #113) an in-browser wasm room worker.
//!
//! This crate contains physics stepping, dice spawning/impulse, room state &
//! simulation, the WebSocket JSON protocol message types, and server-side face
//! detection. It has **no** `tokio`, `axum`, or `reqwest` in its dependency
//! graph, so it compiles unchanged for `wasm32-unknown-unknown`.
//!
//! Platform glue is confined to two seams so no wasm-specific *game-logic* fork
//! ever leaks into core (see epic #111 anti-drift guardrail):
//! - **Clock**: `web_time::Instant` (std on native, Performance API on wasm).
//! - **RNG**: `rand` + `getrandom` `js` feature on wasm.
//! - **Output**: the [`sink::MessageSink`] trait — the server wraps a tokio mpsc
//!   sender; a future worker wraps `postMessage`.

pub mod config;
pub mod dice;
pub mod face_detection;
pub mod messages;
pub mod physics;
pub mod player;
pub mod room;
pub mod sink;
