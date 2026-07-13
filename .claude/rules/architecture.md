# Architecture Rules (derived from ADRs)

> DO NOT edit by hand. Regenerate with `/adr:update`.
> Generated: 2026-07-13 | Source: 11 Accepted ADRs (4 Frontend, 1 Server, 6 Shared)

---

## 3D Rendering (React Three Fiber)

- [Frontend-ADR-001] The frontend MUST use `@react-three/fiber` v9 for all 3D rendering.
- [Frontend-ADR-001] Three.js geometries MUST be memoized with `useMemo` to prevent per-frame allocations.
- [Frontend-ADR-001] Event callbacks MUST be wrapped in `useCallback` to avoid unnecessary re-renders.
- [Frontend-ADR-001] Components SHOULD be wrapped in `React.memo` when receiving stable props.
- [Frontend-ADR-001] Client-side Rapier WASM physics (`@react-three/rapier`, the `<Physics>` provider, and client-side face detection) is superseded by Shared-ADR-005 and Shared-ADR-007 and MUST NOT be reintroduced; all dice physics and face detection run in `dicesuki-core`.

## State Management (Zustand)

- [Frontend-ADR-002] All global state MUST be managed through Zustand stores.
- [Frontend-ADR-002] Each logical domain MUST have its own dedicated store.
- [Frontend-ADR-002] State updates involving `Map` or `Set` MUST create new instances, never mutate in place.
- [Frontend-ADR-002] Persisted stores MUST include a `version` number and a `migrate` function.
- [Frontend-ADR-002] Stores using `persist` SHOULD use `partialize` to exclude non-serializable or ephemeral state.
- [Frontend-ADR-002] Maps and Sets MUST NOT be persisted directly; convert to serializable formats if needed.
- [Frontend-ADR-002] Stores MAY be accessed outside React via `useStore.getState()` for non-React code paths.
- [Frontend-ADR-002] New features SHOULD NOT add state to an existing store unless tightly coupled to that store's domain.
- [Frontend-ADR-002] React Context MUST NOT be used for high-frequency state that changes on every frame.
- [Frontend-ADR-002] React Context SHOULD be reserved for provider-pattern concerns (ThemeProvider, DeviceMotionProvider).

## Theme System

- [Frontend-ADR-003] The theme system MUST use design tokens defined in `src/themes/tokens.ts`.
- [Frontend-ADR-003] Each theme MUST implement the complete `Theme` interface (no partial themes).
- [Frontend-ADR-003] The `defaultTheme` MUST always be available and have `price: 0`.
- [Frontend-ADR-003] `ThemeProvider` (React Context) MUST provide the active theme to the component tree.
- [Frontend-ADR-003] UI components SHOULD read theme tokens via the `useTheme()` hook.
- [Frontend-ADR-003] 3D scene components MUST read dice and environment tokens from the active theme.
- [Frontend-ADR-003] Theme switching MUST NOT require a page reload.
- [Frontend-ADR-003] Nullable asset fields (`string | null`) SHOULD be used for progressive enhancement; components MUST fall back gracefully when an asset is `null`.
- [Frontend-ADR-003] User overrides MUST be deep-merged with the base theme at the provider level.

## Testing Strategy

- [Frontend-ADR-004] The project MUST use a two-tier testing strategy: Vitest (unit/component) and Playwright (visual/E2E).
- [Frontend-ADR-004] Test files MUST be colocated with source: `ComponentName.test.tsx`, `useHookName.test.ts`.
- [Frontend-ADR-004] Test setup (`src/test/setup.ts`) MUST provide ResizeObserver, WebGL context mocks, and jest-dom matchers.
- [Frontend-ADR-004] Tests MUST use the Arrange/Act/Assert pattern.
- [Frontend-ADR-004] Async state updates MUST use `waitFor()` from Testing Library.
- [Frontend-ADR-004] Time-dependent tests MUST use `vi.useFakeTimers({ toFake: ['performance'] })`.
- [Frontend-ADR-004] Browser APIs (vibrate, DeviceMotion, IndexedDB) MUST be mocked at the module level.
- [Frontend-ADR-004] R3F components SHOULD be tested via extracted hook logic rather than rendering full 3D scenes in jsdom.
- [Frontend-ADR-004] Known test failures MUST be documented in CLAUDE.md and not suppressed.
- [Frontend-ADR-004] Unit test coverage target MUST be >80% for hooks, utilities, and store logic.

