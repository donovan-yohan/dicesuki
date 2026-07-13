# ADR 007 - WASM Room Core: One Physics Engine, One Constant Set Everywhere

* Date: 2026/07/13
* Status: Accepted
* Deciders: Donovan, Development Team
* Supersedes (in part): [ADR 005 - Room-First Local Loopback Architecture](005-room-first-local-loopback-architecture.md) (native-loopback *mechanism* only), [ADR 003 - Centralized Physics Configuration](003-centralized-physics-configuration.md) (manual cross-language *sync regime* only)
* Epic: #111 — WASM room core. Constant-reconciliation child: #117.

## Context

ADR 005 made the room the single primitive for dice play and mandated no client
`<Physics>` provider. But its solo path — a native Rust room server on `127.0.0.1`
reached via `dev:local-room` / `VITE_LOCAL_ROOM_SERVER_*` / the "Open Local Solo
Room" action — left solo and multiplayer as **two separately-built engines** that
can drift, and could never run in a plain offline browser tab (tracked in #38).
Concrete drift existed:

* **Feel divergence.** Roll torque was `±5` on the server
  (`server/src/dice.rs`, `gen_range(-5.0..5.0)`) but `±1` on the client
  (`src/components/dice/Dice.tsx`, `(Math.random()-0.5)*2`) — the same die threw
  differently by mode.
* **Constant drift hazard.** ADR 003 kept physics constants in
  `src/config/physicsConfig.ts` **and** the Rust source, "manually kept in sync" —
  re-opened every tuning pass.

## Decision

Replace client-side `@react-three/rapier` entirely. The server's physics / dice /
room-simulation / message / face-detection logic is the shared crate
**`dicesuki-core`**, compiled to **two targets from one source**:

1. the **native multiplayer server binary**, and
2. a **`wasm-bindgen` module run inside a Web Worker** as an in-browser room
   server, speaking the existing JSON room protocol over `postMessage`.

Default page load is a WASM room compiled from the **same core crate, same
constants, same settings** that build the real multiplayer server.

### Single source of truth for engine constants (this ADR's constant-reconciliation half, #117)

* Every physics-**engine** constant (gravity, restitution/friction, edge chamfer,
  roll impulse & torque, settle/knock thresholds, drag & throw response, velocity
  clamp, motion clamp/rate-limit, arena bounds) MUST be defined **once** in
  `dicesuki-core` (`server/core/src/physics.rs`), each with a rustdoc comment
  giving description, recommended range, and current-value rationale (ADR 003's
  documentation requirement, retained). Because both build targets link this one
  crate, a value edited there provably reaches the native server binary **and** the
  shipped wasm room with **no other file touched**.
* There is exactly **one roll torque/impulse definition**: `ROLL_TORQUE_MAGNITUDE`
  (currently `5.0`) in `dicesuki-core`. Solo and multiplayer roll identically; the
  `±1` vs `±5` divergence is gone. (Roll *feel* tuning is now a one-file edit in
  core and may be revisited after solo playtesting.)
* `src/config/physicsConfig.ts` MUST carry **no** engine constants — only
  client-side concerns (geometry detail, device-motion sensor scaling, haptic
  thresholds, input/message throttles, the client shake-impulse mapping, and the
  client-side motion send throttle/clamp that mirror the room policy).
* Where the browser genuinely needs an engine value at runtime, it MUST obtain it
  **from `dicesuki-core`**, never from a copied literal:
  * `dicesuki_core::config::EngineConfig::current()` projects the engine constants
    to a camelCase JSON object.
  * Every `room_state` message carries it (`ServerMessage::RoomState.config`);
    both the native server and the wasm room send the identical payload. The client
    stores it in `useMultiplayerStore.engineConfig` and reads it through
    `src/config/engineConfig.ts` (e.g. arena bounds for camera fit and wall
    rendering).
  * Before any room exists, the wasm module exposes the same data via the
    `engineConfigJson()` `wasm-bindgen` getter.
* A drift guard MUST fail closed if an engine constant reappears on the client's
  live config or if the client stops sourcing engine values from the room:
  * Rust: `server/core/src/config.rs` asserts `EngineConfig::current()` reflects the
    `physics` constants (the "both targets see the change" half).
  * Client: `src/config/physicsConfig.guard.test.ts` asserts `physicsConfig.ts`
    exports no engine constant and that arena bounds arrive via `room_state.config`.

Guardrails (non-negotiable, from the epic): the WASM room is `dicesuki-core`
compiled to wasm — never a re-implementation; the Web Worker host is a thin shim
(instantiate wasm, forward protocol JSON, drive the tick timer) with no game logic
in JS/TS; no wasm-specific behavior forks live inside core (platform-glue feature
flags limited to clock and RNG). A wasm limitation is fixed **in core** so both
targets get it.

## Scope of supersession (partial)

* **ADR 003 — Centralized Physics Configuration.** Its principle that constants are
  *centralized and documented* **stands**. Its **manual cross-language sync regime**
  ("constants live in both `physicsConfig.ts` and Rust, kept in sync by hand; any
  change must be applied to both") is **retired** for physics-engine constants:
  they live once in `dicesuki-core` and reach the client at runtime via
  `EngineConfig`.
* **ADR 005 — Room-First Local Loopback Architecture.** Its **room-as-primitive**
  principle **stands** (and is strengthened). Its **native-loopback mechanism** for
  solo — the `127.0.0.1` Rust server, `dev:local-room`,
  `VITE_LOCAL_ROOM_SERVER_URL`/`_HTTP_URL`, and the "Open Local Solo Room" Settings
  action — is **superseded** by the in-browser wasm room worker; `npm run dev` no
  longer launches the Rust room server for solo.
* **#38** (native-sidecar packaging for offline solo) is superseded by the wasm room.

## Alternatives Considered

* **Keep the dual engines (ADR 005 as-shipped).** Rejected: the source of the feel
  divergence and constant-sync burden; structurally permits drift.
* **Keep the native sidecar loopback for solo (#38 packaging).** Rejected: ships a
  native binary per platform, still two build artifacts that can diverge, and cannot
  run in a plain offline browser tab.
* **Use `rapier.js` on the client with ported constants.** Rejected: a *different*
  engine build driven by *duplicated* constants and JS-side stepping/settle logic —
  exactly the drift this eliminates. Only compiling *our* Rust core guarantees
  identical results.
* **Build-time codegen of a TS constants file from Rust.** Rejected in favour of the
  runtime `EngineConfig` payload + wasm getter: the client needs no engine value
  before a room exists, and the room already delivers the config, so no generated
  file or extra build step is introduced.

## Consequences

**Positive**

* Engine drift becomes structurally impossible: one crate, one constant set, two
  compile targets. A feel tweak is one Rust edit reaching solo and multiplayer
  identically, proven by the drift guard.
* The `±1` vs `±5` torque divergence and the manual constant-sync regime are gone.
* The client keeps no copied engine literal; `physicsConfig.ts` holds only
  client-side concerns.

**Negative / Considerations**

* A transitional shim (`src/config/legacyClientPhysics.ts`) temporarily holds the
  engine constants the deprecated client `<Physics>` path still imports
  (`Dice.tsx`, `CustomDice.tsx`, the hero-die preview, etc.). It is quarantined out
  of `physicsConfig.ts` and **deleted with that path in #115**; it must not be
  imported by any room/engine-path code.
* Supersession is *partial* (see above); the standing principles of ADR 003 and
  ADR 005 remain in force.

## References

* Epic #111; child #117 (this constant-reconciliation ADR). Builds on
  [ADR 002 - WebSocket JSON Protocol](002-websocket-json-protocol.md) and
  [ADR 004 - Multiplayer Drag Interaction](004-multiplayer-drag-interaction-architecture.md).
* `server/core/src/physics.rs` (single source), `server/core/src/config.rs`
  (`EngineConfig`), `server/wasm/src/lib.rs` (`engineConfigJson`),
  `src/config/engineConfig.ts`, `src/config/physicsConfig.guard.test.ts`.
