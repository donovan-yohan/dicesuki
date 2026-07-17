# ImageGen UV Dice Assets

This folder contains generated UV guide assets for AI-assisted dice texture experiments.

Run from the repo root:

```bash
npm run generate:imagegen-uv
npm run generate:continuous-uv
npm run generate:imagegen-d20-normal
npm run test:imagegen-uv
```

Use the generated `INDEX.md` to find each shape's clean template, labeled guide, mask, manifest, and prompt pack.

`d20-imagegen/` is the canonical numbered image-to-image proof. Unlike the older uniform contact sheet, its triangle rotations are projected from the real Three.js Icosahedron vertices into the same face-on basis used by the preview harness. Each numeral baseline is parallel to the island edge closest to horizontal, with the lower edge winning exact ties. The folder contains the numbered diagnostic guide, exact ImageGen edit target, generated albedo, derived normal map, face/vertex UV manifest, and exact built-in ImageGen prompts.

Material-only generation remains the safest general workflow. The D20 proof also demonstrates a numbered edit workflow: code creates the legal numbered template and Codex ImageGen augments its trim, enamel, ornament, and numeral styling. The generated albedo is the only visible number layer in `fantasy-set/aurelian-imagegen-d20`; face truth and UV winding remain deterministic and are checked in tests and wrapped captures.

`continuous/` contains a D6 cube-cross proof with a height map and generated normal map for raised trim and embossed numerals.

`concepts/` contains ImageGen style explorations. These are references, not legal production UV sheets.

See `docs/guides/imagegen-uv-dice.md` for the complete workflow.
