# Woodland Prototype Evidence

> Historical prototype evidence. Measurements and delivery limits below apply to the snapshots named in each section, not the final themed-worlds release. See [Themed Dice Worlds](../exec-plans/active/themed-dice-worlds.md) and the current PR for composed integration and publication gates. Ignored artifact/scratch receipts remain privately retained, not public evidence links.

## Delivered scope

Sunlit Glade is a free selectable theme in the existing personal and room theme registries. It adds a procedural ground, instanced opaque full-field grass, rocks, mushrooms, ferns, a grain-shaded wood rim, drifting pollen and bounded corner light-shaft quads. Every tier animates grass unless reduced motion is requested. This remains a local art prototype, not a finished forest scene.

The woodland recipe is theme-owned data. One quality resolver chooses geometry counts, DPR and shadow size. Compact or coarse-pointer surfaces cannot select the desktop-high environment budget. Existing themes retain the classic renderer. Room physics, colliders, protocol and catalog assets are unchanged.

The current lighting is HDR IBL plus ambient/directional lights and procedural floor coloration. There is no baked indirect-light texture or real-time global-illumination pass yet. The light shafts are additive geometry, not dynamically occluded volumetrics. No postprocessing framework or Three.js upgrade was added.

## Asset proof

`node scripts/environment-assets/wood-d6.mjs` creates canonical honey-oak D6 authoring output with Blender in a background factory-startup process. Art is analytic/procedural, not ImageGen. The configured image tool was attempted and returned a provider 404 for `gpt-image-2-high`.

Raw proof output is under ignored `.artifacts/theme-workshop/experiments/woodland/`. The `.blend` packs 2048px albedo, tangent normal and roughness sources. GLB uses canonical unit geometry and `metadata.scale = 1.1`, applied once. All six numbered faces are validated against the canonical mesh/UV contract, then rendered face-on with canonical baselines in actual Three.js. The full test also removes the normal map and checks changed rendered pixels.

The geometry is a sharp canonical cube. Numeral carving is normal-map relief, not actual recessed mesh topology. The raw 8.97 MB proof is an authoring asset, not an acceptable production mobile asset. It is never included in the production bundle or immutable catalog.

`node scripts/environment-assets/wood-d6-variants.mjs` now derives two validated
WebP GLBs without modifying the raw proof. Mobile has three 512px maps and is
230,396 bytes; desktop has three 1024px maps and is 1,060,380 bytes. Geometry,
indices, normals and UV attributes are unchanged. Lossless normal/roughness
pixels match the resized intermediates. Both variants render in GLTFLoader and
pass normal/roughness pixel-difference checks. The development table chooses
mobile for low/mid dice tiers and desktop for high.

## Executed checks

