# Slice 17 — Non-die SKU registry (phase c slice 1, spec §6 delta 7, dormant)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c,
branch `econ/17-sku-registry` (off main, migrations through 0025 merged).
Phase c = the #154 sandbox rail, PO-authorized, sandbox-first: everything
lands DORMANT behind the existing gates; no live monetization activates.

Read FIRST: spec docs/exec-plans/active/2026-07-22-monetization-economy-spec.md
§2 (PO-locked bundle lineup: handful..hoard, $0.49/2.49/7.49/14.99/24.99/49.99,
raw 60/300/980/1980/3280/6480, bonus to totals 60/330/1090/2240/3880/8080,
first-time = double-raw REPLACING the bonus), §3.1 (Lunar SKU $2.99/mo), §6
deltas 5-7; 0013_paid_checkout_foundation.sql (payment_orders +
catalog_items FK — the constraint this slice loosens: orders currently FK
dice only), supabase/functions/_shared/catalog.ts (code-only SKU price map —
the thing this registry supersedes), 0024 (lunar product id constant +
invoice contract comments), 0022 (data-table + versioning idiom).

## Task
`supabase/migrations/0026_sku_registry.sql` + colocated `.test.ts` +
behavioral `supabase/tests/0026_sku_registry.test.sql`.

1. **`store_skus` registry**: one row per purchasable SKU. Columns per the
   spec's needs: sku_id (text PK, e.g. 'stars_handful'..'stars_hoard',
   'lunar_pass_monthly'), sku_class ('star_bundle'|'subscription'|'die' —
   allowlist), price_usd_cents integer, star_raw/star_bonus/star_total
   (star_bundle rows; NULL otherwise — NULL-safe all-or-none constraints per
   the 0018/0019 lesson), first_time_total (star_bundle: double-raw),
   product_id (subscription rows: 'lunar-pass', matching 0024's constant),
   catalog_item_id FK nullable (die rows only), status
   ('draft'|'sandbox'|'live') default 'draft', versioning/updated discipline
   per the 0022 dice_economy_values idiom (service-only writes, equality/
   version triggers as applicable).
   Seed the SIX star bundles + the Lunar SKU with spec-exact numbers,
   status='sandbox' (dormant: nothing reads them yet), plus constraints:
   star_total = star_raw + star_bonus; first_time_total = star_raw * 2;
   price > 0; subscription rows carry product_id and no star fields;
   die-class rows carry catalog_item_id and no star fields.
2. **payment_orders binding (delta 7)**: additive migration path letting
   orders reference a store_skus row instead of only catalog_items —
   nullable sku_id FK + a CHECK that exactly one of (catalog_item_id,
   sku_id) is set (NULL-safe), leaving every existing row and the existing
   die-purchase path byte-identical in behavior. NO fulfill changes (delta
   5/6 = next slice); the new column is dormant.
3. **Read surface**: public read of live+sandbox SKUs? NO — service +
   authenticated read of rows with status IN ('sandbox','live') via RLS
   (clients render the shop from server truth, not the code-only price map;
   the edge create-checkout will validate against this table in the next
   slice). Draft rows service-only.
4. **Behavioral suite**: seed integrity (six bundles + lunar exactly as
   spec — assert every number), constraint matrix (mismatched totals,
   first_time != raw*2, class/field pairings, both-or-neither order binding,
   NULL-hole probes), RLS (authenticated sees sandbox+live only, cannot
   write), existing die-order path untouched (insert an old-style order
   row → still valid), service retune versioning discipline.

## Boundaries
Only the three new 0026 files. No edge-function changes, no fulfill changes,
no client. No commits, no docker — orchestrator runs the harness. Run:
`npm test -- 0026`, `npm test -- supabase/migrations` (paste exact lines).

## Report
`SLICE-17-REPORT.md` at worktree root: summary, files+lines, seed table
echoed with spec citations, test output, risks, provenance (EXACT model id +
effort from runtime config).
