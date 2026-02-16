# ADR 002 - WebSocket JSON Protocol for Multiplayer Communication

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Multiplayer dice rooms require real-time bidirectional communication between the Rust server and browser clients. The protocol must support:
- Room lifecycle events (join, leave, player roster changes)
- Dice management (spawn, remove)
- Game actions (roll, settled results)
- High-frequency physics state streaming (20Hz snapshots during active rolls)
- Error reporting

The protocol must be implementable in both TypeScript (client) and Rust (server) with strong typing and easy debugging during development.

## Decision

Client-server communication MUST use **WebSocket** transport with **JSON** serialization for all message types.

### Message Discrimination

All messages MUST use a `type` field as the discriminator for tagged union deserialization:
- **Client (TypeScript):** Discriminated union via `type` literal types
- **Server (Rust):** Serde `#[serde(tag = "type")]` with `rename_all = "snake_case"`

### Client-to-Server Messages

| Type | Purpose | Key Fields |
|------|---------|------------|
| `join` | Join a room | `roomId`, `displayName`, `color` |
| `spawn_dice` | Spawn dice on the table | `dice: [{id, diceType}]` |
| `remove_dice` | Remove dice from the table | `diceIds: string[]` |
| `roll` | Roll all of the player's dice | (none) |
| `update_color` | Change player's dice color | `color` |
| `leave` | Leave the room | (none) |
| `drag_start` | Begin dragging a die | `dieId`, `grabOffset`, `worldPosition` |
| `drag_move` | Update drag target position | `dieId`, `worldPosition` |
| `drag_end` | Release die with throw data | `dieId`, `velocityHistory: [{position, time}]` |

### Server-to-Client Messages

| Type | Purpose | Key Fields |
|------|---------|------------|
| `room_state` | Full room state on join | `roomId`, `players[]`, `dice[]` |
| `player_joined` | New player entered | `player: {id, displayName, color}` |
| `player_left` | Player disconnected | `playerId` |
| `dice_spawned` | Dice added to table | `ownerId`, `dice[]` |
| `dice_removed` | Dice removed from table | `diceIds[]` |
| `roll_started` | Roll initiated | `playerId`, `diceIds[]` |
| `physics_snapshot` | Physics state update (20Hz) | `tick`, `dice: [{id, p, r}]` |
| `die_settled` | Single die reached rest | `diceId`, `faceValue`, `position`, `rotation` |
| `roll_complete` | All dice in a roll settled | `playerId`, `results[]`, `total` |
| `error` | Server error | `code`, `message` |

### Field Naming Convention

- JSON field names MUST use **camelCase** (e.g., `roomId`, `displayName`, `diceType`)
- Rust struct fields use snake_case with `#[serde(rename = "camelCase")]` annotations
- TypeScript interfaces use camelCase natively

### Compact Snapshot Fields

The `physics_snapshot` message uses compact field names to reduce bandwidth during high-frequency streaming:
- `p` for position (instead of `position`)
- `r` for rotation (instead of `rotation`)

All other messages use full field names for readability.

### Message Type Definitions

Messages MUST be defined in two locations that are kept manually in sync:
- **Client:** `src/lib/multiplayerMessages.ts` (TypeScript interfaces with discriminated union)
- **Server:** `server/src/messages.rs` (Serde-derived Rust enums/structs)

### WebSocket Lifecycle

1. Client opens WebSocket connection to `ws(s)://<server>/ws/<roomId>`
2. On connect, client sends `join` message with display name and color
3. Server responds with `room_state` containing current room snapshot
4. Server broadcasts `player_joined` to all other clients
5. Normal message exchange follows
6. On disconnect, server broadcasts `player_left` and cleans up player's state

### Error Codes

The `error` message MUST include a machine-readable `code` field. Known codes:
- `ROOM_FULL` -- Room has reached MAX_PLAYERS (8)
- `ROOM_NOT_FOUND` -- Room ID does not exist
- `DICE_LIMIT` -- Room has reached MAX_DICE (30)
- `NOT_OWNER` -- Player tried to drag another player's die
- `ALREADY_DRAGGED` -- Die is already being dragged by another player
- `DIE_NOT_FOUND` -- Referenced die does not exist

## Alternatives Considered

**Binary protocol (MessagePack / Protocol Buffers):** Would reduce bandwidth for physics snapshots, but adds serialization complexity and makes debugging harder (cannot read messages in browser DevTools). JSON is adequate for the current scale (8 players, 30 dice, 20Hz snapshots). Binary optimization can be added later for the `physics_snapshot` message type specifically if bandwidth becomes a constraint.

**Server-Sent Events (SSE) + REST:** SSE provides server-to-client streaming, but requires separate HTTP requests for client-to-server messages. WebSocket's bidirectional channel is simpler for the request-response patterns (spawn, roll) combined with streaming (snapshots).

**WebRTC Data Channels:** Provides UDP-like low-latency transport, but adds significant complexity (STUN/TURN servers, peer connection negotiation). WebSocket over TCP is reliable and sufficient for the update rates needed.

**gRPC-Web:** Provides typed bidirectional streaming with code generation, but requires a gRPC proxy layer and has limited browser support. The overhead is not justified for the current message complexity.

**Shared type generation (e.g., JSON Schema, OpenAPI):** Would automate keeping TypeScript and Rust types in sync. Not adopted due to tooling overhead; the message surface is small enough (9 client types, 10 server types) to maintain manually. Worth revisiting if the protocol grows significantly.

## Consequences

### Positive

- JSON is human-readable and inspectable in browser DevTools Network tab, accelerating debugging
- WebSocket provides low-latency bidirectional communication with minimal overhead after handshake
- Tagged union pattern (`type` field) enables clean `switch` statements in TypeScript and Serde enum deserialization in Rust
- Compact snapshot field names (`p`, `r`) reduce the per-message overhead of the highest-frequency message type
- Both TypeScript and Rust have mature JSON serialization libraries (native `JSON.parse` and `serde_json`)

### Negative / Considerations

- JSON serialization adds overhead compared to binary formats; each `physics_snapshot` with 30 dice is ~2KB of JSON text vs ~500 bytes in binary
- No schema validation at runtime; malformed messages from either side will cause parse errors that must be caught
- TypeScript and Rust message definitions must be kept in sync manually; a protocol change requires updating both `multiplayerMessages.ts` and `messages.rs`
- WebSocket requires HTTP/1.1 for the upgrade handshake; reverse proxies (Render, Fly.io) MUST be configured to support WebSocket upgrades and not force HTTP/2 for these routes
- No built-in message versioning; protocol changes require coordinated client and server deployment
