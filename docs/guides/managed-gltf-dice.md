# Managed GLB Dice Assets

Customers cannot upload or retain local dice models. Dice are authored by
operators, promoted through the [Dice Set Authoring](dice-set-authoring.md)
pipeline, and released as immutable catalog assets through the
[Collectible Catalog](collectible-catalog.md) workflow.

Runtime GLB paths are versioned bundled catalog delivery paths, never
customer-supplied URLs. `useGltfDiceLoader()` and `GltfDiceAsset` are the shared
renderer contract for these managed catalog assets.

Inventory persistence is version 6. Its migration removes every former
`custom-artist` row and every custom asset without `storage: 'bundled'`, then
prunes assignments to the removed ids. A versioned startup cleanup deletes the
retired `DicesukiCustomDiceDB` database; no model CRUD remains. Migration `0035`
locks each affected inventory and saved-roll row, applies the same destructive
cleanup to historical `public.inventory.data`, and rewrites saved-roll sources
that pinned removed ids as anonymous one-die sources. The migration is
idempotent. There is no recovery path for those customer-authored records or
IndexedDB model bytes.

Roll this out client-first: deploy inventory v6, allow cached/service-worker v5
clients to turn over, then apply migration `0035`. An old client that remains
active can upload legacy JSON again after the database cleanup; row locks protect
the migration's read/compute/write transaction, but cannot prevent a later write
from obsolete code. After the old-client cutoff, rerun the read-only preflight
and the idempotent cleanup if any legacy rows reappeared. Reconcile the hosted
migration ledger before `supabase db push`; never repair remote-only versions
blindly.

When changing catalog GLB delivery, run the focused inventory/catalog tests,
`npm run test:db:supabase`, `npm run lint`, and `npm run build`.
