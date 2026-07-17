# Runtime Dice Assets

Issue #146 promotes complete D4/D6/D8/D10/D12/D20 sets from preserved ImageGen
authoring output into bounded, deployable assets. Cozy Forest and Cyberpunk use
the same profile-driven pipeline; Dark Dungeon remains a later promotion slice.
Raw authoring files remain outside the application bundle. Reproducibility locks
live in `scripts/runtime-dice-assets/sources/`; each profile's primary lock records
the source commit and release archive URL and SHA-256. Primary locks and optional
append-only supplements together cover every set, metadata, model, and proof input
hash consumed by the profile. Published locks are immutable; add a new supplement
when historical coverage needs to grow.

## Reproduce the runtime set

Download the locked release archive, verify its SHA-256 before extraction, then
run the optimizer against the extracted root:

```bash
npm ci
sha256sum cozy-forest-imagegen-authoring-v1.tar.gz
sha256sum cyberpunk-imagegen-authoring-v1.tar.gz
npm run build:runtime-dice-assets -- --source /path/to/extracted/archive
npm run build:runtime-dice-assets -- \
  --source /path/to/extracted/cyberpunk-archive \
  --profile cyberpunk-v1
npm run check:runtime-dice-assets
```

`@gltf-transform/cli` is pinned exactly. The pipeline resizes both embedded
textures to at most 1024 px, encodes base color as quality-80 WebP, encodes the
normal map as lossless WebP, preserves directly inspectable canonical geometry,
and creates deterministic 320 px PNG catalog thumbnails from the locked proof
captures. It copies the locked set metadata, replaces authoring-only UV links
with canonical-reference version 2, applies the canonical per-shape scale, writes
files atomically, and emits `runtime-assets.json` with exact hashes and byte
counts. Omitting `--profile` preserves the `cozy-forest-v1` default.

## Enforced budgets

| Surface | Limit |
|---------|-------|
| Catalog thumbnail | 150 KiB per die |
| Runtime GLB target | 1.5 MiB per die |
| Runtime GLB hard maximum | 3 MiB per die |
| Embedded textures | 1 MiB per die |
| Complete six-die set | 10 MiB |

An asset over the target is accepted only with a reviewed issue-linked exception;
the hard maximum cannot be waived. Validation also rejects external textures,
non-WebP embedded images, dimensions over 1024, symlinks, stale hashes, missing
shapes, and meshopt/Draco geometry that would hide the canonical geometry from
the repository validator.

## Runtime delivery

Inventory cards use only `thumbnail.png` with native lazy image loading. They do
not request a GLB or mount the shared WebGL preview for a thumbnail-backed item.
When a bundled die is placed on either a local or remote multiplayer table, its
stable catalog key resolves the immutable GLB and React Suspense requests it on
demand. Loading and request failures display the procedural die rather than
breaking the table.

Vite excludes `/dice/**` from service-worker precache. The existing Workbox
`CacheFirst` runtime route with bounded expiration is the cache primitive; this
slice does not add a second custom LRU implementation.

## Versioning and publication

The catalog snapshot embeds delivery hashes, sizes, thumbnail path, texture
format, texture dimension, and canonical reference version inside the immutable
asset metadata. Edition `0002-cozy-forest.json` / migration
`0006_catalog_cozy_forest.sql` and edition `0003-cyberpunk.json` / migration
`0007_catalog_cyberpunk.sql` each append only their six new rows. They do not
rewrite prior editions, the v1 SQL seed, prior migrations, or published asset
bytes.

Future byte or metadata changes require an asset-version bump. New GLB and
thumbnail bytes belong under `/dice/<set>/<die>/versions/vN/`; never replace a
published path. Prepare a new edition with the next unused migration number and
review its delta before applying it. Repository generation never applies a
hosted Supabase migration.

## Gates

```bash
npm run test:runtime-dice-assets
npm run check:runtime-dice-assets
npm run check:dice-manifest
npm run check:collectible-catalog
npm run test:imagegen-uv
npm test -- --run
npm run lint
npm run build
```
