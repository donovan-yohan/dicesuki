# ImageGen UV Dice Workflow

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for AI-assisted dice texture workflow guidance.

## Goal

Use deterministic dice UV templates as the control surface for AI-generated dice materials. The intended split is:

- **Codex ImageGen** explores the surface design: enamel panels, marble/cloudy resin, metal trim, ornament, scratches, color direction, and material mood.
- **Deterministic code** owns dice legality: UV layout, face IDs, exact face values, safe zones, masks, height maps, normal maps, and validation.
- **Blender** remains the high-fidelity path for true modeled bevels, engraved/embossed numerals, and baked production GLBs.

The workflow is atlas-first and now has both generic and wrapped-runtime paths:

1. Generate guide and mask SVGs for each dice shape.
2. Use the prompt pack with ImageGen to create material-only texture ideas.
3. Review the generated art against the manifest.
4. Map promising art through the canonical manifest into Three.js or an embedded-texture GLB.

This avoids relying on ImageGen to invent face order, UV placement, or number alignment. ImageGen augments a deterministic numbered edit target instead.

## Commands

```bash
npm run generate:imagegen-uv
npm run generate:continuous-uv
npm run generate:imagegen-d20-normal
npm run generate:theme-workshop
npm run register:theme-atlases
npm run generate:theme-normal-maps
npm run generate:theme-dice-sets
npm run test:imagegen-uv
npm run capture:imagegen-d20
npm run capture:theme-workshop
```

Generated files land in `public/artist-resources/imagegen-uv/`:

- `assets/<shape>-uv-clean-template.svg`: no-text ImageGen input template.
- `assets/<shape>-uv-template.svg`: labeled guide with bleed, safe zones, face values, and material indexes.
- `assets/<shape>-uv-mask.svg`: black/white paintable island mask.
- `assets/<shape>-uv-manifest.json`: inspectable face value, material index, points, safe points, and UV boxes.
- `<shape>-prompt-pack.md`: material-only and experimental numbered prompts.
- `INDEX.md`: generated shape index.

Canonical numbered D20 proof files land in `public/artist-resources/imagegen-uv/d20-imagegen/`:

- `d20-numbered-mesh-guide.svg` and `.png`: real mesh triangle winding, vertex IDs, selected base edges, baseline angles, face values, and material indexes.
- `d20-imagegen-input.svg` and `.png`: the clean numbered raster sent to built-in Codex ImageGen.
- `d20-mesh-uv-manifest.json`: exact triangle vertex-to-atlas UV mapping.
- `antique-gold-blue-enamel-imagegen-v2-edge-aligned.png`: project-bound ImageGen albedo with each numeral parallel to its canonical base edge.
- `antique-gold-blue-enamel-normal-v2-edge-aligned.png`: registered relief normal map derived from the generated gold trim, ornament, and numerals.
- `d20-imagegen-edge-aligned-prompt.md`: exact prompt and input roles for the current atlas.

Continuous UV proof files land in `public/artist-resources/imagegen-uv/continuous/`:

- `d6-continuous-clean.svg`: connected cube-cross input sheet for ImageGen.
- `d6-continuous-guide.svg`: labeled cube-cross guide.
- `d6-continuous-height.svg` and `.png`: deterministic relief map for trim and numerals.
- `d6-continuous-normal.png`: tangent-style normal map derived from the height map.

ImageGen concept references land in `public/artist-resources/imagegen-uv/concepts/`.

## Three-Theme Workshop

The production proof under `public/artist-resources/imagegen-uv/theme-sets/` covers Cozy Forest, Dark Dungeon, and Cyberpunk Box. Each theme has a complete D4, D6, D8, D10, D12, and D20 atlas plus the exact ImageGen prompt and derived tangent-space normal map. The matching environment albedo, normal, and equirectangular skybox assets live under `public/textures/themes/`.

Run the workshop in this order:

1. `npm run generate:theme-workshop` creates the geometry-derived numbered edit targets and manifests.
2. Edit each numbered PNG with Codex ImageGen. Preserve every island, value, and orientation; save the unregistered result with the `-raw.png` suffix.
3. `npm run register:theme-atlases` snaps ImageGen's small island-level shifts back onto the exact manifest polygons and adds controlled bleed.
4. `npm run generate:theme-normal-maps` derives relief normals from the registered dice albedos and tileable environment surfaces.
5. `npm run generate:theme-dice-sets` embeds albedo, normals, UVs, and face-reader metadata in the runtime GLBs and refreshes `public/dice/manifest.json`.
6. `npm run test:imagegen-uv` validates topology, face values, UV contracts, and D10 coplanarity.
7. `npm run capture:theme-workshop` captures the real inventory dice in the normal app and six face-reader proof views per theme.

The raw ImageGen result is deliberately retained beside the registered runtime atlas. Registration is deterministic placement correction; it does not replace the generated ornament, script, trim, or material design.