## Server Architecture (Rust / Axum)

- [Server-ADR-001] The multiplayer server MUST be implemented in Rust using Axum with Tokio async runtime.
- [Server-ADR-001] Server code MUST reside in `server/` (native binary in `server/src/`, shared simulation crate in `server/core/`).
- [Server-ADR-001] `RoomManager` MUST be wrapped in `Arc<RwLock<RoomManager>>` shared via Axum `State` extractor.
- [Server-ADR-001] Each `Room` MUST be wrapped in `Arc<RwLock<Room>>` for concurrent player access.
- [Server-ADR-001] WebSocket connections MUST be handled by Tokio tasks spawned per connection.
- [Server-ADR-001] Physics simulation loops MUST run as Tokio tasks per room at 60Hz.
- [Server-ADR-001] Stale room cleanup MUST run as a background Tokio task (every 5 minutes).
- [Server-ADR-001] All requests MUST be logged via Axum middleware with HTTP version, method, URI, and status code.
- [Server-ADR-001] WebSocket requests MUST log diagnostic headers (Upgrade, Connection, Sec-WebSocket-Version, Sec-WebSocket-Key).
- [Server-ADR-001] All log lines MUST include the `INSTANCE_ID` (8-char nanoid).
- [Server-ADR-001] Release builds MUST use `opt-level = 3` and `lto = true`.
- [Server-ADR-001] Reverse proxies MUST be configured to support WebSocket upgrades and not force HTTP/2 for WebSocket routes.

## WebSocket JSON Protocol

- [Shared-ADR-002] Client-server communication MUST use WebSocket transport with JSON serialization.
- [Shared-ADR-002] All messages MUST use a `type` field as the discriminator for tagged union deserialization.
- [Shared-ADR-002] JSON field names MUST use camelCase.
- [Shared-ADR-002] Rust struct fields MUST use `#[serde(rename = "camelCase")]` annotations.
- [Shared-ADR-002] The `physics_snapshot` message MUST use compact field names (`p`, `r`) for bandwidth efficiency.
- [Shared-ADR-002] Message types MUST be defined in `src/lib/multiplayerMessages.ts` (client) and `server/core/src/messages.rs` (core), kept manually in sync.
- [Shared-ADR-002] The `error` message MUST include a machine-readable `code` field.
- [Shared-ADR-002] WebSocket upgrades require HTTP/1.1; reverse proxies MUST support this.
- [Shared-ADR-002] Drag interaction MUST use three message types: `drag_start`, `drag_move`, `drag_end`.
- [Shared-ADR-002] The `drag_end` message MUST include a `velocityHistory` array for throw calculation.

## WASM Room Core (One Engine, One Constant Set)

