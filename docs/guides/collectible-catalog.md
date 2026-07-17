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

## Catalog changes

Catalog and asset rows reject `UPDATE` and `DELETE`. Add a new contract or asset
version instead. The generated seed is bracketed in the migration and sourced
from `supabase/catalog/collectible_catalog_v1.sql`; detailed configured and
production metadata should remain machine-generated from the canonical config
and sidecars rather than hand-copied into SQL.

Normal clients receive SELECT privileges only. `service_role` is the trusted
future grant/revoke authority and must never ship to the browser. Future paid or
randomized systems must perform their transaction server-side and write an
entitlement before the client treats value as owned.

## Verification

Run the static schema/policy guard:

```bash
npm run test -- --run supabase/migrations/0004_collectible_catalog.test.ts
```

The guard asserts foreign keys and checks, immutable triggers, forced RLS,
SELECT-only policies/privileges, the fixed starter function, idempotent backfill,
and the absence of inventory-derived grants. The repo does not currently include
a Supabase CLI configuration, pgTAP, or a local Postgres migration harness, so
this test does not execute policies as `anon`, `authenticated`, and
`service_role`. Applying the migration and exercising those roles against the
target Supabase project remains required deployment evidence.
