# Sculpted collectible promotion

The existing v1 ImageGen validator assumes exactly two WebP textures, a 3 MiB model maximum, and a 10 MiB complete set. Reusing that shape would require fake textures, stripping animation, or relaxing historical guarantees. The new v2 sculpted contract shares only SHA-256, thumbnail inspection and canonical public paths. Its own fixed profiles bound bytes, geometry, materials, images, dimensions and clips. The existing validate command dispatches by explicit contract version; unknown versions remain rejected.

## Reproduce locally

Run from the repository root with installed lockfile dependencies. No install, network access, secret or environment file is needed. `--source` is the experiment root containing `woodland/`, `shipping-assets/` and the frozen parent consumption note. The source record lists 271 exact relative inputs. Their hashes bind the accepted mapping receipts, all 180 face images, selected heroes and metadata to the same 18 selected GLBs.

```sh
node scripts/runtime-dice-assets/package-sculpted.mjs \
  --source /path/to/.artifacts/theme-workshop/experiments
npm run check:runtime-dice-assets
TMPDIR=/path/to/owned/scratch \
  SCULPTED_SOURCE_ROOT=/path/to/.artifacts/theme-workshop/experiments \
  npm run test:runtime-dice-assets
npm run check:collectible-catalog
npm run check:production-economy
```

Use `--out /path/to/disposable/repo-root` to reproduce without writing this checkout. The output is exactly `public/dice/{woodland-sculpted-set,cyberpunk-cutline-set,monster-dungeon-set}/`. Each set contains `set.json`, `runtime-assets.json`, and six `d4`, `d6`, `d8`, `d10`, `d12`, `d20` directories with `model.glb`, `metadata.json`, `thumbnail.png`. Regeneration is byte-identical and refuses different existing output bytes. A failed source hash check writes nothing.

The same checked hero renders produce 320 × 320 PNG thumbnails through installed sharp 0.34.5. They are honest crops of accepted renders, not new face or gameplay proofs. Woodland thumbnails retain the source grade rather than claiming that the renderer-owned D8 palette correction is baked into the GLB.

## Accepted local output

| Set | Complete package bytes | Fixed complete-set ceiling |
| --- | ---: | ---: |
| Woodland Sculpted | 13,145,003 | 14 MiB |
| Cyberpunk CUTLINE | 638,338 | 1.5 MiB |
| Monster Dungeon | 18,147,472 | 18 MiB |

Complete package counts include all models, thumbnails, metadata, set metadata and runtime manifest. Per-shape model and triangle caps are fixed in `sculpted-asset-profiles.mjs`. These ceilings account for the actual selected payloads plus bounded thumbnails, not an unbounded exception. Constant-material models have zero image bytes and `textureFormat: none`. Woodland D20 retains its original 2048px PNGs. The animated Zabi D6 retains ten embedded WebPs and all 22 clips. No dummy texture, meshopt or Draco requirement is introduced.

Catalog edition `0007-sculpted-worlds.json` and generated migration `0036_catalog_sculpted_worlds.sql` append 18 items and 18 asset versions. The existing generator produces the compiled catalog. Prior editions, models, manifests, inventories and version identities are unchanged. This edition does not alter production banner membership or grant any personal ownership.

## Provenance and qualification

`sources/sculpted-worlds-v1.source.json` is an honest local-frozen record, not a published archive lock. It has no invented tag, URL or source commit. Both it and runtime manifests become immutable through the existing history gate after acceptance. A public source archive and its later publication remain a separate release gate. Preserve the relative paths when archiving the checked inputs.

The twelve CUTLINE/Dungeon deployed GLBs are byte-identical to the selected inputs. The six Woodland public GLBs are explicit metadata-only successors, not the original accepted file bytes. The original public Zabi GLB is untouched. Dungeon D10 retains its exported transmission 0.8 and IOR. Portable CUTLINE remains the opaque graphic counterpart of the selected cel study, not the separate physical chrome/resin study. Dungeon procedural micrograin and gel volume absorption are not baked. Sculpted protrusions do not change canonical physics colliders. Physical-device, thermal and final composed-app roll acceptance belong to the parent integration gate.

## Public Woodland metadata derivation

`sculpted-public-model.mjs` defines the versioned `woodland-scene-authoring-extras-v1` transform. It removes only existing scene-extras keys `type_source_scene`, `selected_source_scene`, `inset_base_scene`, `inset_recovered_source`, `canonical_export_metadata`, and `source_hashes`; no other JSON semantics change. JSON is deterministically serialized and four-byte space padded; the complete original BIN chunk, header and padding are copied unchanged. These extras contained private absolute authoring coordinates, including serialized JSON object keys.

Each Woodland runtime asset declares `publicDerivation` with the transform kind, original `sourceSha256` and derived `publicSha256`. The shared helper pins both identities, the public JSON graph digest, preserved BIN digest and exact removed pointers. Packaging recomputes the bounded deletion from hash-checked original bytes; public validation requires the exact successor, known declaration, original source identity and no remaining private absolute paths. Unknown/missing transforms and source/payload drift fail closed. The original 271-input source record and its hash remain unchanged in **all three** manifests; this is not a restamp of the selected source hashes. Original bytes remain in the separately retained authoring packet, not the public runtime directory. This derivation does not publish that archive or waive `publicationRequiredBeforeRelease`.

## Validation scope

Data shape: a local-frozen source record contains relative source paths and exact hashes for all 18 GLBs, their metadata, mapping receipts, every face proof and selected hero. Each v2 runtime manifest names its profile and source-record hash, six shape IDs, canonical metadata, and independently inspected model/thumbnail records. The packager verifies all input hashes and complete mapping/face evidence before writing any output. It writes only the three new public set directories, no themes, renderer or inventory state.

Blocking prerequisites are source selection and proof/hash discovery. Renderer work is independent and owned elsewhere. Catalog preparation follows all three packages and uses the current migration counter, discovered late. One catalog generator remains the sole catalog writer. Availability is always, outside banners, and does not grant ownership. No release, production database, purchase or entitlement write is part of this task.

Woodland retains the exact anime-grade geometry, materials, animation graph and BIN payloads, including geometry AO and the bark PNG. D8's approved #24352f numeral palette belongs to the renderer. The D6 1.45 presentation-size study is not a gameplay scale; all packaged dice use baked world size with metadata scale 1. Local budgets are not physical-device/frame-time qualification. Publication of a reproducible source archive remains a separate parent release gate.
