# Woodland Environment and Asset Pipeline

> Historical prototype plan. Its authorization limits, measurements and workstream states describe the original Woodland development snapshots, not the current publication candidate. See [Themed Dice Worlds](themed-dice-worlds.md) and the current PR for final integration and delivery evidence. Ignored artifact/scratch references are privately retained and are not public evidence links.

## Scope

Add a selectable Sunlit Glade dice box while retaining the existing themes and room-authoritative dice physics. Deliver a tiered WebGL forest renderer, a reproducible Blender wood D6 proof, and browser/device evidence. Do not publish catalog entries, releases, migrations, commits, or deployments.

## Design

Use the existing theme registry and `useEnvironmentTheme` authority. Add a data-only optional `environment.scene` recipe with `kind: 'woodland'`. Existing themes without a recipe keep their current renderer and Canvas settings. One pure `resolveEnvironmentQuality` function resolves requested effects into bounded low/mid/high settings. The environment renderer consumes authoritative arena bounds from `useEngineConfig`; it never changes colliders or room behavior.

A separate renderer registry was considered. It adds another schema/dispatch boundary without a second structurally different renderer, so defer it. Theme data owns art direction; Three.js components own GPU resources. Dice appearance stays independent of room environment.

Initial woodland budgets are hypotheses, not measured guarantees. Opaque instanced grass does not cast shadows. Root shading and dappled floor coloration approximate static bounce; the existing self-hosted HDR provides IBL. Sun shafts are bounded transparent geometry, not dynamically occluded volumetrics. No new composer, real-time GI, engine upgrade, or dependency is required. Reduced motion freezes ambient animation. Coarse-pointer devices and compact viewports cap environment quality even if GPU detection reports high.

## Workstream boundaries

Blocking work is the before-change render measurement and the shared recipe/quality contract. Rendering implementation and Blender authoring can then proceed independently. Shared mutable state is limited to Scene composition, theme registration and development asset routing, all parent-owned. The rendering worker owns new environment modules only; the asset worker owns new authoring scripts and ignored experiment outputs only. The parent owns integrated builds and test gates.

## Contract

- `EnvironmentCustomization.scene?: { kind: 'woodland'; seed: number; grass: { base: string; tip: string }; sunlight: string; pollen: string }`.
- `resolveEnvironmentQuality({ deviceTier, compactViewport, coarsePointer, reducedMotion })` returns `{ tier, maxDpr, shadowMapSize, grassCount, particleCount, shaftCount, animate }`.
- `WoodlandEnvironment({ recipe, quality })` renders decorative scenery, a matching ground surface and rim, deriving dimensions from engine config. It replaces the legacy arena visually only for this recipe. It does not own lighting or Canvas.
- No environment loader may suspend the scene-ready signal. Texture/artifact failures retain playable fallback geometry.
- Experimental dice must not enter `public/dice`, immutable source locks or catalog discovery. Keep authoring bytes beneath ignored `.artifacts/theme-workshop/experiments/woodland/` and serve only explicit files through a dev-only fixed allowlist.

## Acceptance

1. Switch between Sunlit Glade and existing themes without page reload or lost dice.
2. Low/mobile tiers bound grass, disable expensive atmosphere, and preserve floor/dice readability. Desktop adds denser grass, motes and geometry shafts.
3. Reduced-motion changes apply live. Resize/rotate retains authoritative arena alignment.
4. Blender outputs a reusable `.blend`, textured/normal-mapped GLB, provenance and six-face proof. Verify final world bounds and all six canonical value-normal assignments after export.
5. Tests cover policy caps, deterministic placement, theme registration, art/physics separation and development asset isolation.
6. Run full unit tests, lint, production build and authoring boundary checks. Record browser errors and screenshots.
7. Compare before/after idle and rolling frame-time distributions with identical dice counts and surface dimensions. Desktop browser measurements do not certify mobile. Record physical Pixel results and thermal-test limits honestly.

## Baseline