- [Shared-ADR-007] The room simulation (physics, dice, room loop, message types, face detection) MUST live in one shared Rust crate, `dicesuki-core` (`server/core/`), compiled to two targets from one source: the native multiplayer server binary and a `wasm-bindgen` module.
- [Shared-ADR-007] The default page load MUST run the wasm build of `dicesuki-core` inside a Web Worker as an in-browser room server, speaking the existing JSON room protocol over `postMessage`; `@react-three/rapier` MUST NOT be used.
- [Shared-ADR-007] The wasm room MUST be `dicesuki-core` compiled to wasm — never a re-implementation and never a different engine (e.g. `rapier.js` with ported constants).
- [Shared-ADR-007] The Web Worker host MUST be a thin shim (instantiate wasm, forward protocol JSON, drive the tick timer) with NO game logic in JS/TS.
- [Shared-ADR-007] No wasm-specific behavior forks MUST live inside core; platform glue is limited to clock and RNG feature flags. A wasm limitation MUST be fixed in core so both targets get the fix.
- [Shared-ADR-007] Every physics-engine constant (gravity, restitution/friction, edge chamfer, roll impulse & torque, settle/knock thresholds, drag & throw response, velocity clamp, motion clamp/rate-limit, arena bounds) MUST be defined exactly once in `dicesuki-core` (`server/core/src/physics.rs`), each with a rustdoc description, recommended range, and current-value rationale.
- [Shared-ADR-007] There MUST be exactly one roll torque/impulse definition (`ROLL_TORQUE_MAGNITUDE`) in core; solo and multiplayer MUST roll identically (the historical `±1` vs `±5` divergence is gone).
- [Shared-ADR-007] `src/config/physicsConfig.ts` MUST carry NO engine constants — only client-side concerns (geometry detail, device-motion sensor scaling, haptic thresholds, input/message throttles, the client shake-impulse mapping, and the client-side motion send throttle/clamp that mirror the room policy).
- [Shared-ADR-007] When the browser needs an engine value at runtime, it MUST obtain it from core, never from a copied literal: `EngineConfig::current()` projects the engine constants to a camelCase JSON object, carried on every `room_state` message (`ServerMessage::RoomState.config`), stored in `useMultiplayerStore.engineConfig`, and read via `src/config/engineConfig.ts`; before any room exists the wasm module exposes it via the `engineConfigJson()` `wasm-bindgen` getter.
- [Shared-ADR-007] Drift guards MUST fail closed: `server/core/src/config.rs` MUST assert `EngineConfig::current()` reflects the `physics` constants, and `src/config/physicsConfig.guard.test.ts` MUST assert `physicsConfig.ts` exports no engine constant and that arena bounds arrive via `room_state.config`.
- [Shared-ADR-007] The transitional shim `src/config/legacyClientPhysics.ts` MUST NOT be imported by any room/engine-path code (it is quarantined out of `physicsConfig.ts` and deleted with the deprecated client `<Physics>` path).

## Room-First Architecture (Single Dice Path)

- [Shared-ADR-005] The room MUST be the single primitive for all dice play; solo and multiplayer MUST differ only in player count and where the room runs, not in code path.
- [Shared-ADR-005] Solo mode MUST run as an implicit one-player in-browser wasm room (Shared-ADR-007); there MUST be no local native room server, health-gate, or loopback configuration for solo play.
- [Shared-ADR-005] Both solo and multiplayer dice MUST flow through the room WebSocket protocol (`join`, `room_state`, `spawn_dice`, `dice_spawned`, `physics_snapshot`, `die_settled`, drag messages).
- [Shared-ADR-005] `room_state` MUST carry an explicit `localPlayerId` so the client knows which player it controls.
- [Shared-ADR-005] Owned/inventory dice identity MUST be carried end-to-end via `presentation` metadata on spawn (`inventoryDieId`, `displayName`, `setId`, `rarity`, `baseColor`, `customAssetId`, `customAssetName`, `unsupportedReason`); the server treats physics as authoritative and `presentation` as client-provided display metadata.
- [Shared-ADR-005] Generic anonymous dice (e.g. `d20`, `2d6`) MUST spawn without any presentation block.
- [Shared-ADR-005] Rapier3D MUST run inside the room's Rust core (native server or in-browser wasm room) at 60Hz for both solo and multiplayer; the client MUST NOT render a `<Physics>` provider for dice play.
- [Shared-ADR-005] Dice MUST be rendered as positioned meshes only, driven by snapshot interpolation (lerp position, slerp rotation).
- [Shared-ADR-005] Face detection MUST run server-side (in core); the room emits `die_settled` with the authoritative face value.
- [Shared-ADR-005] Active rooms MUST target 60Hz snapshots (`SNAPSHOT_DIVISOR = 1` in `server/core/src/room.rs`), superseding the 20Hz baseline.
- [Shared-ADR-005] The shared arena MUST remain 9:16 portrait; its bounds are engine constants owned by `dicesuki-core` and delivered to the client via `room_state.config` (Shared-ADR-007), not manually synced.

## Centralized Physics Configuration

