# Daisu server workspace

A Cargo workspace with two crates (issue #112):

```
server/            # workspace root = the `dicesuki-server` package (binary + lib)
├── src/           #   net/runtime layer: axum routes, ws_handler, auth, discord,
│                  #   registry heartbeat, room_manager, the tokio tick driver
│                  #   (simulation.rs) — everything that needs tokio/axum/reqwest.
└── core/          # the `dicesuki-core` package (pure game engine, no async runtime)
    └── src/       #   physics, dice, room state & simulation, protocol messages,
                   #   face detection. Compiles for native AND wasm32.
```

`dicesuki-core` is the single source of truth for physics/dice/room/protocol
logic and its constants. It has **no** `tokio`, `axum`, or `reqwest` in its
dependency graph, so the same engine can compile to a wasm room worker
(issue #113) without any wasm-specific game-logic fork. Platform glue is confined
to three seams:

- **Clock** — `web_time::Instant` (std on native, Performance API on wasm).
- **RNG** — `rand` + the `getrandom` `js` feature (wasm-target-gated).
- **Output** — the `dicesuki_core::sink::MessageSink` trait: the server wraps a
  tokio mpsc sender (`MpscSink` in `ws_handler.rs`); a future worker wraps
  `postMessage`.

## Commands (run from `server/`)

```bash
# Build + test the whole workspace (root server + core). `default-members`
# makes bare `cargo` cover both crates.
~/.cargo/bin/cargo build
~/.cargo/bin/cargo test

# Release server binary (used by the Docker/playtest deploy).
~/.cargo/bin/cargo build --release

# CI check: the core crate MUST keep compiling for the browser target so the
# wasm room worker (issue #113) stays buildable. Run on every core change.
rustup target add wasm32-unknown-unknown   # once
~/.cargo/bin/cargo build -p dicesuki-core --target wasm32-unknown-unknown
```