Checkout `f3ce6cf56ed5d74dad7cf8dc9d043970cab25a0a`, clean on discovery; recorded origin/main is one commit ahead. No pull performed.

- `npm ci` completed. It reports existing dependency vulnerabilities; no audit-fix changes applied.
- `npm run build` passed, with existing large-chunk warning.
- `npm run lint` passed.
- `NODE_OPTIONS=--no-experimental-webstorage npm run test -- --run` passed 168 files / 2,176 tests. Node 26's global Web Storage conflicts with the test environment without this flag; plain invocation failed before any source changes.
- Image generation attempted through the configured native tool. Provider returned HTTP 404 for `gpt-image-2-high`; no generated image was produced. Use honestly attributed procedural Blender textures for the first asset proof rather than fabricate an ImageGen result.

## Prototype checkpoint

The local prototype is delivered, not promoted. See
`docs/guides/woodland-prototype-evidence.md` for final gates and limits.
Sunlit Glade, tier budgets, live shadow allocation, reduced motion, Blender
canonical proof and optimized tier assets are implemented and exercised.
All 2,240 unit tests, two integrated GPU checks, lint/build and authoring
boundary pass. Blender and optimized-asset node suites also pass.

Mobile performance parity remains open. The Pixel run had a blank canvas,
null renderer and zero work; its RAF timings are rejected. The device then
disconnected. Desktop timing is noisy under host load and cannot replace
physical-device or thermal acceptance. Realistic forest art, modeled carving,
baked GI, final ImageGen art and immutable production promotion are later
work, not completed claims. Keep this plan active until device/art acceptance.

## Grass art-direction correction

The first tray is rejected visually. Grass must grow throughout the box, with
no rectangular inner cutoff or visibly repeating ground pattern. The target
is a Genshin-inspired painterly meadow: readable tapered blades, rich root/tip
colors and coherent wind passing through the field. This is original scene
art direction, not a claim to reproduce that game's implementation.

Keep the existing recipe/resource boundary and authoritative physics. Compare
opaque segmented blades with clump cards before selecting the smaller change.
Full-field seeded coverage and nonperiodic spatial color variation replace
the perimeter rule and periodic sine ground. Increase tier budgets explicitly
if needed; preserve reduced motion and verify actual pixels move in the center.
Deliver a short real-rendered motion clip plus desktop/mobile screenshots.

Parent owns visual/browser acceptance and final gates. A renderer worker may
own geometry/shader/tests and quality budgets together after design selection;
no concurrent writers touch those files. Existing asset pipeline is unchanged.

## Patch density and dice response

The full-field meadow is accepted as an improvement. The next local slice is
irregular density, including soft-edged bare patches and dense growth, plus
visual compression/bending where dice move through grass and gradual recovery.
The distribution must not return to a rectangular perimeter or cleared center.
Density remains stable for a seed; rolling dice deform the field, not its roots
or authoritative physics. Keep fixed blade budgets and bounded interaction work.

Compare a fixed interaction texture with capped capsule uniforms before code.
Prefer one local visual state owner and read room snapshots without subscribing
React to frame-frequency updates. Ignore airborne dice, reset on arena/theme
replacement and clear stale contacts after removal. Reduced motion must keep
ambient wind frozen while preserving a restrained, functional dice response.
Tests cover density contrast, bounds/determinism, interpolation and height
gating, recovery/removal, disposal and actual rendered response/recovery pixels.
Capture a real-scene roll/drag proof after integration; manually stepped video
remains appearance evidence, not performance qualification.

Selected a fixed 64x64 recovering pressure texture over per-blade capsule
loops. It keeps shader work independent of the number of dice and retains
short-lived trails. A bounded CPU visual-contact pass stamps grounded dice;
float recovery state is encoded into RG bend/B compression bytes. Resources
own texture disposal. The existing snapshot interpolation ref is shared by
dice and grass, updated before their frame subscribers. Density uses a fixed
48x48 seeded cumulative field with soft-edged clearings and exact existing
blade counts, avoiding rejection loops or per-frame distribution rebuilds.

