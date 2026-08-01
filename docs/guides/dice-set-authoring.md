# Dice Set Authoring (ImageGen UV Workshop)

End-to-end recipe for minting a complete themed polyhedral dice set (d4–d20) and
promoting it into the runtime bundle.

Exactly one step is manual: the **ImageGen albedo art pass**. Everything before
and after it is scripted and deterministic.

> **Provenance.** This pipeline was archived at commit `7393d112` (branch
> `codex/imagegen-uv-dice-reconcile`, release tags `imagegen-*-authoring-v1`) and
> resurrected onto `main`. Two things changed: the canonical numbered edit
> targets now come from `generate-authoring-kit.mjs` (canonical-contract-v2), and
> every authoring artifact is written under `.artifacts/` instead of `public/`,
> because `scripts/imagegen-uv/check-authoring-boundary.mjs` rejects binary
> authoring payloads anywhere git can see them.

---

## The pipeline at a glance

| # | Step | Command | Output |
|---|------|---------|--------|
| 1 | Generate the kit | `npm run generate:theme-workshop` | numbered edit targets, manifests, prompts |
| 2 | **Art pass (manual)** | Codex ImageGen, by hand | `*-imagegen-atlas-raw.png` per shape |
| 3 | Register atlases | `npm run register:theme-atlases` | island-snapped, edge-bled `*-imagegen-atlas.png` |
| 4 | Derive normal maps | `npm run generate:theme-normal-maps` | `*-normal.png` |
| 5 | Bake GLBs | `npm run bake:theme-dice-sets` | `source-root/public/dice/<setId>/…` |
| 6 | Capture proofs | `npm run capture:theme-proofs` | 720px proof render per die |
| 7 | Release + lock | manual `tar` + `gh release` + lock file | checksum-locked archive |
| 8 | Promote to runtime | `npm run build:runtime-dice-assets` | `public/dice/<setId>/` |
| 9 | Catalog edition | `npm run prepare:collectible-edition` | catalog + migration |

All of steps 1–6 accept `--theme <id>` to work on a single set, and `--out <dir>`
to redirect the workshop root (handy for smoke runs).

---

## Where things live

```
.artifacts/theme-workshop/            # gitignored; never deployed
  INDEX.md
  templates/<shape>/                  # theme-agnostic canonical kit
    manifest.json                     # THE spatial contract (canonical-contract-v2)
    imagegen-input.png/.svg           # numbered edit target  -> ImageGen image 1
    numbered-guide.png/.svg           # baseline reference    -> ImageGen image 2
    mask.png/.svg                     # paintable island mask
    prompt.md                         # shape-level canonical prompt
  <themeId>/
    README.md                         # per-set art-pass checklist
    environment/imagegen-prompts.md   # floor / wall / skybox prompts
    <shape>/
      <themeId>-<shape>-prompt.md          # theme-specific ImageGen prompt
      <themeId>-<shape>-imagegen-atlas-raw.png   # <- YOU SAVE THIS (step 2)
      <themeId>-<shape>-imagegen-atlas.png       # generated (step 3)
      <themeId>-<shape>-normal.png               # generated (step 4)
    source-root/                      # generated (steps 5-6); shaped like a repo
      public/dice/<setId>/{set.json,<diceId>/{model.glb,metadata.json}}
      public/artist-resources/imagegen-uv/screenshots/theme-workshop/*.png
```

`source-root/` is deliberately laid out like a repository checkout so it can be
tarred as the release archive and handed straight to
`scripts/runtime-dice-assets/optimize.mjs --source`.

Set definitions (names, prompts, materials, physics) live in one place:
[`scripts/imagegen-uv/theme-workshop-data.mjs`](../../scripts/imagegen-uv/theme-workshop-data.mjs).

---

## Step 1 — Generate the authoring kit

```bash
npm run generate:theme-workshop                       # all themes
node scripts/imagegen-uv/generate-theme-workshop.mjs --theme fantasy-earth --rasterize
```

This is idempotent and safe to re-run — it only writes generated prompts and the
canonical template kit, and never touches art you have dropped in.

