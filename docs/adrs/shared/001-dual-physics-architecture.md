# ADR 001 - Dual Physics Architecture for Single-Player and Multiplayer

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Daisu operates in two modes:

1. **Single-player:** One user rolls dice locally on their device. Physics runs entirely in the browser.
2. **Multiplayer:** Up to 8 players share a room, roll dice on a shared table, and see each other's results in real-time. Physics must be authoritative (one source of truth) to prevent desync.

These modes have fundamentally different requirements:
- Single-player benefits from local physics (zero latency, works offline)
- Multiplayer requires server-authoritative physics (all clients see identical results)
- Both modes must produce the same physics behavior (dice feel the same in both modes)

## Decision

The project MUST maintain a **dual physics architecture** where single-player and multiplayer use the same Rapier physics engine but run it in different locations.

### Single-Player Mode (Client-Side Physics)

- Rapier WASM (`@react-three/rapier` v2) MUST run inside a `<Physics>` provider in the React component tree
- `RigidBody` components wrap each die mesh, providing physics simulation, collision detection, and contact force callbacks
- Face detection reads quaternion orientation from `RigidBody` refs
- All physics state is local; no network communication
- Haptic feedback, device motion, and saved roll bonuses are only available in this mode
- Drag-to-throw uses direct RigidBody velocity setting via local Rapier refs

### Multiplayer Mode (Server-Side Physics)

- Rapier3D (`rapier3d` v0.22) MUST run natively in the Rust server at 60Hz tick rate
- The client MUST NOT render a `<Physics>` provider in multiplayer mode
- Dice are rendered as positioned meshes only (no local physics bodies)
- The server streams `physics_snapshot` messages at 20Hz (every 3rd physics tick)
- Clients MUST interpolate between snapshots using lerp (position) and slerp (rotation) for smooth 60fps rendering
- Face detection runs server-side; the server sends `die_settled` messages with the authoritative face value
- Drag-to-throw is available via server-side velocity-based following (see Shared-ADR-004)
- Dragged dice remain dynamic bodies (not kinematic) to enable cross-player collisions

### Shared Physics Constants

The following constants MUST match between `src/config/physicsConfig.ts` (client) and `server/src/physics.rs` + `server/src/room.rs` (server). Divergence will cause dice to behave differently between modes.

| Constant | Value | Client Location | Server Location |
|----------|-------|-----------------|-----------------|
| Gravity | -9.81 m/s^2 | `physicsConfig.ts` | `physics.rs` |
| Dice restitution | 0.3 | `physicsConfig.ts` | `physics.rs` |
| Dice friction | 0.6 | `physicsConfig.ts` | `physics.rs` |
| D6 chamfer radius | 0.08 | `physicsConfig.ts` | `dice.rs` |
| Linear velocity threshold | 0.01 m/s | `physicsConfig.ts` | `physics.rs` |
| Angular velocity threshold | 0.01 rad/s | `physicsConfig.ts` | `physics.rs` |
| Rest duration | 500 ms | `physicsConfig.ts` | `physics.rs` |
| Roll horizontal range | 1-3 units | `physicsConfig.ts` | `dice.rs` |
| Roll vertical range | 3-5 units | `physicsConfig.ts` | `dice.rs` |
| Max dice velocity | 25 m/s | `physicsConfig.ts` | `physics.rs` |
| Arena half-width (X) | 4.5 units | `physicsConfig.ts` | `physics.rs` |
| Arena half-depth (Z) | 8.0 units | `physicsConfig.ts` | `physics.rs` |
| Drag follow speed | 12.0 | `physicsConfig.ts` | `physics.rs` |
| Drag plane height | 2.0 | `physicsConfig.ts` | `physics.rs` |
| Throw velocity scale | 0.8 | `physicsConfig.ts` | `physics.rs` |
| Max throw speed | 20.0 | `physicsConfig.ts` | `physics.rs` |

### Snapshot Interpolation (Client)

- `useMultiplayerStore` maintains `prevPosition`/`prevRotation` and `targetPosition`/`targetRotation` for each die
- On each `physics_snapshot` message, the current target becomes the previous, and new positions become the target
- The render loop interpolates between prev and target based on elapsed time since last snapshot (`lastSnapshotTime`)
- `snapshotInterval` is configured to 50ms (20Hz)

## Alternatives Considered

**Client-side physics in multiplayer with server reconciliation:** Each client runs its own physics and the server corrects drift. This provides lower perceived latency but introduces complexity around reconciliation, rubber-banding, and ensuring all clients converge on the same face value. The added complexity is not justified for a turn-based dice game.

**Server-side physics for both modes:** Would simplify the architecture to a single physics location, but requires an always-on server connection for single-player and adds latency to every roll. Single-player offline support would be lost.

**Deterministic lockstep (shared seed, replay inputs):** Theoretically eliminates the need for physics streaming by having all clients replay the same deterministic simulation. Rapier does not guarantee cross-platform determinism (WASM vs native may diverge), making this approach unreliable.

**Client prediction with server authority:** The rolling client runs local physics prediction while the server simulates authoritatively. Would improve perceived latency for the roller but adds significant complexity for a dice game where rolls take 1-3 seconds to settle.

## Consequences

### Positive

- Single-player has zero latency and works fully offline
- Multiplayer has a single authoritative physics source, guaranteeing all players see the same results
- Using the same Rapier engine (WASM vs native) ensures dice feel consistent across modes
- Snapshot interpolation provides smooth visuals despite 20Hz server update rate
- Clean separation: multiplayer components never instantiate physics providers

### Negative / Considerations

- Physics constants must be manually kept in sync between TypeScript and Rust; no automated validation exists
- Any change to physics tuning (restitution, friction, thresholds) requires updating both codebases and redeploying both client and server
- Face detection logic is duplicated: quaternion-to-face mapping exists in both `src/lib/geometries.ts` (client) and `server/src/face_detection.rs` (server)
- Snapshot interpolation introduces ~50-100ms visual delay for remote players' dice
- Features available only in single-player mode (haptics, device motion, saved rolls, inventory) create a feature gap between modes
- The dual architecture means twice the physics-related code to maintain and test
