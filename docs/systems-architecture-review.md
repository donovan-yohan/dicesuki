# Systems Architecture Review

## Scope
Audit performed as of the current `daisu-app` Phase 1 codebase, focusing on scalability, separation of concerns, and developer experience for adding additional dice, input modes, and UI layers.

## Key Findings
1. **Canvas, physics, and HUD are tightly coupled** – `Scene` owns everything from `<Canvas>` to UI overlays, motion controls, history, and debug panels (`src/components/Scene.tsx:42-211`). This makes it hard to swap cameras, add multiple dice, or render alternate layouts without re-authoring the entire scene tree. Extracting a `DiceArena` (canvas + physics), `MotionController`, and HUD layer that consume shared context would localize changes and enable Storybook-style rendering of HUD components without booting the 3D world.

2. **Device motion thrashes React renders** – `useDeviceMotion` keeps the gravity vector and shake flag in React state (`src/hooks/useDeviceMotion.ts:46-166`). When permission is granted, every `devicemotion` sample (typically 60–100Hz) triggers a `setGravityVector`, re-rendering `Scene` and recreating `<Physics gravity={…}>`, even though gravity should update imperatively. Store the raw vector in a ref, expose it via a Rapier-side controller (e.g., `useFrame` or `PhysicsController`), and let React state only reflect coarse permission/shake changes.

3. **Random props force unnecessary dice re-mounts** – Despite memoization, D6 receives a new `rotation={[Math.random()…]}` on every `Scene` render (`src/components/Scene.tsx:132-139`). Coupled with finding #2, the dice sees fresh props dozens of times per second, defeating the “physics must never re-render” guideline noted at lines 36-40. Cache the initial orientation in a `useRef` or move randomization into the `applyImpulse` handler so Canvas re-renders do not touch mesh props.

4. **Dice implementation is not reusable** – `src/components/dice/D6.tsx` embeds rest detection, pointer interactions, rigid-body lifecycle, and imperative handles in one 200+ line component. Scaling to D4/D8/D20 would require copy-pasting the entire hook stack. The metadata already exists in `src/lib/geometries.ts`; introducing a `createDiceBody({geometry, faceNormals, colliderConfig})` factory plus shared hooks (`useDicePhysics`, `useDiceInput`) would let new dice declare only their shape-specific pieces. Relatedly, the `DiceSelector` UI (`src/components/DiceSelector.tsx`) is currently dead code because no shape registry drives the scene.

5. **Performance overlay cannot render inside Canvas** – `PerformanceOverlay` leverages `useFrame` (requiring Canvas context) yet returns regular DOM markup (`src/hooks/usePerformanceMonitor.tsx:60-88`). Because it’s mounted as a child of `<Canvas>` (`src/components/Scene.tsx:143-145`), toggling it will ask the three-fiber reconciler to instantiate a `<div>` in the 3D scene, which will throw unless wrapped in `drei/Html`. Move the overlay outside Canvas (render alongside `Scene` or portal it via `<Html>`), and keep the stats hook inside the Canvas tree through a lightweight bridge component.

6. **Device motion button tests are broken** – The component now requires explicit props (`src/components/DeviceMotionButton.tsx:1-63`), but the Vitest suite instantiates it with none (`src/components/DeviceMotionButton.test.tsx:15-87`). The test suite therefore fails to compile, masking regressions and indicating missing CI coverage for the permission flow. Update the tests (or convert to integration tests) and gate merges on `npm run test`.

7. **Dev server hard-depends on local TLS certificates** – `vite.config.ts:10-24` synchronously reads `.cert/localhost+3*.pem`. A clean clone or CI environment without those files fails to start `npm run dev` or even `npm run build`. Use `process.env.VITE_USE_HTTPS` + optional paths, and fall back to HTTP so other contributors and automated pipelines can boot the app.

## Opportunities & Next Steps
- Introduce domain-specific contexts or Zustand slices (`motion`, `dice`, `ui`) so Canvas consumers subscribe to refs instead of React state.
- Build a dice registry (shape → geometry factory, collider, material, result interpreter) and render dice via configuration rather than single-purpose components.
- Separate HUD/UI composition (result/history panels, buttons, debug overlays) into a standard React tree for easier testing and theming; only keep physics primitives inside `<Canvas>`.
- Add integration tests (Vitest + testing-library) for the Scene shell that verify device compatibility gating and Roll pipeline, catching regressions before they reach Rapier.
