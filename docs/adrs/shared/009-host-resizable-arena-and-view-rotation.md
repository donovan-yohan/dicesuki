# ADR 009 - Host-Resizable Shared Arena and Per-Client View Rotation

* Date: 2026/07/14
* Status: Accepted
* Deciders: Donovan, Development Team
* Amends: [ADR 004 - Multiplayer Drag Interaction Architecture](004-multiplayer-drag-interaction-architecture.md) (lifts the *fixed* 9:16 multiplayer arena clause — the shared arena becomes host-resizable, default 9:16), [ADR 005 - Room-First Local Loopback Architecture](005-room-first-local-loopback-architecture.md) ("the shared arena MUST remain 9:16 portrait" — now the shared arena size is host-chosen, still one shared surface)
* Builds on: [ADR 007 - WASM Room Core](007-wasm-room-core-single-source.md) (per-room `EngineConfig`), [ADR 008 - Aspect-Fit Solo Arena and Per-Room Arena Bounds](008-aspect-fit-solo-arena.md) (`ArenaBounds::from_aspect`, per-room bounds delivery)

## Context

ADR 004/005 fixed the multiplayer arena at 9:16 portrait because it is a **shared
surface every player sees identically**, and portrait suits the primary mobile
target. ADR 008 then let a **solo** room aspect-fit its single viewport, while the
multiplayer arena stayed fixed 9:16 — leaving per-room bounds delivery (`from_aspect`,
`EngineConfig::for_arena`, `room_state.config`) already in place but exercised only by
solo.

Two ergonomics gaps remain:

1. **The shared arena shape is not a choice.** A table of desktop players is stuck
   with a tall 9:16 sliver; a table that wants a square or landscape surface cannot
   have one. The host should be able to size the shared arena (16:9 / 9:16 / 1:1 / the
   host's own window shape) for everyone.
2. **One shared shape can't suit every screen at once.** Whatever shape the host
   picks, a portrait phone and a landscape laptop looking at the *same* arena want it
   oriented differently. A player should be able to rotate **their own view** 90°
   without changing the shared table or anyone else's view.

These are two sides of one theme — *the arena's shape and how each player views it* —
so they are decided together. The load-bearing distinction: **size is shared and
server-authoritative; orientation is per-client and view-only.**

Feasibility (from a code audit) confirms the pieces:
* `ArenaBounds::from_aspect(aspect)` already derives area-preserving bounds and is the
  natural target for presets (16:9 and 9:16 are transposes; 1:1 is square; all keep the
  36 U² playfield). `Room::new(id, bounds)` builds an arena from any bounds.
* But `PhysicsWorld` builds its 6 arena colliders once in `with_bounds` and retains no
  handles, so **runtime resize needs a rebuild path**; `room_state.config` is sent
  **only on join, only to the joining player**, so **a resize needs a new broadcast**;
  and the client **camera is scale-locked to pixels-per-unit and never frames the
  arena**, so an arbitrary host-chosen shape needs an **arena-fitting camera**.
* For view rotation, rotating the *actual* R3F camera makes pointer-derived vectors
  (drag target, throw samples) project correctly for free; only the **sensor-derived
  motion impulse** must be rotated by the view offset. Face numbers are painted into
  the die textures, so they rotate with the view naturally.

## Decision

### A. The shared arena size is host-controlled and server-authoritative

* A room's arena size MUST be a single shared value that every player in the room sees
  identically. It MUST be owned by the room's Rust core (`dicesuki-core`) and delivered
  to clients via `EngineConfig` (ADR 007) — never a client literal.
* The room host MAY change the arena size at runtime via a new host-only client message
  `set_arena`. The server MUST reject non-host senders (as with `update_settings`).
* `set_arena` MUST carry a target aspect ratio; the server MUST derive bounds via
  `ArenaBounds::from_aspect(aspect)` (area-preserving, clamped to `[0.4, 2.4]` aspect /
  `[3.0, 24.0]` half-extent). Presets are aspect values: **16:9 → 1.778**, **9:16 →
  0.5625**, **1:1 → 1.0**, **"host window" → the host's viewport width/height at click**.
* The default arena for a newly created multiplayer room MUST remain the fixed 9:16
  portrait (`ArenaBounds::default()`); resizing is an explicit host action.
* Applying a resize MUST:
  1. Rebuild the arena colliders in place to the new bounds **without invalidating any
     existing die body** (dice persist across a resize).
  2. Move any die now outside the new bounds back inside, **preserving its orientation**
     (a resize MUST NOT re-roll settled faces); dice already inside MUST NOT move.
  3. Update the room's authoritative `bounds` and **broadcast the new `EngineConfig` to
     all players** so every client reflows walls, shadows, and camera. Because
     `room_state.config` is currently join-only and per-recipient, a resize MUST use a
     broadcast carrier (a new `arena_changed { config }` server message, or `config`
     added to a broadcast message) — it MUST NOT rely on the join-only path.
* A late joiner MUST receive the room's current bounds (the existing per-recipient
  `room_state.config` already reflects `self.bounds`, so this holds once resize mutates
  `bounds`).