- Baseline at `f3ce6cf56ed5d74dad7cf8dc9d043970cab25a0a`: build/lint passed; 168 unit files and 2,176 tests passed with Node 26 Web Storage disabled.
- Integrated first pass: `npm run lint` and `npm run build` passed. Existing large-bundle warning remains.
- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=2 --testTimeout=15000`: 173 files and 2,206 tests passed. Earlier high-concurrency runs hit runner startup and unrelated UI-test timeouts under host load; these are recorded, not hidden by retries in configuration.
- Live browser theme switching, compact high-tier cap, desktop resizing and reduced-motion changes passed.
- Actual GLB requested successfully on desktop-high, mobile-mid and mobile-low viewport proofs. All three rendered without page/console errors.
- Actual pointer drag selected the wood D6 and changed its room-authoritative position. Roll sequence advanced. View rotation retained the woodland scene.
- Intentionally rejecting the GLB produced the expected loader error but retained procedural dice, playable scene and roll operation.
- `WOOD_D6_E2E=1 node --test scripts/environment-assets/wood-d6.node-test.mjs`: 3 passed, none skipped.
- `node --test scripts/environment-assets/wood-d6-variants.node-test.mjs`: 3 passed, none skipped. Repeat optimization receipts/hashes match.
- Authoring boundary passed. Dev-served GLB and metadata were read back byte-identical to generated files. Production chunks contain no wood-proof URL; production preview responds to that path with SPA HTML, not artifact bytes.

### Review-fix verification

Both blocking review findings are fixed. Live shadow changes now dispose/reset
the actual target and optional blur target before the next frame. The fixed
artifact route validates every ancestor and the opened regular-file descriptor,
including inode/realpath checks; it streams only that descriptor.

- Final full unit gate: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=2 --testTimeout=15000` passed **174 files / 2,240 tests**.
- Final lint, production build, authoring boundary and `git diff --check` passed.
- `PLAYWRIGHT_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e:woodland -- --workers=1` passed **2 tests**. The tests query actual GPU depth-renderbuffer dimensions through the live R3F root: 512px on compact/low and 2048px on desktop-high, including repeated classic/woodland transitions on the same light. DPR was 1/1.5/2 as requested. Shader time remained frozen while rendered frame count advanced, then resumed after reduced motion was cleared.
- Artifact middleware has **30 HTTP-backed tests**, including ancestor symlinks, leaf races, directories/FIFOs, traversal, HEAD, stream errors and descriptor cleanup.
- All four allowlisted dev endpoints were fetched again and compared byte-for-byte with their local files. No experiment URL remains in the production JavaScript.

The final read-only re-review accepted the shadow, artifact security and
variant-selection fixes. It found one remaining benchmark-only gap: a context
lost after some valid draws could leave positive aggregate work and pass.
The sampler now listens for loss and checks the live context every sample
frame. `node --test scripts/environment-performance-sampling.node-test.mjs`
passes a real Chrome regression that draws a triangle, loses its context
partway through sampling, and verifies rejection. A healthy rendering sample
is accepted first. No later independent review is claimed for this small fix.

## Performance evidence and limits

The benchmark uses twenty D6 plus the automatically seeded D20, twenty-one dice total, and three four-second samples for idle and rolling modes. WebGL draw calls include shadow passes. RAF cadence is not GPU timing.

Desktop Chrome on Apple M5 Max rendered both baseline and candidate. The host was heavily loaded; runs were not interleaved and frame cadence varied enough that the FPS comparison cannot establish regression or parity. A mobile-sized desktop viewport is not a mobile GPU. Candidate compact DPR is 1.5 versus baseline 2, so reduced pixel sharpness is an explicit budget tradeoff.

The physical Pixel 10 Pro connected and produced RAF samples, but those samples had a null WebGL renderer and zero draws. Its screenshot showed a blank canvas. Those results are invalid and must not be used to claim near-60 FPS. The benchmark now fails closed on missing/lost context, zero draw work or page errors. The phone disconnected before the render failure could be diagnosed. Physical mobile parity and sustained thermal behavior remain unverified.

Initial measurements predate the reviewed live shadow-target fix and are
retained as exploratory evidence only. A post-fix production run at
`performance/woodland-final-guarded.json` verifies a live non-lost renderer,
twenty-one basic dice, positive draw work and no page errors. Its cadence still
varies heavily under host load, so it does not establish performance parity.

## Reference implementations

