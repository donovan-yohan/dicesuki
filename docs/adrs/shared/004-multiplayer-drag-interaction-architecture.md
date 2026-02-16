# ADR 004 - Multiplayer Drag Interaction Architecture

* Date: 2026/02/16
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Multiplayer mode originally only supported rolling dice — players could not move dice by dragging. Single-player has a drag-to-throw interaction where dice follow the finger with rotational spin, can be flicked, and collide with walls. Multiplayer needs the same interaction with additional requirements:

- **Cross-player collisions:** All dice on the table MUST physically interact regardless of which player owns them. A player dragging their die should be able to push other players' dice out of the way.
- **Ownership:** Players MUST only be able to drag their own dice, but collisions affect all.
- **Latency:** The dragging player MUST see responsive feedback (die follows finger immediately) despite server round-trip latency.
- **Screen sizes:** Desktop and mobile users share the same table simultaneously, requiring a fixed world size with adaptive camera.

## Decision

### Velocity-Based Drag Following (Server-Side)

Dragged dice MUST remain as **dynamic rigid bodies** in the server physics simulation. The server sets linear velocity toward the drag target position using `DRAG_FOLLOW_SPEED` rather than switching to kinematic mode.

- `DRAG_FOLLOW_SPEED` (12.0): Base velocity multiplier toward drag target
- `DRAG_DISTANCE_BOOST` (2.5): Additional speed multiplier when die is far from target
- `DRAG_DISTANCE_THRESHOLD` (3.0): Distance at which boost kicks in
- `DRAG_SPIN_FACTOR` (0.33): Lateral movement converted to roll torque
- `DRAG_ROLL_FACTOR` (0.5): Forward/backward movement converted to pitch torque
- `DRAG_PLANE_HEIGHT` (2.0): Y-coordinate of the drag interaction plane

This approach keeps dice as dynamic physics bodies, so cross-player collisions work naturally. Kinematic bodies would pass through other dice.

### Three-Phase Drag Protocol

The drag interaction uses three WebSocket message types:

| Type | Direction | Key Fields | Purpose |
|------|-----------|------------|---------|
| `drag_start` | Client → Server | `dieId`, `grabOffset`, `worldPosition` | Begin drag, validate ownership |
| `drag_move` | Client → Server | `dieId`, `worldPosition` | Update drag target position |
| `drag_end` | Client → Server | `dieId`, `velocityHistory` | Release die, calculate throw |

- `drag_start` MUST validate ownership (only own dice) and check the die is not already being dragged
- `drag_start` MUST start the physics simulation loop if not already running
- `drag_move` messages MUST be throttled to ~30Hz on the client (`MULTIPLAYER_DRAG_THROTTLE_MS` = 33ms)
- `drag_end` MUST include a `velocityHistory` array for throw velocity calculation

### Velocity History and Throw Calculation

The client tracks the last `VELOCITY_HISTORY_SIZE` (5) position+timestamp samples during drag. On release, this history is sent to the server in the `drag_end` message.

```typescript
interface VelocityHistoryEntry {
  position: [number, number, number]
  time: number  // ms relative to drag start
}
```

The server's `calculate_throw_velocity()` computes average velocity from the history, scales by `THROW_VELOCITY_SCALE` (0.8), adds `THROW_UPWARD_BOOST` (3.0), and clamps between `MIN_THROW_SPEED` (2.0) and `MAX_THROW_SPEED` (20.0).

### Optimistic Local Rendering

The dragging player MUST see the die at the finger position immediately (zero perceived latency):

- Client sets `isLocallyDragged = true` and `localDragPosition` on the die
- `MultiplayerDie`'s `useFrame` reads drag position via `useMultiplayerStore.getState()` (not props, to avoid re-render overhead)
- The `physics_snapshot` handler MUST skip position updates for locally dragged dice
- On drag end, `isLocallyDragged` is cleared and the die transitions back to server-interpolated position

Other clients see the dragged die via normal server snapshot interpolation (~50-150ms delay).

### Portrait-First Arena (9:16)

The multiplayer arena MUST use a 9:16 portrait aspect ratio:

- `MULTIPLAYER_ARENA_HALF_X` = 4.5 (9 units wide)
- `MULTIPLAYER_ARENA_HALF_Z` = 8.0 (16 units deep)
- Constants MUST match between `src/config/physicsConfig.ts` and `server/src/physics.rs`

The `MultiplayerCamera` component calculates camera height from the field of view to ensure the full arena is visible on any screen aspect ratio. Portrait phones see the table filling the screen; landscape desktops see a tall rectangle with space on sides.

The `MultiplayerArena` component renders themed walls, floor, and ceiling matching the single-player visual appearance (using theme tokens for colors).

## Alternatives Considered

**Kinematic drag (server switches die to kinematic mode):** Would provide perfect position tracking but kinematic bodies don't participate in collisions with other dynamic bodies in Rapier. Cross-player collisions during drag would not work, which defeats the purpose of shared physics.

**Spring/joint-based drag:** A spring joint connecting the die to the target position would provide physically-motivated following with natural oscillation. However, it introduces spring tuning complexity, potential instability, and doesn't match the single-player behavior which uses direct velocity setting.

**Client-side physics prediction during drag:** The dragging client could run local Rapier prediction and reconcile with the server. This would reduce perceived latency for cross-player collision effects but adds significant complexity (two physics worlds, reconciliation logic, desync detection) that isn't justified for a dice game.

**Fixed arena aspect ratio matching single-player (landscape):** Single-player uses the device's full screen. A landscape multiplayer arena would waste space on portrait phones (the primary target). The 9:16 portrait ratio maximizes usable area on mobile while remaining functional on desktop.

## Consequences

### Positive

- Cross-player dice collisions work naturally during drags because dice remain dynamic bodies
- Dragging player sees zero-latency feedback via optimistic local rendering
- Throw/flick behavior mirrors single-player via velocity history calculation
- 9:16 arena is mobile-optimized while accessible on all screen sizes
- Throttled drag messages (~30Hz) balance responsiveness vs bandwidth
- Ownership validation on the server prevents manipulation of other players' dice

### Negative / Considerations

- Velocity-based following introduces slight lag between finger and die position for other clients (~50-150ms)
- The server must process drag_move messages at 30Hz per dragging player, adding load
- Drag physics constants (DRAG_FOLLOW_SPEED, etc.) must be tuned for good feel; too low feels sluggish, too high causes instability
- Optimistic rendering means the dragging player and other clients may briefly see the die in different positions
- The `useMultiplayerStore.getState()` pattern in `useFrame` bypasses React's rendering cycle, which is intentional for performance but requires awareness of this pattern
- Portrait arena is narrower than single-player's full-width layout; dice may bounce more off walls in the constrained X dimension
