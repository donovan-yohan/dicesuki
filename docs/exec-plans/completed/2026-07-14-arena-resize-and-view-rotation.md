# Exec Plan — Host-Resizable Shared Arena & Per-Client View Rotation

* Date: 2026/07/14
* Status: Completed — resize shipped in PR #130; view rotation in the follow-up PR
* ADR: [Shared ADR 009](../../adrs/shared/009-host-resizable-arena-and-view-rotation.md) (Proposed)
* Scope: two related features — (1) host resizes the shared, server-authoritative arena
  via presets (16:9 / 9:16 / 1:1 / host-window), solo included with an "auto" option;
  (2) any client rotates its own view 90° (client-only, server unchanged).

## Guiding facts (from code audit)

* Per-room bounds already ride `EngineConfig` on `room_state.config` (ADR 007/008);
  walls/floor/shadows on the client already reflow when `engineConfig` changes.
* Gaps to build: (a) `PhysicsWorld` can't rebuild its arena in place; (b) config is
  broadcast to no one on a mid-session change; (c) the client camera is scale-locked and
  never frames the arena; (d) motion impulse is the one input vector not derived from the
  camera raycast.
* Presets map to `ArenaBounds::from_aspect(aspect)` (area-preserving). 16:9 = transpose
  of 9:16; both keep 36 U². Aspect clamp `[0.4, 2.4]`, half-extent clamp `[3.0, 24.0]`.

---

## Phase 1 — Core: runtime arena resize (Rust, `server/core`)

**1.1 `PhysicsWorld` arena rebuild**
* `physics.rs`: store the 6 arena body handles on `PhysicsWorld` (new field, e.g.
  `arena_handles: [RigidBodyHandle; 6]`), set in `with_bounds` (currently locals at
  `physics.rs:589-667`).
* Add `PhysicsWorld::rebuild_arena(&mut self, bounds: ArenaBounds)`: `remove_body`
  (`physics.rs:864`) the 6 arena handles, re-insert via the same builder logic as
  `with_bounds`, store new handles. Dice bodies (inserted later) keep their handles.
* Refactor `with_bounds` to share the arena-building body with `rebuild_arena` (one
  private `insert_arena(bounds) -> [handle;6]`).

**1.2 `Room::set_arena` (host-gated)**
* `room.rs`: `pub fn set_arena(&mut self, player_id: &str, aspect: f32) -> Result<EngineConfig, RoomError>`.
  * Host gate mirrors `update_settings` (`room.rs:816-819`) → `RoomError::NotHost`.
  * `let bounds = ArenaBounds::from_aspect(aspect)`; `self.physics.rebuild_arena(bounds)`;
    `self.bounds = bounds`.
  * **Clamp dice preserving orientation**: for each die whose position is outside the new
    `bounds` (use a resize clamp, NOT `reset_escaped_dice` which only fires past +8 U and
    resets rotation), move it inside with `clamp_spawn_position(pos, &bounds)` (`dice.rs:235`)
    via a new `PhysicsWorld` helper `move_body_keep_rotation(handle, pos)` (set translation,
    keep rotation, zero velocity). Dice inside are untouched → faces preserved.
    Update `ServerDie.position`/`last_snapshot_position`; leave `rotation`, `face_value`,
    `is_rolling` as-is for untouched dice; moved dice keep `face_value`.
  * `self.touch()`; return `EngineConfig::for_arena(&self.bounds)` (`config.rs:139`).
* Optionally record the chosen aspect in `RoomSettings` (`arenaAspect` key, `room.rs:112`
  pattern) for discovery/UI; NOT the source of truth (bounds are). Decide during build —
  the client can derive the active preset from `arenaHalfX/Z` without it.

**1.3 Protocol messages**
* `messages.rs`: `ClientMessage::SetArena { aspect: f32 }` → wire `"set_arena"`
  (snake_case, `messages.rs:32-33`).
* `messages.rs`: `ServerMessage::ArenaChanged { config: EngineConfig }` → broadcast carrier
  (config is otherwise join-only). Alternatively add `config` to `SettingsUpdated`; prefer a
  dedicated `arena_changed` to keep settings semantics clean.
* Native handler `ws_handler.rs` (mirror `UpdateSettings` at `ws_handler.rs:319-340`):
  on `SetArena`, `room.set_arena(pid, aspect)`; on Ok `room.broadcast(ArenaChanged { config })`;
  on `NotHost` → error to sender. Same dispatch in `server/wasm/src/host.rs` (solo).

**1.4 Core tests** (`server/core`, `cargo test`)
* Resize keeps dice bodies valid (handles still resolve; count unchanged).
* Dice inside new bounds do NOT move and keep `face_value`; a die placed outside the new
  (smaller) bounds is moved inside with rotation preserved.
* `from_aspect` presets: 16:9 ↔ 9:16 are transposes; 1:1 is square; area ≈ 36 U².
* Host gate: non-host `set_arena` → `NotHost`.
* Rebuilt arena still contains a dropped die (walls exist at new extents).

---

## Phase 2 — Client: arena-fit camera + reflow + size UI

