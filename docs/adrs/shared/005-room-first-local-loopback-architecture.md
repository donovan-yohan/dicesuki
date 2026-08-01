# ADR 005 - Room-First Local Loopback Architecture

* Date: 2026/07/13
* Status: Accepted
* Deciders: Donovan, Development Team
* Supersedes: [ADR 001 - Dual Physics Architecture](001-dual-physics-architecture.md)
* Amended: 2026/07/28 — see [Amendments](#amendments) (the anonymous-dice
  presentation clause is superseded by infinite basic dice)

## Context

ADR 001 established a **dual physics architecture**: single-player ran Rapier WASM
locally inside a `<Physics>` provider, while multiplayer ran server-authoritative
Rapier3D. The two modes shared physics constants but had two independent code paths
for spawning, simulating, dragging, and settling dice. This created a persistent
feature gap (haptics, device motion, saved rolls, and inventory only worked in the
local path), doubled the physics surface area to maintain and test, and meant every
new dice capability had to be built twice.

The room-first refactor (landed via PR #52, merge commit `2073e28`, and follow-up
theme/inventory PRs #55-#60) collapses these two paths into one. Solo play is now
modeled as a **one-player local loopback room** that uses the exact same room
protocol, server-authoritative physics, and rendering path as multiplayer. There is
no longer a client-side `<Physics>` provider for normal dice play.

## Decision

The project MUST treat **the room as the single primitive for all dice play**. Solo
and multiplayer differ only in player count and server location, not in code path.

### Solo = One-Player Local Loopback Room

- Solo mode MUST join an implicit one-player room served by a local Rust room server
  (loopback, `127.0.0.1`), reached from the Settings **Open Local Solo Room** action.
- The client MUST verify the local room server is reachable (`GET /health` returns
  `status: "ok"` and an `instanceId`) before joining the implicit solo room.
- When the local server is unavailable, the UI MUST surface an actionable error that
  names the loopback URL and the `npm run dev:local-room` start command, rather than
  leaving the user on an indefinite loader.
- Local loopback server configuration (`VITE_LOCAL_ROOM_SERVER_URL` /
  `VITE_LOCAL_ROOM_SERVER_HTTP_URL`) MUST remain separate from public multiplayer
  server configuration.

### Room Protocol Is the Single Dice Path

- Both solo and multiplayer dice MUST flow through the room WebSocket protocol
  (`join`, `room_state`, `spawn_dice`, `dice_spawned`, `physics_snapshot`,
  `die_settled`, drag messages).
- `room_state` MUST carry an explicit `localPlayerId` so the client knows which
  player it controls.
- Owned/inventory dice identity MUST be carried end-to-end via the `presentation`
  metadata on spawn (`inventoryDieId`, `displayName`, `setId`, `rarity`, `baseColor`,
  `customAssetId`, `customAssetName`, and an `unsupportedReason` fallback field).
  The server treats gameplay physics as authoritative and `presentation` as
  client-provided display metadata. ~~Generic anonymous dice (e.g. `d20`, `2d6`) MUST
  continue to spawn without any presentation block.~~
  **Superseded by [Amendment 1](#amendment-1---basic-dice-replace-presentation-less-anonymous-dice-2026-07-28):**
  every die a client spawns MUST carry a presentation block; a die with no owned
  identity spawns as a *basic* die (`basic: true`).

### Server-Authoritative Physics for Every Mode

- Rapier3D MUST run natively in the Rust room server at 60Hz for both solo and
  multiplayer rooms; the client MUST NOT render a `<Physics>` provider for dice play.
- Dice MUST be rendered as positioned meshes only, driven by snapshot interpolation
  (lerp position, slerp rotation).
- Face detection MUST run server-side; the server emits `die_settled` with the
  authoritative face value.

### Snapshot Rate

- Active rooms MUST target **60Hz snapshots** (`SNAPSHOT_DIVISOR = 1` in
  `server/src/room.rs`). This supersedes the 20Hz baseline described in ADR 001;
  ADR 004's 60Hz-during-drag guidance now applies to active rooms generally.

### Arena Geometry (Portrait)

- The shared arena MUST remain **9:16 portrait** per accepted Shared-ADR-004:
  `WALL_HALF_X = 4.5` (9 units wide) and `WALL_HALF_Z = 8.0` (16 units deep) in
  `server/src/physics.rs`, matching `src/config/physicsConfig.ts`.
- Arena and physics constants remain manually synchronized between
  `src/config/physicsConfig.ts` and the Rust source per ADR 001 and ADR 003; any
  change MUST be applied to both codebases.

## Alternatives Considered

**Keep the dual physics architecture (ADR 001 as-is):** Rejected. The two-path model
was the root cause of the solo/multiplayer feature gap and duplicated physics,
drag, and settle logic. Unifying on the room protocol removes an entire class of
"works in solo but not multiplayer" bugs.

**Server-side physics only, no local server for solo:** Would require an always-on
public connection for solo play, losing the offline-equivalent experience. The local
loopback room preserves offline-capable solo play while keeping one code path.

**Keep local Rapier WASM for solo, adopt room protocol only for transport:** Retains
two physics engines and the cross-engine sync burden ADR 001 already flagged. The
loopback server reuses the native engine directly, so there is one physics
implementation.

## Consequences

### Positive

- One dice code path: spawning, physics, drag, and settle logic exist once and are
  exercised by both solo and multiplayer.
- Solo automatically inherits every room capability, including inventory dice
  identity, closing the historic feature gap.
- Server-authoritative physics everywhere means solo and multiplayer results are
  produced by the identical engine and constants.
- 60Hz snapshots give responsive visuals without client-side prediction.

### Negative / Considerations

- Solo play now depends on a local Rust room server being reachable; packaged/offline
  distribution needs a first-class local server lifecycle (tracked in #38).
- The loopback dependency adds a startup/health-check step and a failure surface that
  did not exist for pure-local physics; this is mitigated by the actionable error UI.
- Physics and arena constants still require manual client/server synchronization
  (unchanged from ADR 001/003).
- A browser smoke (`e2e/local-loopback-room.spec.ts`, run via
  `npm run test:e2e:local-room`) is required to guard the `/` -> solo-room-ready path.

## Amendments

### Amendment 1 - Basic dice replace presentation-less anonymous dice (2026-07-28)

* Status: Accepted
* Deciders: Donovan (PO decision (d), 2026-07-27), Development Team
* Amends: the "Room Protocol Is the Single Dice Path" clause requiring generic
  anonymous dice to spawn without any presentation block.

**Context.** Every player now has an unlimited supply of *basic* dice — a plain
white body with black numerals that never appears in the inventory and is the
universal auto-fill whenever a roll wants more dice of a type than the player
owns (`docs/exec-plans/active/2026-07-28-my-dice-rolls-rework.md`, decision (d)).
The original clause is incompatible with that: a die spawned with NO presentation
renders in its **owner's player colour** (`MultiplayerDie.tsx`,
`presentation?.baseColor ?? color`). That fallback is right for a die originated
by some other client we know nothing about, but wrong for a die *this* client
deliberately chose to spawn — the player asked for a plain die and would get a
purple one.

**Decision.** Every die a client spawns MUST carry a presentation block.

- A die with no owned identity MUST spawn as a **basic** die: `basic: true`, a
  white `baseColor`, a black `accentColor`, and no `inventoryDieId`, `setId` or
  `rarity`. The canonical block is `src/lib/basicDice.ts`.
- `basic` is opaque to the room, mirrored on `DicePresentationMetadata` in
  `server/core/src/messages.rs` under the ADR 002 manual-sync rule, and echoed
  back on `dice_spawned` / `roll_complete` so remote and reconnecting clients see
  a basic die as a basic die.
- The owner-colour fallback in `MultiplayerDie` is retained, but is now reachable
  only for dice originated by another (or an older) client.
- Basic dice MUST stay invisible to every ownership-derived surface — the
  toolbar's available count, set completion, selling and stats all key on
  `inventoryDieId`, which basics do not carry.

**Consequences.** Presentation-less spawns are no longer produced by any client
path, so "anonymous" now means "not owned", not "not described". A player with an
empty collection is still fully able to play, which is what let the seeded local
starter inventory be retired in the same slice.

## References

- Supersedes ADR 001 (Dual Physics Architecture).
- Amendment 1 (2026-07-28) supersedes this ADR's anonymous-dice presentation
  clause; see [Amendments](#amendments).
- Builds on ADR 002 (WebSocket JSON Protocol), ADR 003 (Centralized Physics
  Configuration), and ADR 004 (Multiplayer Drag Interaction Architecture).
- Epic #42 (room-first local loopback architecture follow-through); PR #52.
