# Collectible Catalog and Entitlements

Issue #145 establishes the ownership boundary needed before wallet, gacha, or
checkout work. It is intentionally additive: the existing local inventory still
drives gameplay, while normalized Supabase tables define what future economic
code may trust.

## Trust boundary

| Data | Authority | Normal client access |
|------|-----------|----------------------|
| Catalog item identity, version, set, die type, rarity | Supabase `catalog_items` | Public read only |
| Asset version, locator, metadata snapshot, integrity hashes | Supabase `catalog_asset_versions` | Public read only |
| Per-item ownership, grant provenance/reference, revocation | Supabase `user_entitlements` | Read own rows only |
| Local dice/tray instance ids and saved-roll slot assignments | Client inventory | Read/write |
| Dice name, notes, tags, favorite/lock state, stats and recent rolls | Client inventory | Read/write |
| Client appearance/VFX copies, acquisition labels and custom/dev flags | Client inventory | Read/write and untrusted |
| Placeholder coins/gems/tokens in the legacy inventory blob | Client inventory | Read/write and non-monetary |
| Custom dice metadata and IndexedDB model bytes | Client/device | Read/write, local-only |
| Saved rolls, durable settings, and editable profile fields | Existing user-data/profile tables | Existing own-row policies |

A local inventory die may map to a catalog key so the UI can resolve canonical
display/render data. That mapping is descriptive, not authorization. A local
instance id or claimed `setId`, rarity, source, asset id, or currency balance
never proves ownership.

## Starter migration boundary

`0004_collectible_catalog.sql` grants ownership of 8 fixed catalog items:

* adventurer d4, d8, d10, d12, and d20
* steel and rubber materials-lab d20s
* production Devil d6

Existing authenticated users receive the same fixed allowlist. Future signed-in
users may call `ensure_starter_entitlements()`; it takes no arguments, derives
the user from `auth.uid()`, and inserts atomically with per-user/item conflict
handling. It cannot grant arbitrary users or catalog items, and repeated or
future duplicate rewards cannot create a second ownership row for an item. The
migration does not inspect the
client-writable `inventory` JSON, so custom/dev dice and legacy valuable-looking
rows receive no entitlement.

Guest and offline players continue to receive and use local starter dice without
an account. The existing starter tray remains 23 independent local instances,
including repeated dice backed by those 8 owned catalog items. Local instance
counts and catalog refs describe play/render state; neither is ownership proof.

## Append-only catalog editions

Catalog history is a sequence of immutable edition manifests under
`supabase/catalog/editions/`. Edition 1 is the frozen baseline represented by
`supabase/catalog/collectible_catalog_v1.sql` and migration `0004`. Later
editions contain only newly appended item and asset rows. They do not repeat or
rewrite the baseline, so a release adds a small delta migration instead of
regenerating one increasingly large migration.

The snapshot-level `contractVersion` remains `1`; it is the schema version of
the generated JSON envelope. Each item's numeric `contractVersion` is separate
and advances independently for its stable `catalogKey`. Runtime lookups compare
numbers explicitly, so contract 10 wins over contract 2 regardless of JSON or
database row order. Asset selection follows the same numeric rule.

Use this workflow for any catalog change:

1. Update the canonical catalog config or production sidecar. Keep global
   defaults at version 1 and use the scoped version override for the affected
   catalog key or set. Metadata-only changes still require an asset bump;
   identity/meaning changes require a contract bump.
2. When GLB bytes change, add the file at a new immutable path such as
   `/dice/<set>/<die>/versions/v2/model.glb`. Never replace bytes at a published
   URL. The path's `vN` must match the new asset version.
3. Prepare exactly one new edition and migration:

   ```bash
   npm run prepare:collectible-edition -- <next-migration-number> <edition-slug>
   ```

   This writes a new edition manifest, a delta-only migration, and the compiled
   runtime snapshot. It refuses gaps, removals, rewritten ids or payloads,
   mismatched hashes, reused mutable GLB paths, and empty editions.
4. Review the manifest and migration. They must contain only new rows. Do not
   edit an older edition or squash catalog history into a replacement seed.
5. Verify the frozen history and compiled snapshot before merging:

   ```bash
   npm run check:collectible-catalog
   npm run check:immutable-catalog-history -- origin/main
   npm run test -- --run scripts/catalog-edition-planner.test.ts src/lib/collectibleCatalog.test.ts
   ```

   Pull-request CI runs the immutable-history check against the target branch.
   Files already present there may not change together; only a new edition and
   its new migration can be appended.

6. Apply migrations in numeric order. Reapplying identical rows is a no-op; an
   existing id with different data is routed through the immutable-row guard
   and fails instead of silently accepting drift.

The edition contract enforces these invariants:

* editions and per-key contract/asset versions are contiguous positive
  PostgreSQL integers;
* item ids are `<catalog-key>@<contract-version>` and every item starts with an
  asset version 1;
* asset ids are `<item-id>/asset@<asset-version>`;
* metadata hashes are recomputed from canonical JSON, and GLB model hashes use
  canonical lowercase SHA-256;
* published item rows, asset rows, manifests, migrations, hashes, and model URLs
  are never changed or deleted.

Catalog and asset tables also reject `UPDATE` and `DELETE`. Detailed configured
and production metadata remains machine-generated from canonical config and
sidecars rather than hand-copied into SQL.

Normal clients receive SELECT privileges only. `service_role` is the trusted
future grant/revoke authority: it may insert grants and update only
`revoked_at`, and it must never ship to the browser. Future paid or randomized
systems must perform their transaction server-side and write an entitlement
before the client treats value as owned.

This workflow is not a mutable product CMS, a deletion mechanism, or an excuse
to mint a new identity for every cosmetic correction. It does not automatically
deploy migrations or grant entitlements. Historical compaction and migration
squashing are deliberately out of scope because deployed ids may remain in
entitlements and saved local references indefinitely.

## Verification

Run the static schema/policy guard:

```bash
npm run test -- --run supabase/migrations/0004_collectible_catalog.test.ts
```

The guard asserts foreign keys and checks, immutable triggers, forced RLS,
SELECT-only policies/privileges, the fixed starter function, idempotent backfill,
and the absence of inventory-derived grants. The repo does not currently include
a committed Supabase CLI configuration, pgTAP suite, or local Postgres migration
harness, so this static test does not execute policies as `anon`,
`authenticated`, and `service_role`. Applying the migration and exercising those
roles against the target Supabase project remains required deployment evidence.
