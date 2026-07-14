# ADR 008 - Aspect-Fit Solo Arena and Per-Room Arena Bounds

* Date: 2026/07/13
* Status: Accepted
* Deciders: Donovan, Development Team
* Supersedes (in part): [ADR 004 - Multiplayer Drag Interaction Architecture](004-multiplayer-drag-interaction-architecture.md) (the *fixed* 9:16 arena clause, for **solo rooms only**), [ADR 005 - Room-First Local Loopback Architecture](005-room-first-local-loopback-architecture.md) (the "shared arena MUST remain 9:16 portrait" clause, for **solo rooms only**)
* Builds on: [ADR 007 - WASM Room Core](007-wasm-room-core-single-source.md) (per-room `EngineConfig`, single-source constants)

## Context

ADR 004 fixed the multiplayer arena at 9:16 portrait (half-extents 4.5 × 8.0)
because the multiplayer table is a **shared surface every player sees identically**,
and portrait maximizes usable area on the primary mobile target. ADR 005 carried
that "the shared arena MUST remain 9:16 portrait" into the room-first model.

ADR 007 then made solo an in-browser wasm room that runs in the player's own
browser tab — a **single-player, single-viewport** surface whose aspect ratio is
whatever the window happens to be (a landscape desktop, a portrait phone, a resized
panel). Rendering the fixed 9:16 portrait arena into an arbitrary viewport
letterboxes it: a landscape window shows a tall sliver of table with wasted space on
both sides.

Because ADR 007 already delivers arena bounds to the client **per room** via
`room_state.config` (never a hard-coded client literal), the arena footprint can
vary per room with no protocol or client change. The multiplayer contract (all
players see one shared 9:16 table) is untouched, because a solo room has exactly one
viewer.

## Decision

Solo rooms MUST fit their arena to the window's aspect ratio; multiplayer rooms MUST
keep the fixed 9:16 portrait arena. Both deliver their **actual** bounds to the
client per room.

* A room's horizontal arena footprint is an `ArenaBounds { half_x, half_z }`
  (`server/core/src/physics.rs`). The arena's **height** (`GROUND_Y`, `CEILING_Y`,
  `WALL_HEIGHT`) is fixed for every room; only the floor's X/Z half-extents vary.
* The in-browser solo room MUST construct its bounds via
  `ArenaBounds::from_aspect(aspect)`:
  * Playfield **area is held constant** at `WALL_HALF_X · WALL_HALF_Z = 36 U²`, so no
    window shape gains or loses room for dice to settle:
    `half_x = √(AREA · aspect)`, `half_z = √(AREA / aspect)`.
  * `aspect` MUST be clamped to `[0.4, 2.4]` before use, bounding the arena to sane
    shapes for degenerate viewports; half-extents then stay within ≈ `[3.8, 9.5]`.
  * The canonical portrait aspect `9 / 16 = 0.5625` is a **fixed point** of the fit —
    it reproduces `half_x = 4.5`, `half_z = 8.0` exactly, so solo at 9:16 is
    byte-identical to multiplayer.
* The native multiplayer server MUST use `ArenaBounds::default()` (the fixed 9:16
  portrait arena, 4.5 × 8.0). Its shared-surface contract is unchanged.
* Each room's actual bounds MUST reach the client on `room_state.config` via
  `EngineConfig::for_arena(bounds)` (ADR 007), which overrides only
  `arenaHalfX`/`arenaHalfZ` and leaves every engine-feel value shared. The client
  reads the ACTUAL walls its room simulates (camera fit, wall rendering, escape
  recovery) — never a copied literal.

### SI unit re-anchor (constant *values*, within ADR 007's regime)

Alongside the aspect-fit work, the engine constants were re-anchored to a real
physical die: 1 world unit `U` = one 16 mm d6 edge, `M` = the unit-cube mass at
`density(1.0)` (≈ 4.7 g acrylic), time = real seconds; gravity is real
(9.81 m/s² = 613.1 U/s²) and every velocity / impulse / threshold now carries a
documented real-quantity derivation (see the module doc block and per-constant
rustdoc in `server/core/src/physics.rs`).

