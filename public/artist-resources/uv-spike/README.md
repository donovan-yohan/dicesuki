# UV/full-AI dice texture spike (#31)

This artifact evaluates whether full AI-rendered dice texture atlases can carry both material art and face numerals for D6/D20 dice in Dicesuki.

## Deliverables

- `assets/d6-uv-template.svg` — canonical D6 cube-cross source template.
- `assets/d20-uv-template.svg` — D20 triangular island source template matching current D20 face/material group order.
- `assets/attempt-01-d6-cranberry.png` — full-AI D6 texture attempt.
- `assets/attempt-02-d20-teal.png` — full-AI D20 texture attempt.
- `assets/attempt-03-combined-amethyst.png` — full-AI combined D6/D20 texture attempt.
- `assets/prompt-settings.json` — model, prompt, and evaluation notes for each attempt.
- `wrapped-evidence.html` — browser-rendered canvas that projects generated atlas crops onto faux D6/D20 facets for wrap/readability evidence.
- `evidence/wrapped-evidence-browser.png` — captured Chromium screenshot of the wrapped evidence page.

## Template rules

### D6 canonical orientation

Dicesuki maps D6 faces in `src/lib/geometries.ts` as:

| Value | Direction | Net position in template |
|---|---|---|
| 1 | bottom `-Y` | below front |
| 2 | front `+Z` | center |
| 3 | right `+X` | right of front |
| 4 | left `-X` | left of front |
| 5 | back `-Z` | below bottom |
| 6 | top `+Y` | above front |

Opposite faces sum to 7. Numerals must stay inside the gold safe zone; material should continue into the cyan bleed; decorative seams must not invade the safe zone.

### D20 current seam

The current renderer treats a D20 as one triangle per material group with full `[0,1]` per-face UVs. That means this spike is testing per-face decals, not a connected continuous icosahedron unwrap. The D20 template labels both value and face index so implementation can keep face-value order separate from material-array order.

## Attempt verdicts

1. **D6 cranberry** — readable and visually attractive, but wrong canonical face placement. Production fail for value correctness.
2. **D20 teal** — best legibility, including 6/9/10/12/20, but still independent triangle decals with no reliable connected seam logic. Production fail for UV adjacency; useful style reference.
3. **Combined amethyst** — cohesive material direction, but repeats the structural failures: D6 face placement mismatch, D20 not a real connected unwrap, and ornamental border wastes atlas space.

## Recommendation

Use a **hybrid pipeline**:

1. Let AI generate material-only resin/glass/metal texture fields, color variation, inclusions, and broad ornament mood.
2. Place numerals, orientation arrows, face labels, safe zones, and any seam-critical marks deterministically using SVG/canvas/Blender-authored UV templates.
3. Treat full-AI numerals as exploration only until a reviewer verifies wrapped evidence for every face and hard case.

Full-AI atlases are not reliable enough for production because they can make beautiful sheets while silently breaking face placement, adjacency, transparency, and seam-safe numbering. Material-only AI plus deterministic numbers is the safe next step.

## QA checklist for future texture work

- Verify D6 canonical placement before any visual polish.
- Verify D20 value-to-face-index order independently from visual row order.
- Check wrapped evidence, not only flat sheets.
- Hard cases: `6`, `9`, `10`, `12`, `20`, and percentile-style `00` if D10/D100 enters scope.
- Mobile readability: numerals must survive 128px/256px texture LOD, perspective tilt, and motion blur.
- Avoid baked checkerboard backgrounds and decorative borders outside usable islands.

Refs #31 and #30.