- [Three.js Journey scene baking](https://threejs-journey.com/lessons/baking-and-exporting-the-scene) saves static rendered lighting into a texture and covers geometry/UV preparation. This is the next art-pipeline step, not something the current prototype already does.
- [Bruno Simon 2019 materials](https://github.com/brunosimon/folio-2019/blob/540f13573a6da282eae942a4c67335b97cd18970/src/javascript/World/Materials.js) use matcaps, indirect-color uniforms and separate floor-shadow materials. A rich appearance does not imply real-time GI.
- [Bruno Simon 2025 grass](https://github.com/brunosimon/folio-2025/blob/main/sources/Game/World/Grass.js) uses batched triangle blades and wind. It targets WebGPU/TSL, not this project's r162 WebGL path.
- [Al-ro grass source](https://github.com/al-ro/al-ro.github.io/blob/master/projects/grass/grass.js) uses instanced blades, shader animation and a lower mobile blade budget. Demo counts are not transferable performance guarantees.
- [R3F scaling guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) covers instancing, demand rendering and adaptive quality. Demand rendering needs explicit snapshot/drag/wind invalidation and was not changed in this slice.

## Meadow correction

The initial rectangular perimeter grass and repeating sine undercoat were
rejected by the user. The target is a Genshin-inspired painterly meadow with
visible wind throughout the box, not a grass-trimmed tray or a quiet carpet.
The old unit test actually enforced the empty center; it has been replaced.

Grass is now seeded across the whole floor, with a separate random stream from
props. Tapered, curved seven-triangle ribbons replace single triangles. The
lit material receives dice shadows, corrects normals for the wind shear and
keeps roots pinned. Shared world-space gusts replace independent blade phases.
The floor uses smooth hash-based value noise rather than repeating sine bands.
Resting leaf directions, lengths and green/yellow-green tones vary. The final
art adjustment uses taller, thinner leaves instead of broad short rug fibers.

Budgets changed from perimeter counts to 2,500 / 6,000 / 12,000 blades. This is
17,500 / 42,000 / 84,000 grass triangles in one grass draw. DPR/shadow caps did
not increase. These are cost bounds, not mobile performance acceptance.

`node scripts/capture-meadow-proof.mjs` first failed on the predecessor with
zero central blades and four empty occupancy bins. The replacement has about
25% of blades in the central quarter and all 4x4 occupancy bins populated.
With particles hidden, changing only the actual grass shader time changes
central pixels on every tier. The proof compiles real WebGL shaders and fails
on page/console errors or a lost context.

`MEADOW_VIDEO=1 node scripts/capture-meadow-proof.mjs` generates
`.artifacts/theme-workshop/experiments/woodland/meadow/meadow-wind.mp4` and
desktop/mobile/low screenshots. The clip contains 120 frames at explicit
shader times, encoded at 30 fps. It demonstrates appearance and motion, not
the machine's real-time frame rate. The top-down view still produces a dense
surface and does not establish Genshin art parity; visual acceptance stays
with the user.

The revised combined gate passes 174 files / 2,247 tests, the two integrated
GPU/reduced-motion browser tests, lint and production build. The encoded motion
study is 1280x900, 120 frames and four seconds. No physical mobile result was
added by this revision.

The focused independent meadow review found no blocking logic or security
defects. It checked ribbon topology, deformation normals, shadow coordinates,
root distribution, allocations, reduced motion and drag pass-through against
the saved predecessor. Its remaining suggestions are numerical normal-math
regression coverage and further aesthetic work. This is code acceptance,
not Genshin-style visual acceptance or mobile performance qualification.

## Patch density and contact response

The density/contact revision was rejected visually by the user. Its quadrant-
alternating ellipse clearings read as four spaced holes, while periodic wind
read as an optical illusion rather than natural movement. The recorded unit
and contact gates below do not establish art acceptance. A fixed 48x48
cumulative density field redistributes the same blade
budget; generation is bounded and the distribution never rebuilds per frame.
Fine-cell tests require empty and dense areas while coarse bins still require
growth across the box. The first real theme capture had 19 empty fine cells
and dense/sparse counts of 144/28; these are placement checks, not art scores.

A 64x64 RGBA data texture carries signed bend and compression. CPU float state
recovers exponentially, with bytes uploaded only when changed. Contact work
is capped at 128 map entries and 12 local stamps per contact. Canonical mesh
support and interpolated rotation estimate the visual bottom/footprint; this
is not extra collision physics. Airborne dice do not stamp, stale contact
history is released, discontinuities do not draw bridging trails and removed
contacts recover naturally. The resource owns texture disposal.

Dice and grass share one interpolation ref, updated before their visual frame
callbacks. Ambient wind obeys reduced motion; functional contact response is
retained. Grass roots do not move, and neither room physics nor dice results
are affected.

The controlled renderer proof hides the die and particles, fixes wind time,
and reads canvas pixels synchronously after rendering. An earlier screenshot
probe sampled asynchronous React/render changes and falsely appeared not to
recover despite zero texture pressure; that receipt is not used. The fixed
proof changed 8,783 grass-only pixels under pressure and returned exactly to
baseline after recovery, with no page/console errors. Incoming worker events
are paused only in this disposable controlled-snapshot page.

`reaction/dice-grass-response.mp4` is a five-second manually stepped visual
study; it is not a real roll or a performance measurement. `reaction/actual-roll.mp4`
separately records four real room dice rolling without store injection, with
no page errors. The integrated E2E presses Roll through the UI, observes actual
pressure, clears the table and waits for pressure to reach zero.

Final local gates for this slice passed 176 files / 2,276 unit tests, all three
woodland browser tests, lint, build and authoring boundary. Physical mobile
performance and thermal acceptance remain open. Focused independent review
passed with no blocking logic or security findings. It verified bounded work,
shared interpolation, all seven shape contact/recovery paths, deformation
normals, discontinuity handling and disposal. Two nonblocking follow-ups remain:
reuse the pressure sample explicitly between normal/position shader code, and
apply synchronous canvas capture to the older wind-only proof as already done
for the reaction proof. Both follow-ups were completed in the subsequent
noise-density tuft revision: capture reads synchronously after each draw,
and shader main explicitly shares the contact sample between both paths.

### Noise-density tuft candidate

The replacement removes quadrant ellipses, biased rest yaw and travelling
two-sine fronts. Grass uses three-triangle opaque ribbons in small tufts,
world-space domain-warped density, bounded thinning, baked palette/yaw and
Lambert diffuse lighting with actual dice-shadow reception. A seamless 64x64
RG field is advected along a prevailing breeze. One wind and one contact
lookup in shader main are reused by position and normal deformation. Ground
color samples a static bake of the same density/palette field.

Actual renderer captures in `noise-tufts/` compile on all three quality tiers
with no page/console errors. Runtime captures produced 4,803 / 2,448 / 1,003
leaves for desktop high / compact mid / low, with five vertices and three
triangles per leaf. These vary with authoritative arena bounds; the quality
counts are caps, not exact populations. The four-second wind clip uses 120
explicit shader-time frames at 30 fps and synchronous canvas readback. It is
appearance evidence only. No actors, motes or contact pressure can fake its
grass motion.

The new controlled contact proof changes 1,513 grass-only pixels and returns
exactly to baseline after recovery. The standard fork-pool full suite passed
2,286 tests across 177 files before review repairs. The vmThreads full run was
not a clean gate and is not used. Independent review found two defects: a
partial candidate row left an unsampled edge rectangle, and RGFormat textures
were incompatible with the app's retained WebGL1 fallback. Both defects were
reproduced with failing tests before repair. The final row now spans the full
width and both data textures use RGBA8 storage with the data in RG.

Post-repair, 57 focused unit tests, all three woodland browser tests, lint and
build pass. A separate actual WebGL1 context renders 10 draws / 4,223 triangles
with GL error zero and no page/console errors. The controlled grass response
still recovers exactly. Focused independent review closed both repairs and
verified seven roots in the formerly excluded rectangle, in-bounds placement,
correct texture bytes and once-only disposal. The repaired full suite passed
2,287 tests across 177 files, with zero failures or skips. `noise-tufts-fixed/`
holds refreshed all-tier motion captures; sparse
ground still reads flat and no aesthetic acceptance is claimed.

The frozen pre-repair GPU profile used six real 21-dice roll windows, no
recording and fully drained timer queries. Desktop high measured whole-render
GPU medians of 0.934 / 0.841 / 0.813 ms; compact mid 0.453 / 0.328 / 0.383 ms.
Grass triangles were 14,283 / 6,897 rather than the rejected 84,000 / 42,000.
This is M5 Max dev/headless evidence under shared-host load, not physical-mobile
qualification or a stable FPS speedup. The receipt explicitly predates the two
small repairs and is not relabeled as their performance evidence.

The density no longer has four arranged holes, but sparse ground still reads
flat and the dense region remains visually busy. This candidate is not marked
as aesthetic acceptance or mobile performance parity.

### Ground integration pass

The next local pass addresses the flat green undercoat without adding geometry,
draws, textures or per-frame uploads. The existing ground texture retains broad
palette in R and density in G; B now stores bounded soft occlusion stamps at
actual static grass roots. These are root occlusion, not simulated moving blade
shadows. The ground shader blends muted earth/olive in sparse areas into short
grass color under denser growth. No alpha cards, post-process or extra render
pass was added. Grass placement, wind, interaction and physics are unchanged.

The root-occlusion test failed before implementation and passes afterward. The
final source passes 2,288 tests across 177 files, all three woodland browser
tests, lint, production build and authoring-boundary checks. Real WebGL1 renders
10 draws / 4,223 triangles with zero GL/page/console errors. Controlled contact
changes 1,586 grass-only pixels and returns exactly to baseline on recovery.
`root-ground-final/` contains final three-tier captures, a source manifest and
the four-second fixed-time wind study. It is appearance evidence, not a real-
time FPS measurement. The earlier GPU measurements are not relabeled for this
source revision.

The exposed ground is now olive/earth toned rather than plain green; dense
foliage remains visually busy. Neither Genshin/BOTW aesthetic parity nor mobile
performance parity is established. The physical phone remains connected but
dozing on its lock/notification surface; no unlock or authentication interaction
was attempted. Physical comparative/thermal testing remains blocked on access.

### Shared-host frame-delivery investigation

The rejected renderer and classic were profiled without recording, with real
worker-room rolls and verified nonzero Metal draw work. Both stalled. An
independent frozen release/classic check reproduced the common problem:
one die delivered 25.41 GL-bearing RAF callbacks per second and 21 dice 11.02;
live dev delivered 13.03 and 8.10 respectively. These short sequential samples
on a loaded shared host are diagnostic, not hardware benchmarks or speedup
ratios. Callback medians stayed 0.6–1.8 ms while delivery gaps were much longer.

The release trace's three longest tasks consumed 349.313 ms wall time but only
5.122 ms renderer-thread CPU time. This establishes off-CPU inflation; it does
not distinguish scheduler contention from native blocking or identify an
unrelated host process as the cause. No unrelated work was stopped. React dev
adds observable debug work but is not the sole cause. A scheduler trace or
quiet-host repetition is still required for attribution. Receipts are under
the privately retained scratch path `grass-perf/release-diagnosis/` and the rejected GPU-cost
receipts under the ignored woodland `performance/rejected-meadow/` directory.

## Next acceptance boundaries

1. Shadow allocation and artifact security findings are fixed and regression-tested. Retain final read-only review evidence with any promotion proposal.
2. Compressed desktop/mobile variants are delivered. Evaluate 512px detail on a live mobile renderer before promotion; retain the source proof separately.
3. Restore a live physical-device render, then interleave baseline/candidate runs with matched dice and resolution. Include a sustained thermal run and a second mobile GPU class.
4. Art pass for irregular clearing edges, roots/logs/tree framing, natural grain and stronger canopy-light composition. Bake static indirect light without baking moving dice or double-counting direct sunlight.
5. Only after visual and device acceptance, prepare separately reviewed immutable catalog/source promotion. No release or deployment is authorized by this prototype.