**2.1 Arena-fit camera (foundation for resize AND rotate)**
* `Scene.tsx` `MultiplayerCamera` (`:332-353`): replace scale-locked height (ppu × CSS
  height) with an **arena-fit** framing that contains `arenaHalfX/arenaHalfZ` (from
  `useEngineConfig`) given the viewport aspect (letterbox the smaller axis). Make it
  reactive to `engineConfig` (add to deps).
* Keep 9:16-on-portrait visually identical (fixed point) — add a regression test/guard on
  the fit math (a 9:16 arena in a 9:16 viewport yields the current framing).
* Solo + multiplayer share this camera (both read engineConfig).

**2.2 React to `arena_changed`**
* `useMultiplayerStore.ts` `handleServerMessage`: handle `ArenaChanged` → `set({ engineConfig: msg.config })`
  (same write as `room_state` at `:470`). Walls/floor/shadows already reflow; camera (2.1)
  now reflows too.
* Add `arena_changed` to the client `ServerMessage` union (`multiplayerMessages.ts`).

**2.3 Size preset UI**
* `useMultiplayerStore.ts`: `setArena(aspect: number)` action (host-gated optimistic like
  `setVisibility`) → `sendMessage({ type: 'set_arena', aspect })`.
* Multiplayer: add a "Room Size" control to `PlayerPanel` live-room section (host-only,
  next to Discovery/Motion/Theme) — preset buttons 16:9 / 9:16 / 1:1 / "Fit my window"
  (host viewport `w/h`). Active preset derived from current `arenaHalfX/Z` ratio.
* Solo: add the same presets to `SoloRoomControls` (you are the host) **plus "Auto"**
  (fit window; optionally re-fit on `resize`). Auto sends `set_arena(window.innerWidth/innerHeight)`.
* Presets → aspect: `{ '16:9': 16/9, '9:16': 9/16, '1:1': 1, window: w/h }`.

**2.4 Client tests** (`vitest`)
* `setArena` sends `set_arena` with the right aspect; host-gated.
* `arena_changed` updates `engineConfig`.
* Arena-fit camera math: 9:16 fixed point; wide/tall arenas letterbox correctly.
* Preset→aspect mapping + active-preset detection from bounds ratio.

---

## Phase 3 — Client: per-client 90° view rotation

**3.1 View-rotation state**
* New per-device, locally-persisted (NOT Supabase-synced) `viewRotation: 0|90|180|270`.
  Home: `useUIStore` (device-ergonomic prefs) with localStorage persistence, or a small
  dedicated persisted slice. Actions: `rotateViewCW()` / `rotateViewCCW()` (± 90 mod 360).

**3.2 Camera rotation + refit**
* `MultiplayerCamera` (2.1): apply `viewRotation` as a spin about the view axis (rotate the
  camera `up` vector by the angle) and, for 90°/270°, swap the arena half-extents used in
  the fit so the rotated arena fills the viewport. Verify pointer raycasts stay correct
  (they use the real camera, so drag/throw need no change — add an assertion/manual check).

**3.3 Rotate the one non-camera input vector**
* Motion impulse: rotate the world X/Z of the shake impulse by `viewRotation` before send.
  Site: `motionImpulse.ts` `computeShakeImpulse` (`:49-61`) consumers, or at the send edge
  in `MultiplayerMotionController.tsx` (`:30-39`). Add a `rotateXZ(vec, degrees)` helper
  (shared, unit-tested). Y untouched.
* Confirm drag (`useMultiplayerDrag.ts:46-55`), grabOffset (`:82-90`), velocityHistory
  (`:94,117`) need NO change (camera-derived) — document why.

**3.4 Rotate control UI**
* On-screen rotate button (corner of the scene, always available, not host-gated) — one
  or two buttons (CW / CCW), 90° steps. Persist choice per device.

**3.5 Tests**
* `rotateXZ` correctness at 0/90/180/270 (vector maps as expected).
* Motion impulse is rotated by `viewRotation`; drag/throw payloads are NOT double-rotated.
* `viewRotation` store: cycles, persists, defaults to 0.

---

## Phase 4 — Verify, docs, ADR

* End-to-end: run native server + two clients (or Playwright) — host resizes 9:16→16:9,
  confirm both clients reflow, dice stay put with faces intact, out-of-bounds dice nudge
  in. One client rotates 90°, confirm its view rotates, drag/throw/shake still land right,
  the other client unaffected.
* Mark ADR 009 Accepted; regenerate `.claude/rules/architecture.md` (`/adr:update`).
* Update `docs/guides/*` (arena/room controls) as needed; move this plan to `completed/`.

---

## Sequencing & risk

* **Order:** Phase 1 (core) → Phase 2 (camera + resize, the higher-risk client change) →
  Phase 3 (rotate, builds on the arena-fit camera) → Phase 4. Phase 2.1 (arena-fit camera)
  is the linchpin and the main regression risk (it changes how everyone sees the table);
  land it behind the 9:16-fixed-point guard.
* **Rollback-safe:** resize/rotate are additive. If the arena-fit camera proves risky, it
  can ship gated while presets stay host-only default-9:16.
* **Protocol sync (ADR 002/007):** `SetArena` / `ArenaChanged` must be added to TS and Rust
  in lockstep; extend the spawn-schema-style drift guard to cover them.