### B. Solo rooms may use the same size presets

* A solo room MAY expose the same size presets plus an **"auto" (fit window)** option.
  Solo is a one-viewer room (ADR 008), so a host-style size control is consistent — the
  solo player is the host. "Auto" fits the current viewport aspect and MAY re-fit on
  window resize (today solo bounds are frozen at creation; re-fit is an allowed
  enhancement, not required).
* Solo and multiplayer MUST use the **same** `set_arena` core path (ADR 005/007: one
  engine, one code path); they differ only in who may call it (solo player is host) and
  the "auto" affordance.

### C. Per-client 90° view rotation is view-only

* Any client MAY rotate its own view of the shared world in 90° steps (0/90/180/270).
  This is a **local rendering preference** and MUST NOT change the shared simulation,
  the arena, or any other client's view. It is per-device and MUST NOT sync across a
  user's devices (a phone's rotation must not rotate their desktop).
* View rotation MUST be implemented by rotating the client camera (and re-fitting the
  arena to the viewport with the arena's axes swapped for 90°/270°), NOT by transforming
  the shared world or the dice.
* **Invariant:** every world-space vector a client sends to the server MUST be expressed
  in the shared world frame regardless of local view rotation. Concretely:
  * Pointer-derived vectors (drag target `worldPosition`, `grabOffset`, throw
    `velocityHistory`) are produced by ray-casting through the actual camera, so
    rotating the real camera keeps them correct with no extra transform.
  * The **sensor-derived motion impulse** (device-motion shake) is NOT camera-derived
    and MUST be rotated by the client's view offset before sending, so a "tilt" pushes
    dice in the direction the player sees.

### D. The multiplayer camera must frame the arena

* The client camera MUST frame the room's actual arena bounds (arena-fit, letterboxing
  when the arena aspect differs from the viewport), so any host-chosen shape displays
  correctly on any viewport and view rotation. The 9:16 arena on a portrait phone MUST
  remain the visual fixed point (unchanged from today).

## Alternatives Considered

* **Keep the arena fixed 9:16 for multiplayer.** Rejected: it is the ergonomics
  complaint being addressed; desktop tables want other shapes.
* **Reconstruct the whole `PhysicsWorld` on resize.** Rejected: it invalidates every
  die body handle, forcing a re-spawn that re-rolls faces and drops drag state. Rebuild
  the 6 arena bodies in place instead (track their handles) so dice survive.
* **Re-roll / re-drop all dice on resize.** Rejected: a size change is a table
  adjustment, not a roll; settled faces MUST be preserved. Only out-of-bounds dice move,
  keeping their orientation.
* **Non-area-preserving sizing (`from_dimensions`).** Rejected for presets: preserving
  the 36 U² playfield keeps dice feel identical across shapes (ADR 008 rationale); the
  "host window" preset still maps to an aspect, not raw dimensions.