## Rejected density and wind revision

The user rejected the latest result. The clearing centers alternate quadrants,
producing four visually spaced holes rather than continuous noise-based density.
Two travelling sine fronts plus biased blade rest directions read as an optical
illusion. Passing geometry/contact checks did not establish art acceptance.
Preserve the predecessor and replace this visual model using established game
foliage techniques. Measure live frame pacing separately from encoded footage;
the real-roll recording was encoded at 25 fps and is not a render benchmark.
The rejected source was frozen for profiling and privately preserved under the
scratch directory `grass-rejected`. At that checkpoint the replacement renderer owned only
grass geometry/field files; independent profiling owns its browser and uses
classic scenes plus the frozen production baseline.

References for the revision include Crytek's main/detail vegetation bending,
vertex-weighted stiffness and inexpensive foliage lighting. Prefer a coherent
density field over arranged holes and a directed, irregular breeze over a
field-wide periodic wave. Keep physical-mobile acceptance separate.

### Replacement contract

Retain the current resource lifecycle and contact field, without adding a
second renderer registry or public foliage configuration. Use opaque geometric
tufts with a three-triangle curved ribbon and full-circle rest orientations.
A world-space domain-warped density field controls bounded deterministic
thinning. Blade budgets become caps, not a requirement to pack every rejected
blade elsewhere. Bake static palette and yaw into instance attributes.
Advect a small seamless vector-noise texture along a prevailing wind, with
root-pinned height/stiffness response and modest crosswind. Reuse wind/contact
samples for normal and position deformation; remove static per-vertex FBM.

The rejected-revision profile used actual Metal rendering and no recording.
Both themes had severe delivery stalls in the loaded dev/headless run; grass
added GPU work but did not explain the whole delay. Receipts live under
`performance/rejected-meadow/`. The frozen-release comparison reproduced the
common stalls and showed substantial off-CPU wall time; the exact scheduler or
native-wait cause remains unresolved. No unrelated host processes were stopped.

### Replacement repair gates

Independent review found an unsampled rectangular tail from a partial final
candidate row and unsupported RGFormat textures on WebGL1. Regression tests
failed for both before repair. The partial row now spans the full width;
RGBA8 storage preserves the two RG data channels on both WebGL versions.
Actual WebGL1 rendering produced nonzero geometry with GL error zero. All
57 focused tests, refreshed three-tier capture, controlled contact/recovery,
three browser integration tests, lint and production build pass. Read-only
review closed both findings on the repaired source. The repaired full suite
passed 2,287 tests across 177 files, with no failures or skips.

The real-roll browser test encountered the existing toolbar hover-scale loop
and its pointer stability wait. It now exercises native keyboard activation
of Clear All after the actual UI roll and pressure assertion, without bypassing
the room command handler. The pointer-hover issue is not claimed fixed.
The physical phone is connected but dozing on its lock/notification surface;
no lock-screen input or authentication-app interaction was attempted.

### Ground integration pass

Use the spare ground-texture B channel for static root occlusion, baked only
at resource creation. Blend sparse ground toward olive/earth tones and dense
ground toward short-grass color using the existing field. No additional draw,
geometry, texture, render pass or per-frame upload is introduced. A RED→GREEN
regression proves root shade follows actual roots and is absent with no grass.
The updated source passes 2,288 tests across 177 files, three browser tests,
lint/build, authoring-boundary checks, actual WebGL1 rendering and controlled
contact/recovery. `root-ground-final/` holds final visual evidence and hashes.
Dense foliage readability, broader forest composition and physical device
frame-time/thermal qualification remain open. Do not use fixed-time appearance
clips or earlier source profiles as the performance verdict for this revision.

### Lush forest-clearing correction

