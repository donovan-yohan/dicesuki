# Aurelian Sapphire D20 ImageGen Prompt

Mode: built-in Codex ImageGen, image-to-image edit.

Inputs:

1. `d20-imagegen-input.png`: exact edit target.
2. `d20-numbered-mesh-guide.png`: diagnostic reference only.

```text
Use case: precise-object-edit
Asset type: production texture atlas for a Three.js D20 mesh
Input images: Image 1 is the exact edit target; Image 2 is a diagnostic reference only and must not appear in the result.
Primary request: Augment Image 1 into a cohesive premium fantasy D20 texture atlas. Transform the flat pale trim into ornate aged antique-gold metal. Transform the flat gray-blue panels into deep ultramarine enamel over subtly veined dark stone. Add restrained engraved filigree and tiny decorative corner flourishes inside each triangular face. Stylize the existing numerals as elegant high-contrast fantasy calligraphic engraving with a hand-crafted metal-inlay character.
Composition/framing: Keep the exact square contact-sheet composition from Image 1.
Materials/textures: physically plausible antique gold, polished blue enamel, dark mineral grain, shallow engraved ornament, fine scratches and gentle edge wear; even lighting-free albedo-style surface detail suitable for wrapping on a 3D mesh.
Text (verbatim): Preserve exactly one of each existing value: "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20".
Constraints: Preserve all 20 triangle positions, sizes, rotations, and outlines exactly. Preserve every numeral's value, center point, scale envelope, and upright page orientation exactly; numerals must stay horizontal/upright even when their triangle is rotated. Keep all generated art strictly inside its matching triangle. Keep the outside background flat near-black. Maintain generous empty separation between islands. Image 2 only explains vertex winding and face mapping; do not copy its arrows, labels, dashed lines, vertex IDs, or cyan/orange guide colors.
Avoid: dice product render, perspective, shadows between islands, connected triangles, moved or reshaped islands, rotated numerals, wrong numbers, duplicate numbers, missing numbers, extra letters, runic characters mistaken for numbers, labels, watermark, signature, art outside triangles.
```

Output: `antique-gold-blue-enamel-imagegen-v1.png`.

The generated output contains exactly one visible value for each face from 1 through 20. Runtime correctness is still determined by `d20-mesh-uv-manifest.json` and the wrapped face-reader checks.