- [Shared-ADR-003] Physics constants MUST be centralized in clearly labeled, documented locations rather than scattered across component files, hooks, or inline values.
- [Shared-ADR-003] Every constant MUST include a documentation comment (JSDoc for client constants, rustdoc for core engine constants) giving a description, recommended range, and current-value rationale.
- [Shared-ADR-003] Client-side physics constants MUST live in `src/config/physicsConfig.ts`, organized into clearly labeled sections; engine constants MUST NOT appear there (they live once in `dicesuki-core` per Shared-ADR-007).
- [Shared-ADR-003] The manual cross-language sync regime for physics-engine constants (defining them in both `physicsConfig.ts` and Rust and keeping them synced by hand) is retired: engine constants live once in `dicesuki-core` and reach the client at runtime via `EngineConfig` (Shared-ADR-007).

## Multiplayer Drag Interaction

- [Shared-ADR-004] Dragged dice MUST remain as dynamic rigid bodies; the server MUST set velocity toward drag target, not switch to kinematic mode.
- [Shared-ADR-004] `drag_start` MUST validate die ownership and reject if the die is already being dragged.
- [Shared-ADR-004] `drag_start` MUST start the physics simulation loop if not already running.
- [Shared-ADR-004] `drag_move` messages MUST be throttled to ~30Hz on the client (`MULTIPLAYER_DRAG_THROTTLE_MS` = 33ms).
- [Shared-ADR-004] The client MUST track the last `VELOCITY_HISTORY_SIZE` (5) position+timestamp samples during drag for throw calculation.
- [Shared-ADR-004] Dragged dice MUST use server-authoritative snapshot interpolation; there MUST be no optimistic client-side rendering during drag.
- [Shared-ADR-004] The `physics_snapshot` handler MUST NOT skip any dice; all dice update from snapshots uniformly.
- [Shared-ADR-004] The server MUST send 60Hz snapshots (`SNAPSHOT_DIVISOR=1`) during drag for responsive visual feedback.
- [Shared-ADR-004] `MultiplayerDie` `useFrame` MUST read position via `useMultiplayerStore.getState()`, not props, to avoid re-render overhead.
- [Shared-ADR-004] The multiplayer arena MUST use a 9:16 portrait aspect ratio (half-extents 4.5 x 8.0), defined once in `dicesuki-core` (`server/core/src/physics.rs`) and delivered to the client via `room_state.config` (Shared-ADR-007).
- [Shared-ADR-004] Players MUST only be able to drag their own dice; ownership validation MUST occur server-side.

## Supabase Hybrid Backend

- [Shared-ADR-006] The project MUST adopt a Supabase hybrid backend: Supabase owns identity and durable data, while the dev-box Axum room servers remain authoritative for physics.
- [Shared-ADR-006] Supabase MUST hold identity via Discord OAuth as the primary provider, with guest mode preserved for account-free play.
- [Shared-ADR-006] Durable user data (`profiles`, `settings`, dice `inventory`, `saved_rolls`) MUST live in Supabase Postgres with Row-Level Security; a player MUST only be able to write their own rows.
- [Shared-ADR-006] The frontend MUST use the Supabase JS client for auth and data sync; local cache/offline behavior and the first-sign-in migration from `localStorage` MUST be preserved per Frontend-ADR-002.
- [Shared-ADR-006] The room servers MUST remain physics-authoritative and add a JWT verification middleware, verifying player tokens locally against Supabase's cached JWKS URL (no shared secret, no per-request callout).
- [Shared-ADR-006] A Supabase `rooms` registry table MUST be the source of truth for room discovery, superseding any ad-hoc discovery mechanism.
- [Shared-ADR-006] Each dev-box server MUST upsert a `rooms` row keyed by its `INSTANCE_ID` (public URL, player count, `last_heartbeat`) on startup and heartbeat every N seconds; stale rows MUST be evicted by the existing stale-cleanup pattern (Server-ADR-001).
- [Shared-ADR-006] The client's room browser MUST be a public-read query (optionally Supabase Realtime for live updates).
- [Shared-ADR-006] The Docker image MUST be the distribution artifact for the room server.
- [Shared-ADR-006] The Supabase anon key and project id are public-safe and MAY appear in client environment configuration and documentation.
- [Shared-ADR-006] The service-role key and any JWT signing secret MUST NEVER be committed to the repository; they MUST be supplied via environment/secret storage on the systems that need them.