This is a **values recalibration inside ADR 007's single-source regime, not an
architecture change** — every constant still lives once in `dicesuki-core` and
reaches both build targets and the client (via `EngineConfig`) by the same
mechanism. It is recorded here for provenance because it is what gives
`WALL_HALF_X · WALL_HALF_Z` a physically meaningful value (36 U² = a 14.4 × 25.6 cm
felt tray) and motivates the "preserve playfield area" rule above. No new drift
surface is introduced: the ADR 007 guards (`config.rs` projection assert, the client
`physicsConfig.guard.test.ts`) still hold.

## Scope of supersession (partial, solo rooms only)

* **ADR 004 — Portrait-First Arena (9:16).** The clause that the arena is a **fixed**
  9:16 (half-extents 4.5 × 8.0) **stands for the multiplayer arena** — its original
  subject, a shared surface all players see identically. It is **superseded for solo
  rooms**, which aspect-fit via `ArenaBounds::from_aspect`. The 9:16 arena remains the
  fixed point of that fit.
* **ADR 005 — "the shared arena MUST remain 9:16 portrait".** *Shared* is the
  operative scope: multiplayer's shared arena stays 9:16. A solo room is not a shared
  arena (one viewer), so its arena is aspect-fit. ADR 005's room-first principle and
  its per-room-bounds delivery are otherwise **strengthened**, not weakened.

## Alternatives Considered

* **Keep the fixed 9:16 arena in solo and letterbox it.** Rejected: wastes most of a
  landscape viewport and reads as a rendering bug; the point of an in-browser solo
  room (ADR 007) is to use the player's own surface.
* **Fit the arena but let area scale with the window (no area clamp).** Rejected: a
  wide window would gain a huge floor and a tall one a cramped one, changing settle
  behavior and difficulty by device. Holding area constant keeps the physics feel
  identical across shapes.
* **Let solo pick any aspect with no clamp.** Rejected: a degenerate (zero-height)
  viewport yields an infinite/NaN aspect and an unusable sliver arena; the
  `[0.4, 2.4]` clamp bounds it to sane shapes.
* **A distinct solo-only arena constant set.** Rejected: reintroduces the dual-source
  drift ADR 007 eliminated. `from_aspect` derives everything from the same shared
  constants; only the footprint varies, delivered per room.

## Consequences

### Positive

* Solo uses the full browser viewport with no letterboxing, while multiplayer keeps
  its shared 9:16 contract — from one code path (rooms differ only in the `bounds`
  they are built with).
* Constant playfield area keeps dice feel identical across window shapes; 9:16 is a
  fixed point, so solo-at-portrait and multiplayer are provably identical.
* No protocol or client change: per-room bounds ride the existing `room_state.config`
  (ADR 007). The client always renders the actual arena.

### Negative / Considerations

* Dice settling on a very wide (≈ 2.4) or narrow (≈ 0.4) solo table have a
  differently-*shaped* floor than the 9:16 reference; area is preserved but extreme
  aspects still change the shape of the play space (bounded by the clamp).
* The 9:16-as-fixed-point invariant is load-bearing (solo/multiplayer parity at
  portrait) and MUST be preserved by any change to `from_aspect`; the unit test
  `from_aspect_9_16_is_exactly_the_default_arena` guards it.

## References

* `server/core/src/physics.rs` (`ArenaBounds`, `from_aspect`, the SI module doc block
  + per-constant rustdoc), `server/core/src/config.rs` (`EngineConfig::for_arena`),
  `server/core/src/room.rs` (`Room::new(id, bounds)`), `src/config/engineConfig.ts`.
* Builds on [ADR 007 - WASM Room Core](007-wasm-room-core-single-source.md); amends
  [ADR 004](004-multiplayer-drag-interaction-architecture.md) and
  [ADR 005](005-room-first-local-loopback-architecture.md) for solo rooms.
* NOTE: `.claude/rules/architecture.md` is generated from accepted ADRs and MUST be
  regenerated (`/adr:update`) to reflect this ADR's partial supersessions — it is not
  hand-edited here.