Verify at any time:

```bash
npm run validate:theme-workshop
```

## Step 2 — Art pass (MANUAL — this is the PO's step)

> This is the only step that is not automated. Do not let tooling fabricate
> these images: the whole set's visual identity comes out of this pass.

For **each** of the six shapes `d4 d6 d8 d10 d12 d20`:

1. **Open the prompt.**
   `.artifacts/theme-workshop/<themeId>/<shape>/<themeId>-<shape>-prompt.md`
   Paste its body into Codex ImageGen in **style-transfer / image-to-image** mode.

2. **Attach exactly two images, in this order.**
   - Image 1: `.artifacts/theme-workshop/templates/<shape>/imagegen-input.png`
     — the numbered edit target. This is the spatial contract.
   - Image 2: `.artifacts/theme-workshop/templates/<shape>/numbered-guide.png`
     — shows each island's canonical baseline edge in orange.

   Any further images are style references only.

3. **Preserve, in the output:**
   - every island's position, size, outline, and rotation — do not move,
     resize, or re-pack islands;
   - exactly one of each face value (`d10` uses **0–9**, not 1–10);
   - each numeral on its original island, at its original rotation, with its
     baseline parallel to that island's orange edge — **do not rotate all
     numerals upright**;
   - generous bleed out to each island edge;
   - a near-black, quiet background outside the islands;
   - lighting-free material detail (this becomes a PBR base-color map — no
     baked highlights or cast shadows).

   For `d10` specifically: there are ten **kite** islands. Each kite is one
   physical face built from two coplanar triangles sharing that island. Never
   split a kite into two separate designs.

4. **Save the result** — 2048×2048 PNG — as exactly:

   ```
   .artifacts/theme-workshop/<themeId>/<shape>/<themeId>-<shape>-imagegen-atlas-raw.png
   ```

   The filename is load-bearing: steps 3–5 look for that exact name. Keep the
   `-raw` file forever; it is the re-registerable original.

5. *(Optional)* Repeat for the three environment textures described in
   `.artifacts/theme-workshop/<themeId>/environment/imagegen-prompts.md`, saving
   `floor-albedo.png`, `wall-albedo.png`, and `skybox-equirectangular.png` into
   that `environment/` directory. The matching normal maps are derived for you
   in step 4 — do not author them by hand.

**Common failure modes to reject and re-roll:** a missing or duplicated value; a
value replaced by a rune or symbol; all numerals rotated upright; islands nudged
or rescaled; art bleeding across the gaps between islands; a rendered/photographed
die instead of a flat atlas; a visible watermark or signature.

### Fantasy set (`fantasy-earth`) — the currently pending art pass

| Shape | Dice id | Display name | Proof face |
|---|---|---|---|
| D4  | `runeleaf-d4`      | Runeleaf D4      | 4  |
| D6  | `oathstone-d6`     | Oathstone D6     | 6  |
| D8  | `greenwarden-d8`   | Greenwarden D8   | 8  |
| D10 | `sunspire-d10`     | Sunspire D10     | 9  |
| D12 | `emerald-crown-d12`| Emerald Crown D12| 12 |
| D20 | `aurelian-d20`     | Aurelian D20     | 20 |

Set id `fantasy-earth-imagegen-set`, bound to the shipped `fantasy-earth` theme.
Direction: antique gilded heartwood and burnished-gold trim around deep emerald
and moss-green enamel panels, engraved oath-rune borders, oak-leaf and laurel
filigree, parchment patina in the recesses, tall raised antique-gold
Trajan-style numerals. Earthy and reverent — not glossy, cartoony, or neon.

## Step 3 — Register the atlases

```bash
npm run register:theme-atlases -- --theme fantasy-earth
```

ImageGen returns art that is visually on-template but drifts a few pixels per
island. Registration re-projects each island's painted region onto the exact
polygon in `manifest.json` and bleeds it past every edge, so UVs baked from the
manifest land on the right pixels and seams stay clean at runtime.

`d20` additionally runs a hard coverage check: every UV vertex, edge midpoint,
and just-outside-the-edge sample must be painted, or the step fails. A failure
here means the art moved an island — re-roll that shape rather than overriding.

