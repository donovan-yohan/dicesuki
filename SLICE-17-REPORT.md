# Slice 17 Report — Non-die SKU registry (revision 2)

## Summary

Implemented the dormant Slice 17 registry and payment-order binding without
activating monetization:

- `public.store_skus` contains the six locked Star bundles, the monthly Lunar
  Pass, and the schema needed for future die SKUs.
- A closed, NULL-safe `sku_class` field matrix makes Star bundles own all Star
  fields, subscriptions own `product_id`, and die rows own `catalog_item_id`.
- Star arithmetic is enforced in SQL:
  `star_total = star_raw + star_bonus` and
  `first_time_total = star_raw * 2`.
- Economic or fulfillment-binding retunes require exactly the next
  `value_version`; status-only governance changes keep the version, and every
  accepted update receives a server timestamp.
- Authenticated users can read only `sandbox` and `live` rows. Anonymous users
  cannot read the registry, authenticated users cannot write it, and the
  service role can read drafts and insert/update rows.
- `payment_orders` has a nullable `sku_id` FK and requires exactly one of
  `catalog_item_id` or `sku_id`. Non-die checkout and fulfillment remain
  dormant.

Revision 2 closes both items in `SLICE-17-FIX-TASK.md`:

1. `sku_class` is separately immutable. The update trigger uses
   `IS DISTINCT FROM` and raises SQLSTATE `55000`; the behavioral suite performs
   a valid-shape service-role reclassification attempt and requires that exact
   failure.
2. The post-0026 behavioral suite calls the real five-argument
   `public.create_payment_order(...)` service boundary for a die order. It uses
   `INTO STRICT`, requires returned `sku_id IS NULL`, checks exactly one product
   binding, and verifies exactly one persisted order.

## Review and fix history

One adversarial review found no P0/P1 issue and two P2 closure findings:

- behavioral source-contract assertions read raw SQL, so commented-out probes
  could satisfy the Vitest gate;
- the report had stale line maps/evidence and incorrectly claimed a focused
  re-review had already completed.

Both findings were handled in one batched fix pass. The TypeScript contract now
removes block and line comments, isolates executable `service_role` blocks, and
asserts the RPC and reclassification control flow rather than relying only on
diagnostic strings. This revision refreshes the report from the final files and
final requested gate runs.

A focused re-review of these changed hunks then mutation-tested both behavioral
blocks and found no remaining P0/P1/P2 issue. No further review was warranted.

## Files and current line map

- `supabase/migrations/0026_sku_registry.sql` — 216 lines
  - lines 16–80: registry columns and NULL-safe class/arithmetic constraints
  - lines 88–107: seven exact dormant sandbox seeds
  - lines 109–169: immutable identity/class guards, sequential payload
    versioning, server-owned `updated_at`, trigger, and function grants
  - lines 179–198: alternate payment-order FK, exactly-one binding, index, and
    dormant-boundary comment
  - lines 200–216: forced RLS, authenticated read policy, and service grants
- `supabase/migrations/0026_sku_registry.test.ts` — 233 lines
  - lines 14–54: comment-stripped behavioral source and executable role-block
    extraction
  - lines 56–139: schema, seed, arithmetic, and immutable retune contracts
  - lines 141–172: exact real-RPC and returned/persisted binding contracts
  - lines 174–196: RLS and grant contracts
  - lines 198–232: executable service reclassification and behavioral evidence
    contracts
- `supabase/tests/0026_sku_registry.test.sql` — 561 lines
  - lines 6–94: exact seed equality
  - lines 96–288: arithmetic, class/field, price, and NULL-hole probes
  - lines 290–389: real die-order RPC plus both/neither/alternate binding probes
  - lines 391–485: service, anonymous, and authenticated RLS/grant probes
  - lines 487–559: identity, class, version, payload, status, and timestamp
    discipline

## Seed table

The Star values and prices come from
`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` section 2. The
Lunar price comes from section 3.1, and its `product_id = 'lunar-pass'` matches
migration 0024. Every seed uses `status = 'sandbox'` and `value_version = 1`.

| sku_id | class | USD cents | raw | bonus | total | first-time total | product_id | status |
|---|---|---:|---:|---:|---:|---:|---|---|
| `stars_handful` | `star_bundle` | 49 | 60 | 0 | 60 | 120 | NULL | `sandbox` |
| `stars_pouch` | `star_bundle` | 249 | 300 | 30 | 330 | 600 | NULL | `sandbox` |
| `stars_bag` | `star_bundle` | 749 | 980 | 110 | 1090 | 1960 | NULL | `sandbox` |
| `stars_chest` | `star_bundle` | 1499 | 1980 | 260 | 2240 | 3960 | NULL | `sandbox` |
| `stars_vault` | `star_bundle` | 2499 | 3280 | 600 | 3880 | 6560 | NULL | `sandbox` |
| `stars_hoard` | `star_bundle` | 4999 | 6480 | 1600 | 8080 | 12960 | NULL | `sandbox` |
| `lunar_pass_monthly` | `subscription` | 299 | NULL | NULL | NULL | NULL | `lunar-pass` | `sandbox` |

The first-time total is double-raw and replaces, rather than stacks with, the
standard bonus.

## Final requested test output

Commands were run through the required `rtk` wrapper. Exact requested command:

```text
npm test -- 0026
```

```text
> vitest 0026
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0026_sku_registry.test.ts (7 tests) 8ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  21:16:40
   Duration  537ms (transform 32ms, setup 98ms, collect 15ms, tests 8ms, environment 322ms, prepare 5ms)
```

Exact requested command:

```text
npm test -- supabase/migrations
```

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 16ms
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 8ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 15ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 8ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 16ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 12ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 10ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 10ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 25ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 23ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 9ms
 ✓ supabase/migrations/0026_sku_registry.test.ts (7 tests) 9ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 8ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 ✓ supabase/migrations/0025_pity_read.test.ts (5 tests) 7ms
 Test Files  20 passed (20)
      Tests  163 passed (163)
   Start at  21:16:44
   Duration  2.07s (transform 288ms, setup 2.11s, collect 376ms, tests 230ms, environment 8.49s, prepare 130ms)
```

Both requested commands exited 0. Focused ESLint for
`supabase/migrations/0026_sku_registry.test.ts` also reported no issues.

## Risks and dormant boundaries

- The requested Vitest commands are source-contract gates. They now reject
  commented-out behavioral probes, but they do not execute the SQL against
  PostgreSQL.
- No SQL execution was performed because the original task prohibits Docker.
  The migration was not applied to a hosted or local database in this slice.
- No checkout, fulfill, refund, edge-function, or client path reads
  `store_skus`. A `sku_id`-bound order can remain pending, but the existing
  fulfillment contract remains intentionally die-only.
- Adding `sku_id` expands the `payment_orders` composite returned by existing
  RPCs with one nullable field. The real RPC call and widened return are covered
  by executable behavioral SQL plus source contracts, not a PostgreSQL run in
  this task.
- Draft visibility relies on the normal Supabase `service_role` `BYPASSRLS`
  capability; the repository's local Supabase fixture models that capability.
- No commit was created.

## Provenance

- Exact model ID: `gpt-5.6-sol`
- Reasoning effort: `high`
- Source: `/home/donovanyohan/.codex/config.toml` lines 1–2
