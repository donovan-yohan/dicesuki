# ADR 003 - Centralized Physics Configuration

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

The dice simulator exposes a large surface area of tunable physics parameters: gravity, material properties (restitution, friction), roll impulse ranges, rest detection thresholds, drag mechanics, device motion sensitivity, haptic feedback thresholds, and geometry detail levels. These parameters directly affect game feel and must be adjusted through iterative playtesting.

During development, physics constants were initially scattered across component files, hooks, and inline values. This made it difficult to:
- Find which constant controlled a specific behavior
- Adjust parameters without hunting through multiple files
- Ensure the same constant was used consistently across multiple consumers
- Compare parameter sets for different "feels" (realistic vs arcade)

Additionally, shared constants (gravity, restitution, friction, rest thresholds) must match between the client (`physicsConfig.ts`) and the Rust server (`physics.rs`, `dice.rs`) for physics parity in multiplayer mode (see `shared/001-dual-physics-architecture.md`).

## Decision

All client-side physics constants MUST be defined in a single file: `src/config/physicsConfig.ts`. This file serves as the single source of truth for every tunable physics parameter on the frontend.

### File Organization

Constants MUST be organized into clearly labeled sections:

| Section | Examples |
|---------|----------|
| World Physics | Gravity, time step mode |
| Dice Material Properties | Restitution, friction, chamfer radius |
| Roll Impulse Generation | Horizontal/vertical impulse ranges |
| Face Detection & Rest State | Velocity thresholds, rest duration |
| Drag Interaction | Follow speed, distance boost, spin factor, plane height |
| Throw Mechanics | Velocity scale, upward boost, speed limits |
| Device Motion | Gravity scale, acceleration scale, shake threshold, deadzones |
| Geometry Settings | Polyhedron detail level |
| Haptic Feedback | Speed/force thresholds, vibration durations, throttle interval |
| Presets | Named parameter sets (Realistic, Arcade, Gentle) |

### Documentation Standard

Every constant MUST include a JSDoc comment block with:
1. **Description** of what the parameter controls
2. **Recommended range** with specific values and their effects
3. **Current value** rationale (why this value was chosen)

Example:
```typescript
/**
 * Restitution (bounciness) of dice
 * - Range: 0.0 (no bounce) to 1.0 (perfect bounce)
 * - 0.3: Realistic dice behavior (some bounce, settles quickly)
 * - 0.5: Bouncy, takes longer to settle
 * - 0.1: Dead bounce, settles very fast
 */
export const DICE_RESTITUTION = 0.3
```

### Presets

Named preset objects SHOULD be defined for distinct gameplay styles. Presets provide a quick way to switch between parameter sets during playtesting:

| Preset | Character |
|--------|-----------|
| `PRESET_REALISTIC` | Simulates real dice on felt, conservative values |
| `PRESET_ARCADE` | Fast, snappy, responsive, higher impulses |
| `PRESET_GENTLE` | Slow, careful, precise, lower impulses |

Presets are exported as `const` objects and MAY be selected at runtime in a future settings UI.

### Server-Side Constants

Server physics constants live in Rust source files (`server/src/physics.rs`, `server/src/dice.rs`, `server/src/room.rs`). The shared constants listed in `shared/001-dual-physics-architecture.md` MUST be kept in sync manually. Any change to a shared constant MUST be applied to both codebases.

## Alternatives Considered

**Environment variables / runtime config:** Would allow tuning without code changes, but physics constants are tightly coupled to game feel and need compile-time type safety. Most parameters require a page reload to take effect anyway (physics world initialization).

**JSON config file:** Would enable non-developer editing and potential runtime loading, but loses TypeScript type checking, JSDoc documentation, and IDE autocompletion. The current approach provides superior developer experience.

**Constants spread across consuming modules:** The "define it where you use it" pattern. This was the initial approach and caused the problems described in Context. Centralizing eliminated duplication and made tuning tractable.

**Shared constants package (npm + Rust crate):** A shared package consumed by both client and server would enforce sync at build time. The tooling overhead (cross-language package, build pipeline changes) is not justified for ~15 shared constants that change infrequently.

## Consequences

### Positive

- Single file to review when adjusting game feel; no hunting through components
- Comprehensive documentation makes each parameter self-explanatory, including recommended ranges
- Named presets enable quick A/B comparisons during playtesting
- All consumers import from the same source, preventing value drift between components
- TypeScript `const` exports provide tree-shaking and type safety

### Negative / Considerations

- The file grows large as new parameter categories are added (~460 lines currently); section headers and consistent formatting mitigate this
- No automated sync between `physicsConfig.ts` and Rust constants; changes to shared values require manual cross-codebase updates
- Presets are defined but not currently selectable at runtime; a settings UI would be needed to make them user-facing
- Some parameters (haptic thresholds) were tuned empirically on specific devices; values may not be optimal across all device types
- Adding a new physics parameter requires both defining the constant in `physicsConfig.ts` and importing it in the consuming module; forgetting the import leads to silent use of default/hardcoded values
