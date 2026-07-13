# Architecture Rules (derived from ADRs)

> DO NOT edit by hand. Regenerate with `/adr:update`.
> Generated: 2026-07-13 | Source: 10 Accepted ADRs (4 Frontend, 1 Server, 5 Shared)

---

## 3D Rendering (React Three Fiber)

- [Frontend-ADR-001] The frontend MUST use `@react-three/fiber` v9 for all 3D rendering.
- [Frontend-ADR-001] Three.js geometries MUST be memoized with `useMemo` to prevent per-frame allocations.
- [Frontend-ADR-001] Event callbacks MUST be wrapped in `useCallback` to avoid unnecessary re-renders.
- [Frontend-ADR-001] Components SHOULD be wrapped in `React.memo` when receiving stable props.

## Client-Side Physics (Rapier WASM)

- [Frontend-ADR-001] `@react-three/rapier` v2 MUST be used for single-player physics simulation.
- [Frontend-ADR-001] Physics state MUST be read via refs, not React state, inside the simulation loop.
- [Frontend-ADR-001] React state updates from physics callbacks MUST be deferred with `requestAnimationFrame`.
- [Frontend-ADR-001] The `<Physics>` provider MUST NOT be rendered in multiplayer mode.

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
- [Server-ADR-001] Server code MUST reside in `server/`.
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
- [Shared-ADR-002] Message types MUST be defined in `src/lib/multiplayerMessages.ts` (client) and `server/src/messages.rs` (server), kept manually in sync.
- [Shared-ADR-002] The `error` message MUST include a machine-readable `code` field.
- [Shared-ADR-002] WebSocket upgrades require HTTP/1.1; reverse proxies MUST support this.
- [Shared-ADR-002] Drag interaction MUST use three message types: `drag_start`, `drag_move`, `drag_end`.
- [Shared-ADR-002] The `drag_end` message MUST include a `velocityHistory` array for throw calculation.

## Centralized Physics Configuration

- [Shared-ADR-003] All client-side physics constants MUST be defined in `src/config/physicsConfig.ts`.
- [Shared-ADR-003] Constants MUST be organized into clearly labeled sections (World Physics, Material, Roll Impulse, Face Detection, Drag, Throw, Device Motion, Geometry, Haptic, Multiplayer Arena, Presets).
- [Shared-ADR-003] Every constant MUST include a JSDoc comment with description, recommended range, and current value rationale.
- [Shared-ADR-003] Named preset objects SHOULD be defined for distinct gameplay styles (Realistic, Arcade, Gentle).
- [Shared-ADR-003] Server physics constants live in Rust source files; shared constants MUST be kept in sync manually.
- [Shared-ADR-003] Any change to a shared constant MUST be applied to both `physicsConfig.ts` and the corresponding Rust files.

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
- [Shared-ADR-004] The multiplayer arena MUST use a 9:16 portrait aspect ratio (`MULTIPLAYER_ARENA_HALF_X` = 4.5, `MULTIPLAYER_ARENA_HALF_Z` = 8.0).
- [Shared-ADR-004] Arena dimension constants MUST match between `src/config/physicsConfig.ts` and `server/src/physics.rs`.
- [Shared-ADR-004] Players MUST only be able to drag their own dice; ownership validation MUST occur server-side.

## Room-First Local Loopback Architecture

- [Shared-ADR-005] The room MUST be the single primitive for all dice play; solo and multiplayer MUST differ only in player count and server location, not in code path.
- [Shared-ADR-005] Solo mode MUST join an implicit one-player room served by a local Rust room server (loopback, `127.0.0.1`), reached from the Settings **Open Local Solo Room** action.
- [Shared-ADR-005] The client MUST verify the local room server is reachable (`GET /health` returns `status: "ok"` and an `instanceId`) before joining the implicit solo room.
- [Shared-ADR-005] When the local server is unavailable, the UI MUST surface an actionable error naming the loopback URL and the `npm run dev:local-room` start command, rather than an indefinite loader.
- [Shared-ADR-005] Local loopback server configuration (`VITE_LOCAL_ROOM_SERVER_URL` / `VITE_LOCAL_ROOM_SERVER_HTTP_URL`) MUST remain separate from public multiplayer server configuration.
- [Shared-ADR-005] Both solo and multiplayer dice MUST flow through the room WebSocket protocol (`join`, `room_state`, `spawn_dice`, `dice_spawned`, `physics_snapshot`, `die_settled`, drag messages).
- [Shared-ADR-005] `room_state` MUST carry an explicit `localPlayerId` so the client knows which player it controls.
- [Shared-ADR-005] Owned/inventory dice identity MUST be carried end-to-end via `presentation` metadata on spawn (`inventoryDieId`, `displayName`, `setId`, `rarity`, `baseColor`, `customAssetId`, `customAssetName`, `unsupportedReason`); the server treats physics as authoritative and `presentation` as client-provided display metadata.
- [Shared-ADR-005] Generic anonymous dice (e.g. `d20`, `2d6`) MUST spawn without any presentation block.
- [Shared-ADR-005] Rapier3D MUST run natively in the Rust room server at 60Hz for both solo and multiplayer rooms; the client MUST NOT render a `<Physics>` provider for dice play.
- [Shared-ADR-005] Dice MUST be rendered as positioned meshes only, driven by snapshot interpolation (lerp position, slerp rotation).
- [Shared-ADR-005] Face detection MUST run server-side; the server emits `die_settled` with the authoritative face value.
- [Shared-ADR-005] Active rooms MUST target 60Hz snapshots (`SNAPSHOT_DIVISOR = 1` in `server/src/room.rs`), superseding the 20Hz baseline.
- [Shared-ADR-005] The shared arena MUST remain 9:16 portrait (`WALL_HALF_X = 4.5`, `WALL_HALF_Z = 8.0` in `server/src/physics.rs`, matching `src/config/physicsConfig.ts`).
- [Shared-ADR-005] Arena and physics constants MUST remain manually synchronized between `src/config/physicsConfig.ts` and the Rust source; any change MUST be applied to both codebases.

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
