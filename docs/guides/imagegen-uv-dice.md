# ImageGen and Blender UV authoring

This tooling generates a local, deterministic authoring kit for D4, D6, D8,
D10, D12, and D20. Image generation owns material exploration; the checked-in
contract owns face values, material indexes, mesh triangles, UV corners, and
numeral baselines.

The contract was extracted from the preserved ImageGen work at
`15648ed8e498234a6fe002e5fee617a16a45e9e9` and its main-based reconciliation
at `7393d112c5e062570ec7caf37970206c4d05c08c`. The generated dice, theme
textures, screenshots, prompt archives, and production GLBs from those branches
are deliberately not part of this slice.

## Commands

Generate inspectable SVGs, prompts, and manifests:

```bash
npm run generate:imagegen-uv
npm run validate:imagegen-uv
```

Generate optional raster inputs after Chromium is installed for Playwright:

```bash
npx playwright install chromium
npm run generate:imagegen-uv:raster
```

Generate or validate one shape:

```bash
node scripts/imagegen-uv/generate-authoring-kit.mjs --shape d10
node scripts/imagegen-uv/generate-authoring-kit.mjs --shape d10 --validate-only
```

Run the committed invariants and payload-boundary guard:

```bash
npm run test:imagegen-uv
```

All generated output lands in `.artifacts/imagegen-uv/`. That directory is
ignored and rejected as tracked content. The generator also refuses output
elsewhere in the repository; custom output must stay under `.artifacts/` or
outside the checkout. A marker identifies generator-owned output. Repeated or
single-shape generation safely replaces only a marker-owned tree; a non-empty
unmanaged directory or an unexpected entry is preserved and rejected.

## Output contract

Each shape directory contains:

- `manifest.json`: canonical mesh triangles, per-corner UVs, face values,
  material indexes, and baseline orientation;
- `numbered-guide.svg`: face, material, and baseline reference;
- `imagegen-input.svg`: numbered edit target;
- `mask.svg`: exact paintable islands;
- `prompt.md`: shape-specific preservation constraints;
- optional PNG versions of the three SVGs when `--rasterize` is used.

No command in this slice emits GLBs, production textures, environment packs,
catalog thumbnails, or files beneath `public/dice`.

## What validation proves

`canonical-contract-v2.json` is the current independently frozen reference;
v1 remains unchanged as the extraction baseline. Validation
checks both readable mappings and SHA-256 signatures of the full UV and mesh
contracts. A manifest must preserve:

- the exact value-to-material and value-to-triangle mapping;
- every island polygon, UV corner, and numeral baseline;
- canonical non-subdivided mesh topology;
- one physical face per island;
- for D10, ten values from `0` through `9`, each represented by exactly two
  coplanar triangles sharing one kite island.

The negative tests permute valid D20 UV corners and break a D10 triangle pair.
This is intentional: bounds checks and non-degenerate geometry alone do not
prove that a generated texture still maps to the canonical face.

Reference files are versioned. Do not rewrite an existing reference to make a
drift failure green. An intentional topology or UV change requires the next
contiguous reference file and review of the mapping/digest delta. Validators
select the newest contiguous version dynamically. CI compares published
references to the PR base and fails on edits or deletions while allowing a
newly appended version.

The D10 ring parity, kite ordering, triangle indexes, and value assignment live
in `src/lib/d10GeometryContract.json`, shared by the runtime geometry and this
authoring extractor. That runtime contract is authoritative.

## ImageGen loop

1. Generate the kit and choose a shape.
2. Use `imagegen-input.svg` (or PNG) as the edit target and
   `numbered-guide.svg` as the orientation reference.
3. Preserve every island and value; change only material, trim, ornament, and
   numeral styling.
4. Keep the raw generated art outside `public/` and outside Git history.
5. Validate the canonical manifest before a Blender bake or runtime promotion.

Generated pixels still require visual inspection for legibility, especially
`6`, `9`, `10`, `12`, `20`, and D10 `0`.

## Blender loop

The portable validator works without Blender:

```bash
python3 scripts/imagegen-uv/blender_generate.py \
  --manifest .artifacts/imagegen-uv/d10/manifest.json \
  --validate-only
```

Create an exact mesh and save a local `.blend` with Blender:

```bash
blender --background \
  --python scripts/imagegen-uv/blender_generate.py -- \
  --manifest .artifacts/imagegen-uv/d10/manifest.json \
  --object-name Dicesuki_D10_Canonical \
  --output-blend .artifacts/imagegen-uv/d10/d10-authoring.blend
```

The importer creates canonical triangles, deduplicates shared vertices, assigns
one material slot per canonical material index, writes `dice_face_value` and
`dice_material_index` face attributes, and assigns per-loop UVs. Manifests use
top-left atlas coordinates, so the importer flips V for Blender.

The older `public/artist-resources/templates/generate_dice_templates.py` is a
visual starter, not the canonical UV/face contract. In particular, its D10 is
an approximation and must not be used for production mapping proof.

## Issue #146 promotion status

Cozy Forest and Cyberpunk are promoted by the separate, reproducible runtime
pipeline documented in [runtime-dice-assets.md](runtime-dice-assets.md). Dark
Dungeon still requires the same optimization, delivery, visual proof, and mobile
contrast/normal-map review before issue #146 can close.
