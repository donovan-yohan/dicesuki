# Aurelian Sapphire D20 Edge-Aligned ImageGen Prompt

Mode: built-in Codex ImageGen, image-to-image edit.

Inputs:

1. `d20-imagegen-input.png`: exact edge-aligned edit target.
2. `d20-numbered-mesh-guide.png`: diagnostic base-edge and angle reference only.
3. `antique-gold-blue-enamel-imagegen-v1.png`: visual style reference only.

```text
Use case: precise-object-edit
Asset type: production texture atlas for a Three.js D20 mesh
Input images: Image 1 is the exact corrected edit target and controls all geometry, face values, numeral centers, and numeral rotations. Image 2 is a diagnostic guide showing each selected base edge in thick orange and the exact baseline angle. Image 3 is a visual-style reference only; reuse its antique-gold, blue-enamel, engraved-filigree quality but do not reuse its old upright numeral orientations.
Primary request: Augment Image 1 into a cohesive premium fantasy D20 texture atlas. Transform the pale trim into ornate aged antique-gold metal. Transform the gray-blue panels into deep ultramarine enamel over subtly veined dark stone. Add restrained engraved filigree and small decorative corner flourishes inside each triangular face. Stylize the existing numerals as elegant, high-contrast fantasy calligraphic gold engraving.
Critical orientation rule: Preserve every numeral's exact rotation from Image 1. Each numeral baseline must remain parallel to its triangle's canonical base edge shown in orange in Image 2. Numerals on tilted triangles must tilt by the same degree as that edge. Do not make all numerals upright. Treat each numeral as a rigid glyph group: preserve its baseline angle without skewing or individually rotating digits in multi-digit values.
Composition/framing: Keep the exact square 5-by-4 contact-sheet composition from Image 1.
Materials/textures: physically plausible antique gold, polished blue enamel, dark mineral grain, shallow engraved ornament, fine scratches, and gentle edge wear; even lighting-free albedo-style surface detail suitable for wrapping on a 3D mesh.
Text (verbatim): Preserve exactly one of each existing value: "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20".
Constraints: Preserve all 20 triangle positions, sizes, rotations, and outlines exactly. Preserve every numeral value, center point, scale envelope, and baseline angle from Image 1. Keep all generated art strictly inside its matching triangle. Keep the outside background flat near-black. Maintain generous empty separation between islands. Image 2 only explains winding and baseline relationships; do not copy its labels, dashed lines, vertex IDs, cyan outlines, orange edges, or angle text into the output.
Avoid: upright-all-numerals correction, rotated-away-from-edge numerals, dice product render, perspective, shadows between islands, connected triangles, moved or reshaped islands, wrong numbers, duplicated numbers, missing numbers, extra letters, labels, watermark, signature, art outside triangles.
```

Output: `antique-gold-blue-enamel-imagegen-v2-edge-aligned.png`.