* **Ship arena size as a `RoomSettings` field only.** Rejected as the mechanism: settings
  changes don't touch physics. Size is authoritative in core bounds and rides
  `EngineConfig`; a settings key MAY additionally record the aspect for discovery, but
  the bounds are the source of truth.
* **Rotate the shared world / dice for a rotated view.** Rejected: it would desync the
  shared frame and require rotating every inbound snapshot. Rotating only the local
  camera keeps the world shared and one-directional.
* **CSS-rotate the canvas for view rotation.** Rejected: pointer events would arrive in
  unrotated canvas space, breaking drag ray-casts. Rotate the camera so ray-casts stay
  correct.
* **Sync view rotation across devices (persist in the synced settings store).**
  Rejected: rotation is a per-screen ergonomic; syncing it would rotate a desktop
  because a phone was rotated.

## Consequences

### Positive

* Hosts shape the shared table (landscape / portrait / square / their window); every
  player still sees one identical server-authoritative arena.
* Each player independently orients their own view to their device without touching the
  shared table — a phone and a laptop can comfortably share one 16:9 room.
* Reuses ADR 007/008 machinery: per-room `EngineConfig`, `from_aspect`, one core path
  for solo and multiplayer. The rotate path adds no protocol and rotates exactly one
  extra vector (motion impulse).
* Closes a latent gap (config was join-only): a room can now push new bounds to all
  players mid-session, useful beyond resize.

### Negative / Considerations

* Runtime arena rebuild is new physics surface: the 6 arena bodies must be tracked and
  swapped without disturbing dice; must be covered by core tests (dice survive, faces
  preserved, out-of-bounds dice clamped).
* The arena-fit camera replaces the current scale-locked camera for multiplayer; it MUST
  keep 9:16-on-portrait visually identical (a regression guard is warranted).
* Extreme aspects (near the 0.4 / 2.4 clamp) give a very wide or narrow shared table;
  the clamp bounds this, and area is preserved.
* View rotation makes the die face numbers appear rotated on screen (they are painted on
  the die and follow its orientation) — this is correct for a rotated viewpoint and
  matches physically turning the device; no re-uprighting is done.

## References

* Core: `server/core/src/physics.rs` (`PhysicsWorld::with_bounds`, `ArenaBounds`,
  `from_aspect`, `ARENA_MIN/MAX_HALF_EXTENT`), `server/core/src/room.rs`
  (`Room::update_settings` host-gate pattern, `bounds`, `reset_escaped_dice`,
  `build_room_state`), `server/core/src/config.rs` (`EngineConfig::for_arena`),
  `server/core/src/messages.rs` (`ClientMessage`, `ServerMessage::SettingsUpdated`),
  `server/wasm/src/lib.rs` (`WasmRoom::new` arena init).
* Client: `src/components/Scene.tsx` (`MultiplayerCamera`, lighting shadow frustum),
  `src/components/multiplayer/MultiplayerArena.tsx` (walls/floor sized from
  `useEngineConfig`), `src/config/engineConfig.ts`, `src/hooks/useMultiplayerDrag.ts`
  (`getPointerWorldPosition`, `grabOffset`, `velocityHistory`),
  `src/lib/motionImpulse.ts` + `src/components/multiplayer/MultiplayerMotionController.tsx`
  (motion impulse), `src/config/renderScale.ts` (`arenaDimensionsForViewport`).
* Builds on [ADR 007](007-wasm-room-core-single-source.md) and
  [ADR 008](008-aspect-fit-solo-arena.md); amends
  [ADR 004](004-multiplayer-drag-interaction-architecture.md) and
  [ADR 005](005-room-first-local-loopback-architecture.md) (the fixed-9:16 clause).
* NOTE: `.claude/rules/architecture.md` is generated from accepted ADRs and MUST be
  regenerated (`/adr:update`) once this ADR is Accepted.
