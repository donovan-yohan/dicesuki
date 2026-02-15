# ADR 001 - React Three Fiber with Rapier Physics for 3D Dice Simulation

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Daisu is a mobile-first dice simulator that requires realistic 3D rendering and physics. Users roll polyhedral dice (d4, d6, d8, d10, d12, d20) on a virtual table with drag-to-throw, device motion (tilt/shake), and haptic feedback. The simulation must run at 60fps on mid-range mobile devices while providing accurate face detection to determine roll results.

Key requirements:
- Realistic 3D rendering of polyhedral dice with customizable materials
- Physics simulation with collision detection, restitution, and friction
- Touch-based drag and throw interactions mapped to 3D space
- Face detection from physics body orientation to determine roll values
- Performance target: 60fps on mid-range mobile GPUs

## Decision

The frontend MUST use **React Three Fiber** (`@react-three/fiber` v9) as the React-declarative wrapper around Three.js for 3D rendering, paired with **@react-three/rapier** (v2) for WASM-based Rapier physics in single-player mode.

### Rendering Stack

- `@react-three/fiber` v9 provides the declarative React component model for Three.js scenes
- `@react-three/drei` v10 provides camera controls, environment lighting, and utility components
- `@react-three/postprocessing` v3 is available for future visual effects
- Three.js geometries MUST be memoized with `useMemo` to prevent per-frame allocations
- Event callbacks MUST be wrapped in `useCallback` to avoid unnecessary re-renders
- Components SHOULD be wrapped in `React.memo` when receiving stable props

### Physics Stack

- `@react-three/rapier` v2 provides the Rapier WASM physics engine
- Physics runs in single-player mode only; multiplayer MUST NOT render a `<Physics>` provider (see `shared/001-dual-physics-architecture.md`)
- `RigidBody` and collider components provide per-die physics
- `onContactForce` callbacks drive haptic feedback (see haptic system in CLAUDE.md)
- Physics state MUST be read via refs, not React state, inside the simulation loop
- React state updates from physics callbacks MUST be deferred with `requestAnimationFrame` to prevent dice "popping"

### Face Detection

- Face detection uses quaternion-to-face-normal mapping from the physics body orientation
- Each die type (d4 through d20) has a precalculated face normal table
- Detection runs only after a die meets rest-state criteria (velocity below threshold for configured duration)

## Alternatives Considered

**Babylon.js + built-in physics:** Babylon provides an integrated physics engine, but its React integration is less mature than R3F. The declarative component model of R3F aligns better with the existing React architecture and Zustand state management.

**cannon-es (cannon.js):** A pure JavaScript physics engine. While simpler to integrate, Rapier's Rust-compiled WASM provides significantly better performance and determinism, which is critical for accurate face detection on mobile.

**Custom WebGL + Ammo.js:** Maximum control but requires building the entire rendering pipeline. R3F provides the abstraction layer needed for rapid iteration without sacrificing performance.

## Consequences

### Positive

- Declarative React components for 3D scenes integrate naturally with existing React patterns and Zustand stores
- Rapier WASM provides near-native physics performance in the browser
- Large ecosystem of `drei` utilities reduces boilerplate (environment maps, camera controls, text rendering)
- Active community and maintenance across the `@react-three` ecosystem
- The same Rapier engine (native Rust) runs on the server for multiplayer, ensuring physics parity

### Negative / Considerations

- Testing R3F components requires extensive mocking (ResizeObserver, WebGL context, canvas APIs) as documented in CLAUDE.md test setup
- Three.js upgrade path requires coordinating across `fiber`, `drei`, `rapier`, and `postprocessing` packages simultaneously
- WASM physics adds ~2MB to initial bundle size
- Rapier WASM runs on the main thread; heavy scenes (many dice) can compete with rendering for frame budget
- R3F abstractions occasionally leak (imperative Three.js access needed for advanced material/geometry work)