D20 registration uses connected-component isolation per grid cell and an orientation-preserving affine triangle transform. This prevents bright pixels from neighboring cells from expanding the source crop and producing black wedges on the wrapped model. Validation samples every mesh UV vertex, edge midpoint, and bleed point for all twenty faces.

Environment textures use `tileSize` in theme tokens to define world units per square texture tile. Runtime repeat counts are derived from each visible surface's actual axes: width/depth for floors and ceilings, width/height for front and back walls, and depth/height for side walls. Albedo and normal maps receive the same repeat, so changing viewport or arena dimensions reveals more tiles instead of stretching them.

## Shape Coverage

The generator covers D4, D6, D8, D10, D12, and D20. Face values and material indexes mirror `src/lib/faceMaterialMapping.ts`, including the D10 `0-9` face range.

The generalized workshop derives a canonical baseline from one real edge of every physical face. The numeral rotation is exactly parallel to that edge, so a tilted triangular, pentagonal, or kite island receives an equally tilted number. For D10, each physical kite is represented by two coplanar mesh triangles that share an apex-to-ring edge; the manifest groups those triangles into one UV island and one value.

## Recommended ImageGen Loop

Start with the material-only prompt. Ask ImageGen for stone, metal, glass, resin, bone, enamel, or other material fields while preserving every UV island. Keep numerals out of the first production pass.

For the ornate dice direction, use ImageGen to explore raised antique-gold or silver trim, enamel inset panels, cloudy resin or marble material fields, fine scratches, worn metal edges, corner flourishes, and small motifs.

Do not assume an ImageGen numbered sheet is legal. The current D20 proof preserved exactly `1` through `20`, but promotion still requires manifest validation, hard-value inspection, wrapped screenshots, and expected/reported face-reader checks.

After a promising material atlas exists, choose one of two number paths:

- For a numbered image-to-image atlas, begin with the canonical numbered mesh template and keep the generated albedo as the visible number layer.
- For the existing per-face renderer, crop or adapt each island into per-face texture inputs and composite deterministic numerals.
- For the Blender path, use the atlas as base color/style reference, model or vector-place numerals, then bake normal/ambient occlusion maps for engraved or embossed depth.
- For the deterministic relief path, generate a height map from trim/numeral masks and convert it into a normal map.

The numbered prompt is included for exploration only. It should not be treated as production-ready until every face value and hard case (`6`, `9`, `10`, `12`, `20`, and D10 `0`) is inspected on a wrapped model.

## Native Three.js Path

The app already creates per-face `CanvasTexture` materials through `useDiceMaterials`, `textureRendering`, `geometryTexturing`, and `faceMaterialMapping`. That means native Three.js can carry the workflow without Blender for early experiments:

1. Generate an ImageGen material atlas from the clean template.
2. Slice or adapt island art into face textures.
3. Let the existing per-face material mapping place values on the correct geometry groups.

`fantasy-set/aurelian-imagegen-d20/model.glb` is the first native runtime proof. The three workshop sets extend that path to every standard polyhedral shape. Each GLB embeds the generated albedo and derived normal map; no procedural font or separate number mesh is present.

## Continuous UV Path

Continuous sheets are better for the premium dice direction because trim, bevels, and material flow can cross face boundaries. The D6 continuous proof uses the canonical cube-cross order:

```text
      [6]
[4] - [2] - [3]
      [1]
      [5]
```

This path should become the preferred ImageGen input when we care about shared gold edges, connected panels, and dice that look manufactured rather than pasted together. The per-face atlas remains useful for face-order verification and isolated texture tests.

## Height And Normal Maps

Raised trim and embossed/engraved numerals can be represented as deterministic height maps:

- black/background: no geometry,
- dark panels: recessed enamel,
- gray body: base face height,
- white trim/numerals: raised relief.

`npm run generate:continuous-uv` converts the D6 height map into `d6-continuous-normal.png`. `npm run generate:imagegen-d20-normal` derives raised trim, filigree, and numeral relief from the generated D20 albedo and embeds it in the proof GLB. Blender remains preferable when the relief must change silhouette or become printable geometry.

## Blender Path

Use Blender when the texture should become a production GLB or needs baked detail:

1. Generate mathematically controlled mesh geometry and UVs.
2. Import the material atlas as base color.
3. Add numerals as curves or mesh inlays on each face.
4. Bake normal, roughness, and ambient occlusion maps.
5. Export GLB with embedded textures and metadata for the Artist Testing Platform.

Blender is not required for the generated UV prompt loop, but it is the right next step for engraved, embossed, or physically baked dice.

## QA Checklist

- The atlas has exactly one island per face value.
- The manifest material indexes match `faceMaterialMapping.ts`.
- No generated art crosses outside UV islands.
- Numerals, if present, stay inside safe zones.
- Every numeral baseline remains parallel to its manifest-selected face edge.
- Every D10 kite contains exactly two coplanar triangles and one value from `0-9`.
- Hard values are readable after downscaling.
- Wrapped evidence is checked before promoting an atlas into runtime or GLB assets.
- The real inventory dice settle and roll against the normal app's explicit tray colliders.
