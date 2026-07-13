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

## Room Lifecycle & Reconnect (issue #71)

- **Player cap**: `playerCap` is a host-configurable `room_settings` field, clamped
  `1..=MAX_PLAYERS` (8). `Room::is_full()` reads it; enforced server-side in `Room::join`.
  Grace-held seats (below) count against the cap so a returning player isn't crowded out.
- **Reconnect token**: the client mints a stable per-room token (sessionStorage) and sends
  it in `join.reconnectToken`. `RoomState` echoes the recipient's id as `localPlayerId` so the
  client identifies itself deterministically (a reclaimed seat isn't last in the unordered list).
- **Graceful rejoin**: an unexpected drop (socket close/error) calls `Room::mark_disconnected` —
  the seat, dice, name, color, and (conditionally) host are **held** for `RECONNECT_GRACE_SECS`
  (120s), not removed. An explicit `leave` message frees the seat immediately. Rejoin with the
  same token within the window reclaims the original identity via `Room::join` (no duplicate seat,
  no `player_joined`/`player_left` churn for others).
- **Host reclaim policy** (interacts with #68's oldest-player transfer): on disconnect, host
  transfers to the oldest **connected** player if one exists (room stays controllable). If the
  dropped player was the sole live occupant, the seat keeps host and reclaims it on rejoin. An
  active host is never usurped by a returning player — no host thrash.
- **Stale-room policy**: `RoomManager::run_maintenance` runs every 60s (was a 5-min cleanup-only
  task). It first expires grace windows (broadcasting `dice_removed`/`player_left`/`host_changed`),
  then removes rooms empty past `IDLE_TIMEOUT_SECS` (30 min). Grace expiry can empty a room, making
  it idle-eligible in the same pass. The 60s cadence keeps the 120s grace window responsive.
- **Client notice**: on an unexpected drop the client auto-reconnects with exponential backoff
  (5 attempts). If it exhausts them (room gone / idle-cleaned), it surfaces a user-facing
  `roomClosedNotice` in the join screen instead of failing silently.

## Server Test Coverage
- 57 unit tests (dice, physics, face detection, messages, rooms, players, drag mechanics)
- 19 integration tests in `server/tests/integration.rs` (HTTP routes, WebSocket upgrade, multiplayer flows, drag lifecycle)
- Integration tests spin up real axum server on random port — catches routing bugs unit tests miss
