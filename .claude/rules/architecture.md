# Architecture Rules (derived from ADRs)

> DO NOT edit by hand. Regenerate with `/adr:update`.
> Generated: 2026-02-15 | Source: 8 Accepted ADRs (4 Frontend, 1 Server, 3 Shared)

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

## Dual Physics Architecture

- [Shared-ADR-001] The project MUST maintain a dual physics architecture: client-side Rapier WASM (single-player) and server-side Rapier3D native (multiplayer).
- [Shared-ADR-001] In multiplayer, the client MUST NOT render a `<Physics>` provider.
- [Shared-ADR-001] In multiplayer, dice MUST be rendered as positioned meshes only (no local physics bodies).
- [Shared-ADR-001] The server MUST stream `physics_snapshot` messages at 20Hz (every 3rd physics tick).
- [Shared-ADR-001] Clients MUST interpolate between snapshots using lerp (position) and slerp (rotation).
- [Shared-ADR-001] Face detection in multiplayer MUST run server-side; the server sends `die_settled` with the authoritative face value.
- [Shared-ADR-001] Shared physics constants MUST match between `src/config/physicsConfig.ts` and `server/src/physics.rs` + `server/src/room.rs`.
- [Shared-ADR-001] Any change to a shared physics constant MUST be applied to both client and server codebases.

## WebSocket JSON Protocol

- [Shared-ADR-002] Client-server communication MUST use WebSocket transport with JSON serialization.
- [Shared-ADR-002] All messages MUST use a `type` field as the discriminator for tagged union deserialization.
- [Shared-ADR-002] JSON field names MUST use camelCase.
- [Shared-ADR-002] Rust struct fields MUST use `#[serde(rename = "camelCase")]` annotations.
- [Shared-ADR-002] The `physics_snapshot` message MUST use compact field names (`p`, `r`) for bandwidth efficiency.
- [Shared-ADR-002] Message types MUST be defined in `src/lib/multiplayerMessages.ts` (client) and `server/src/messages.rs` (server), kept manually in sync.
- [Shared-ADR-002] The `error` message MUST include a machine-readable `code` field.
- [Shared-ADR-002] WebSocket upgrades require HTTP/1.1; reverse proxies MUST support this.

## Centralized Physics Configuration

- [Shared-ADR-003] All client-side physics constants MUST be defined in `src/config/physicsConfig.ts`.
- [Shared-ADR-003] Constants MUST be organized into clearly labeled sections (World Physics, Material, Roll Impulse, Face Detection, Drag, Throw, Device Motion, Geometry, Haptic, Presets).
- [Shared-ADR-003] Every constant MUST include a JSDoc comment with description, recommended range, and current value rationale.
- [Shared-ADR-003] Named preset objects SHOULD be defined for distinct gameplay styles (Realistic, Arcade, Gentle).
- [Shared-ADR-003] Server physics constants live in Rust source files; shared constants MUST be kept in sync manually.
- [Shared-ADR-003] Any change to a shared constant MUST be applied to both `physicsConfig.ts` and the corresponding Rust files.
