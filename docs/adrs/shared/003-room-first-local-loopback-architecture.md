# ADR 003 - Room-First Local Loopback Architecture

* Date: 2026/07/03
* Status: Accepted
* Deciders: KyleKaster, Development Team

## Context

The prototype had two physics products:

1. `/` single-player used client-side Rapier WASM physics.
2. `/room/:roomId` multiplayer used server-authoritative native Rust Rapier physics.

That split made every physics rule, interaction, and permission decision easy to drift. The target product is shared dice rooms, so single-player should not be a separate simulation architecture. At the same time, normal solo play must not require public online infrastructure.

## Decision

Dicesuki uses a **room-first architecture**:

- A room is the core gameplay primitive.
- Single-player is a one-player room connected to a local loopback Rust server.
- Multiplayer uses the same room protocol against a remote or shared Rust server.
- Clients send intents/commands, not physics truth.
- The server/room engine owns authoritative Rapier simulation, dice transforms, collision response, face values, room bounds, ownership, and permission policy.

The default room box is a fixed 16:9 landscape arena:

- `WALL_HALF_X = 8.0`
- `WALL_HALF_Z = 4.5`

The server simulates at 60Hz and streams `physics_snapshot` updates every active tick (`SNAPSHOT_DIVISOR = 1`) so interaction does not visibly stutter.

## Local Loopback Solo Mode

The default app route (`/`) starts/join an implicit solo room via the REST/WebSocket API:

1. `POST /api/rooms`
2. `ws://<server>/ws/<roomId>`
3. send `join`
4. render the same server-authoritative room scene used for multiplayer

In development, `npm run dev` starts:

- Rust room server
- Vite frontend
- dice manifest watcher

If port 8080 is occupied, run both sides with matching ports, e.g.:

```bash
PORT=8090 VITE_MULTIPLAYER_SERVER_URL=ws://localhost:8090 npm run dev
```

## Motion Control Policy

Device motion is a room command, not local-only physics. The protocol supports:

- `off`: clear this player's motion control
- `own_dice`: apply this player's requested gravity only to dice they own
- `room`: apply this player's requested gravity to every die in the room

Default user policy:

- players roll/control only their own dice by default;
- dice still collide with all dice in the room;
- dragging/tapping/throwing own dice remains available unless future room rules disable it;
- room-wide motion control is an explicit mode and can later be gated by turn ownership.

## Consequences

### Positive

- One set of gameplay primitives for solo and multiplayer.
- Server is the single source of truth for collisions, results, and permissions.
- Single-player still avoids public online infrastructure through loopback.
- 60Hz snapshots reduce visual stutter during active interaction.
- Motion-control semantics are explicit and testable.

### Negative / Follow-ups

- Solo mode now depends on a local Rust server process in dev/packaged builds.
- Packaging/offline distribution needs a bundled/spawned local server or equivalent local room engine.
- Inventory/custom dice identity is still not carried through the room protocol.
- Haptics and some local-only affordances need server events or a client-side interpretation layer.
- `localhost:8080` conflicts need either an alternate port env pair or automatic fallback later.