The user rejected the earth-colored undercoat: the intended setting is a lush
fantasy forest clearing. The supplied Genshin reference and studied Wind Waker,
Breath of the Wild and Mondstadt flora screenshots guide this pass. Full notes
and source links are in `docs/guides/forest-clearing-art-reference.md`.

Matched original mipmapped blade and ground albedos now replace flat material
color and exposed brown soil. Sage/moss palette saturation is reduced while
retaining warm tips and cooler shade. Keep actual grass density variation,
contact recovery and wind intact. Image generation failed with model-not-found;
the texture maps are explicitly generated brushwork, not provider artwork.

The visible framing must become irregular trunks, root flares and leafy shrubs
around a clearing, not four exposed straight planks. Add a small bounded flower
layer including cream daisies, yellow blooms and pale dandelion seed heads.
Keep central dice visibility, authoritative colliders and room protocol intact.
The two sketches compared merged geometry against instancing. Selected three
merged vertex-colored Lambert batches for the static small-scene border:
bark/roots, broad cupped leaf sprays and wildflowers. One `createForestDecor`
helper returns a Group; the existing caller owns lifecycle and shared time.
No extra updater, network loader, public quality schema or registry is needed.
The worker owns only the helper and its colocated tests; parent owns replacing
the plank block, combined tests and actual rendering. Central dice visibility
and an irregular, leafy silhouette are rendered acceptance criteria, not facts
established by batch counts.

### Integrated forest candidate

The three-batch helper is now integrated and the four plank meshes are removed.
Desktop, compact-mid and low captures compile without page/console errors;
the motion comparison excludes forest decoration so only grass contributes.
A real four-D6 UI roll preserves readable dice. The actual high scene has
4,777 grass leaves and 8,338 forest/flower triangles; the forest adds three
main-pass draws while the removed planks previously used four. This is static
geometry evidence, not mobile frame-time parity.

Actual WebGL1 renders 9 draws / 8,171 triangles without GL errors. Controlled
contact changes 1,502 grass-only pixels and recovers exactly. All three browser
integration tests passed with a clean standalone process exit. The final full
suite is blocked on the test runner: the fork-pool process remained idle with
no output/JSON for over twenty minutes and was terminated by the parent. A
Node 22 probe also stalled; a threads-pool probe reported a runner-start timeout
and teardown timeout. These are not clean test passes or demonstrated product
failures. No timeouts were widened and unrelated host work was left untouched.
The earlier helper/integration-focused results remain separately attributed.
The final
production build and authoring-boundary gate exited zero. A smoke of that built
bundle spawned and rolled four guest dice through the real UI, with 4,285
instrumented WebGL draws, GL error zero and no page/console errors. Its owned
preview server and browser were closed. This is runtime smoke, not an FPS result.
Independent read-only review found no blocking correctness/security defects.
It verified safe-edge geometry, bounded batches, WebGL1-compatible texture
handling, disposal and unchanged physics. Two minor approximations remain:
flower culling bounds omit up to approximately 0.046 world units of shader sway,
and flower lighting uses undeformed normals. Neither caused a demonstrated
gameplay-camera failure; no source repair is claimed for them. No further source
edits are planned before gate receipts. Art acceptance remains user-owned.

## Primary references

- https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis
- https://godotshaders.com/shader/stylized-grass-with-wind-and-deformation/
- https://www.zeldadungeon.net/wiki/File:Hyrule_Field_-_BotW.png

- https://threejs-journey.com/lessons/baking-and-exporting-the-scene
- https://github.com/brunosimon/folio-2019/blob/540f13573a6da282eae942a4c67335b97cd18970/src/javascript/World/Materials.js
- https://github.com/al-ro/al-ro.github.io/blob/master/projects/grass/grass.js
- https://github.com/brunosimon/folio-2025/blob/main/sources/Game/World/Grass.js (WebGPU/TSL, not directly compatible with this WebGL/r162 renderer)
- https://threejs.org/manual/en/shadows.html
- https://threejs.org/manual/en/textures.html
- https://r3f.docs.pmnd.rs/advanced/scaling-performance
