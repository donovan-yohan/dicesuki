# ADR 001 - Rust Axum Server Architecture

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Multiplayer dice rooms require a server that can:
- Run Rapier3D physics at 60Hz tick rate per active room
- Stream physics snapshots to connected clients at 20Hz via WebSocket
- Manage room lifecycle (creation, joining, idle cleanup)
- Handle up to 8 players and 30 dice per room
- Deploy as a single binary to a hosting platform (Render/Fly.io)

The server must run the same Rapier physics engine used client-side (Rapier WASM) but natively in Rust for performance and determinism. This rules out Node.js or other non-Rust runtimes.

## Decision

The multiplayer server MUST be implemented in **Rust** using the **Axum** web framework with **Tokio** async runtime, located in `server/`.

### Module Structure

```
server/src/
  main.rs          # Entry point, TCP listener, cleanup task
  lib.rs           # Router, middleware, HTTP handlers, CORS
  room.rs          # Room struct, ServerDie, game logic
  room_manager.rs  # Room creation, lookup, stale cleanup
  player.rs        # Player struct, connection state
  physics.rs       # PhysicsWorld wrapper around Rapier3D
  dice.rs          # Dice body creation, impulse generation, spawn positions
  face_detection.rs # Quaternion-to-face-value mapping
  messages.rs      # Serde message types (client <-> server)
  ws_handler.rs    # WebSocket connection lifecycle, message routing
```

### Concurrency Model

- The `RoomManager` MUST be wrapped in `Arc<RwLock<RoomManager>>` and shared across all handlers via Axum's `State` extractor
- Each `Room` MUST be wrapped in `Arc<RwLock<Room>>` for concurrent player access
- WebSocket connections MUST be handled by Tokio tasks spawned per connection
- Physics simulation loops MUST run as Tokio tasks per room, ticking at 60Hz
- Stale room cleanup MUST run as a background Tokio task (every 5 minutes)

### HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check with instance ID |
| POST | `/api/rooms` | Create a new room (returns `roomId`) |
| GET | `/api/rooms/:room_id` | Get room info (player count, dice count) |
| GET | `/ws/:room_id` | WebSocket upgrade for room connection |

### Room Lifecycle

1. **Creation:** `POST /api/rooms` creates a room with a 6-character nanoid
2. **Joining:** Client opens WebSocket to `/ws/:room_id` and sends a `join` message
3. **Active:** Room runs physics simulation while dice are rolling
4. **Idle timeout:** Rooms with no players for 30 minutes (`IDLE_TIMEOUT_SECS = 1800`) are destroyed by the cleanup task
5. **Limits:** Max 8 players (`MAX_PLAYERS`), max 30 dice (`MAX_DICE`) per room

### CORS

- Production: CORS restricted to the configured `CORS_ORIGIN` environment variable
- Development: Permissive CORS when `CORS_ORIGIN` is not set

### Request Logging

All requests MUST be logged via Axum middleware with:
- HTTP version, method, URI
- WebSocket requests MUST log additional diagnostic headers (Upgrade, Connection, Sec-WebSocket-Version, Sec-WebSocket-Key)
- Responses MUST log the status code
- All log lines MUST include the `INSTANCE_ID` (8-char nanoid generated at startup)

### Build Configuration

Release builds MUST use `opt-level = 3` and `lto = true` for maximum physics performance.

## Alternatives Considered

**Node.js + rapier-wasm:** Would allow code sharing with the frontend, but WASM physics in Node.js is significantly slower than native Rust Rapier3D. The 60Hz tick rate with multiple rooms requires native performance.

**Actix-web:** Another mature Rust web framework. Axum was chosen for its tighter integration with Tokio, simpler handler signatures (extractors as function arguments), and growing ecosystem adoption. Both frameworks would work.

**Go + custom physics:** Go's goroutine model is excellent for concurrent WebSocket handling, but no mature 3D physics engine exists in Go. Wrapping a C physics library via CGo adds complexity and loses the type-safety advantage.

**Warp:** A Rust web framework with a composable filter system. Axum's more conventional routing and extractor model was preferred for readability and contributor onboarding.

## Consequences

### Positive

- Native Rapier3D runs at full CPU speed, comfortably handling 60Hz physics for multiple rooms
- Single static binary deployment simplifies hosting (no runtime, no dependencies)
- Tokio provides efficient async I/O for many concurrent WebSocket connections
- Axum's extractor pattern makes handler signatures self-documenting
- Instance ID in all logs enables debugging multi-instance deployments
- The same Rapier engine (native vs WASM) ensures physics parity between server and client

### Negative / Considerations

- Rust has a steeper learning curve than TypeScript/Go for new contributors
- No shared code between client (TypeScript) and server (Rust) for message types; message schemas must be kept in sync manually (see `shared/002-websocket-json-protocol.md`)
- `RwLock` contention under high load could bottleneck room state access; profiling may reveal a need for per-room message channels or actor-based concurrency
- Rooms are ephemeral (in-memory only); server restart destroys all active rooms. Persistent rooms would require a storage layer
- WebSocket upgrades require HTTP/1.1; reverse proxies MUST be configured to avoid HTTP/2 upgrade failures (documented in recent fix commits)
