# Daisu D6 ImageGen Prompt Pack

Clean template: `assets/d6-uv-clean-template.svg`
Labeled guide: `assets/d6-uv-template.svg`
Mask: `assets/d6-uv-mask.svg`
Manifest: `assets/d6-uv-manifest.json`

## Material-Only Prompt

Use the attached clean Daisu D6 UV template as a strict layout guide. Generate a single square 2048x2048 texture atlas for polished obsidian stone with subtle veins, worn silver inlay, physically plausible roughness. Preserve every UV island position, size, rotation, and outline exactly. Fill only the paintable island areas, including the cyan bleed. Keep the background transparent or very dark outside the islands. Do not add numbers, letters, labels, borders, signatures, watermarks, or decorative frames. Keep the gold safe-zone centers clean enough for deterministic numerals to be composited later. The texture should wrap believably on faceted dice with consistent lighting-free material detail.

## Numbered Atlas Prompt (Experimental)

Use the attached clean Daisu D6 UV template as a strict layout guide and the labeled guide only for face mapping. Generate a finished dice texture atlas for polished obsidian stone with subtle veins, worn silver inlay, physically plausible roughness. Preserve every UV island position, size, rotation, and outline exactly. Put each face value inside its matching gold safe zone, centered and upright relative to that island. Use engraved or embossed numerals with high contrast, no extra symbols, and no copied guide labels. Hard cases must be legible at mobile size. Keep all art inside the cyan bleed areas.

Face mapping:

- face 1: material index 3
- face 2: material index 4
- face 3: material index 0
- face 4: material index 1
- face 5: material index 5
- face 6: material index 2

## Negative Prompt

wrong numbers, missing numbers, duplicated numbers, moved UV islands, resized UV islands, rotated UV islands, labels, watermark, signature, decorative border outside islands, checkerboard background, text outside safe zones, cropped islands, seams through numerals

## QA Notes

- Start with the material-only prompt; deterministic numbers are safer than asking ImageGen to place all values correctly.
- Check the generated atlas against the manifest before using it in runtime or Blender.
- For engraved or embossed numbers, use this atlas as the albedo/style pass and bake normals from modeled/vector numerals in Blender later.
