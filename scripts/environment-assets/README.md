# Procedural wood D6 proof (dev-only)

Run from the repository root:

```sh
node scripts/environment-assets/wood-d6.mjs
# Fast input-contract tests:
node --test scripts/environment-assets/wood-d6.node-test.mjs
# Full Blender export, Cycles render, GLTFLoader six-face captures and validation:
WOOD_D6_E2E=1 node --test scripts/environment-assets/wood-d6.node-test.mjs
# Derive and prove mobile512/desktop1024 runtime-sized WebP GLBs:
node scripts/environment-assets/wood-d6-variants.mjs
node --test scripts/environment-assets/wood-d6-variants.node-test.mjs
```

Requires installed `sharp`, `three`, `playwright`, Blender and Google Chrome.
Defaults use `/Applications/Blender.app/Contents/MacOS/Blender` and
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS; override
with `WOOD_D6_BLENDER` and `WOOD_D6_CHROME`. No browser download is needed.
Blender always runs `--background --factory-startup`, not against an open user
session. All generated files stay in the ignored woodland experiment tree.
No catalog, source lock, runtime asset manifest, public directory or release is
written. This is explicitly **procedural art, not ImageGen**.

The raw GLB is authoring evidence. `wood-d6-variants.mjs` reuses the installed
gltf-transform CLI to resize maps, encode base color as q80 WebP and retain
lossless normal/roughness data. It validates unchanged canonical geometry and
renders both variants with GLTFLoader. The live local proof selects mobile for
low/mid dice tiers and desktop for high. Outputs are `variants/mobile.glb`,
`variants/desktop.glb`, `variant-receipt.json` and `variant-proof.png`.

## Outputs

Under `.artifacts/theme-workshop/experiments/woodland/`:

- `wood-d6.blend`: packed 2048px maps, isolated proof stage and camera.
- `wood-d6.glb`: only the canonical die mesh; albedo, tangent normal and
  metallic/roughness-packed texture embedded. No external texture dependencies.
- `wood-d6.metadata.json`: `DiceMetadata`-compatible configuration.
- `wood-albedo.png`, `wood-normal.png`, `wood-roughness.png`: 2048×2048 sources.
- `blender-hero.png`, `three-hero.png`, `faces/face-{1..6}.png`,
  `all-faces-contact-sheet.png`: actual Blender/Three.js renders.
- `provenance.json`, `blender-receipt.json`, `runtime-receipt.json`, `blender.log`:
  source hash, file sizes, map dimensions, bounds, material evidence and checks.
- `kit/d6/`: canonical manifest, numbered guide, mask, SVG and Chrome PNG targets.
- `proof.html`: the generated browser harness; URL requests are fulfilled by the
  runner from local files, so this is evidence source rather than a standalone
  double-clickable file.

The unchanged canonical generator `scripts/imagegen-uv/blender_generate.py`
creates the mesh. The standard kit generator's `--rasterize` expects downloaded
Playwright Chromium; this runner instead creates the exact canonical SVG kit
and rasterizes it with installed Chrome, then runs its raster validation.

## Geometry and scale contract

**GLB unit edge = 1; metadata.scale = 1.1. Apply that scale exactly once.**
Three runtime validation checks both unit bounds `[-0.5,+0.5]` and scaled world
bounds `[-0.55,+0.55]` against the Rust D6 body's 0.55 half-extents.

The imported manifest already uses Three.js Y-up coordinates. Blender exports
with `export_yup=False`; do not add a Blender Z-up→Y-up rotation. The validator
reads the exported GLB's node transforms and matches all 12 scene-space triangles
and their UV corners back to the manifest, including outward winding. Mapping:

| Value | Normal |
|---|---|
| 1 | `[0,-1,0]` |
| 2 | `[0,0,1]` |
| 3 | `[1,0,0]` |
| 4 | `[-1,0,0]` |
| 5 | `[0,0,-1]` |
| 6 | `[0,1,0]` |

The canonical body remains a sharp 8-vertex/12-triangle cube. Carved digits and
wood pores are shading-only tangent normal relief, not displacement or bevel
geometry. The browser also disables the normal map and checks that actual
rendered pixel values change. The six-face captures use canonical numeral
baselines, so they are the legibility/orientation review surface; a random hero
angle can make a 6 appear inverted.

## Dev-only loading

The parent-owned fixed Vite allowlist serves:

- `/__experiments/woodland/wood-d6.glb`
- `/__experiments/woodland/wood-d6.metadata.json`
- `/__experiments/woodland/variants/mobile.glb`
- `/__experiments/woodland/variants/desktop.glb`

For `useGltfDiceLoader`, pass:

```ts
const asset: GltfDiceAsset = {
  id: 'dev-only/woodland-d6',
  modelUrl: '/__experiments/woodland/wood-d6.glb',
  metadata, // fetched wood-d6.metadata.json
}
const { scene } = useGltfDiceLoader(asset, { useDraco: false })
// The hook does not apply metadata.scale. Rendering composition must do so once:
return scene ? <primitive object={scene} scale={metadata.scale} /> : null
```

For direct `GLTFLoader`, load that GLB and set `gltf.scene.scale.setScalar(1.1)`
once. Do not change shared/cached scene transforms for other instances; clone
before scaling when appropriate. Production catalog promotion is intentionally
out of scope.