## Step 4 — Derive normal maps

```bash
npm run generate:theme-normal-maps -- --theme fantasy-earth
```

Dice atlases use the `ornament` profile at `material.normalScale * 11`, which is
the relationship the three released sets were built with — the same
`normalScale` goes onto the GLB material, so relief and lighting stay
proportional across themes. Environment textures use the tileable `surface`
profile.

## Step 5 — Bake the GLBs

```bash
npm run bake:theme-dice-sets -- --theme fantasy-earth
```

Emits `model.glb` (albedo + normal embedded as PNG), `metadata.json` (face
normals, rarity, physics, collider), and `set.json` into
`.artifacts/theme-workshop/<themeId>/source-root/`. The bake refuses an
incomplete set unless you pass `--allow-partial`.

## Step 6 — Capture proof renders

```bash
npm run capture:theme-proofs -- --theme fantasy-earth
```

Renders each baked GLB at 720×720 in headless Chromium with the proof face
square to the camera and its numeral rolled upright. These are both the
review artifact and the source `capture-thumbnails.mjs` crops into the 320px
runtime thumbnails, so check them before releasing.

## Step 7 — Release archive + lock

Runtime promotion consumes a **checksum-locked release archive**, not a local
directory, so that `public/dice/**` is reproducible from an immutable source.

```bash
cd .artifacts/theme-workshop/fantasy-earth/source-root
tar czf ../fantasy-earth-imagegen-authoring-v1.tar.gz public
sha256sum ../fantasy-earth-imagegen-authoring-v1.tar.gz
gh release create imagegen-fantasy-earth-authoring-v1 \
  ../fantasy-earth-imagegen-authoring-v1.tar.gz --notes "Fantasy Earth authoring sources"
```

Then add `scripts/runtime-dice-assets/sources/fantasy-earth-v1.lock.json`
following the shape of `cozy-forest-v1.lock.json`: `sourceCommit`, the release
`{tag, assetName, url, bytes, sha256}`, and a `files[]` entry with a `sha256`
for every `model.glb` and proof PNG. Register a matching profile in
`scripts/runtime-dice-assets/runtime-asset-profiles.mjs` with the six
`{diceId, diceType, proofFace, scale}` rows.

> Lock files and published `runtime-assets.json` manifests are **immutable
> history** — `npm run check:immutable-imagegen-history` fails any edit. Append
> a new version or supplement instead.

## Step 8 — Promote into the runtime bundle

```bash
curl -L -o /tmp/set.tar.gz "<release url>" && sha256sum /tmp/set.tar.gz   # must match the lock
mkdir -p /tmp/set && tar xzf /tmp/set.tar.gz -C /tmp/set
node scripts/runtime-dice-assets/optimize.mjs --source /tmp/set --profile fantasy-earth-v1
npm run check:runtime-dice-assets
```

`optimize.mjs` verifies every locked hash, resizes textures to 1024px, re-encodes
base color as WebP q80 and normals as lossless WebP, crops thumbnails, and writes
`public/dice/<setId>/runtime-assets.json`. It refuses to run if any source hash
drifts.

## Step 9 — Catalog edition

Finally register the dice as collectibles:

```bash
npm run prepare:collectible-edition
npm run build   # runs catalog, economy, runtime-asset, and manifest checks
```

---

## Gates

```bash
npm run test:imagegen-uv                    # contract + workshop unit tests + authoring boundary
npm run validate:theme-workshop             # generated kit matches its source of truth
npm run check:runtime-dice-assets           # runtime manifests match bytes on disk
npm run check:immutable-imagegen-history    # locks/manifests/fixtures unchanged
```

## Adding another theme

Append an entry to `THEME_WORKSHOP` in
[`theme-workshop-data.mjs`](../../scripts/imagegen-uv/theme-workshop-data.mjs)
with a unique `setId`, six unique dice ids ending in `-<shape>`, a material
prompt, `material`/`physics` blocks, and three environment prompts. The unit
tests enforce all of that. Then run the pipeline from step 1.
