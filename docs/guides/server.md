# Server (Rust/Axum)

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed server guidance.

## axum Path Parameter Syntax
- **axum 0.7.x**: `:param` syntax (e.g., `/ws/:room_id`) — uses matchit 0.7
- **axum 0.8.x**: `{param}` syntax (e.g., `/ws/{room_id}`) — uses matchit 0.8
- Using wrong syntax creates literal routes that **silently never match** — no compile error, no runtime warning
- This caused a multi-PR debugging saga (PRs #15–#21) where WebSocket routes returned 404

## Server Architecture
- `server/src/lib.rs` exports `build_app()` — used by both `main.rs` and integration tests
- `server/src/main.rs` is a thin entry point (just startup, cleanup task, port binding)
- Run server tests: `~/.cargo/bin/cargo test` (cargo not on PATH, use full path)

## Server Test Coverage
- 57 unit tests (dice, physics, face detection, messages, rooms, players, drag mechanics)
- 19 integration tests in `server/tests/integration.rs` (HTTP routes, WebSocket upgrade, multiplayer flows, drag lifecycle)
- Integration tests spin up real axum server on random port — catches routing bugs unit tests miss
