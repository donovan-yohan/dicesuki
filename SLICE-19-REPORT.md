# Slice 19 Report — Checkout + Fulfill Wiring for Non-Die SKUs (rev 4)

## Summary

Slice 19 closes the server-side sandbox purchase loop for registry-backed Star
bundles and the Lunar subscription while preserving the legacy die checkout
path. Registry checkout accepts only `sandbox|live` non-die rows, derives and
snapshots price/economic values in SQL, and never accepts a client-supplied
price. Star fulfillment appends paid Stars with per-user/per-SKU first-purchase
tracking. Lunar checkout uses Xsolla's subscription token contract and records a
separate immutable receipt for every signed invoice transaction, including
renewals.

Refunds reverse the exact credited ledger snapshot by append. A covered
first-purchase refund also appends a first-purchase reversal, making the user
eligible for double-raw again. An insolvent refund does not invent a partial
clawback or negative balance: it commits an immutable unresolved-reversal row,
emits a non-aborting SQLSTATE `55000` log, and leaves the credit, eligibility,
and order unchanged pending the open product-policy decision.

No client/UI code changed. The production payments flag remains untouched.
No database or hosted mutation completed, and no commit was created.

Rev 3 repairs the stale 0026 payment-order fixture exposed by the 0028
fail-closed snapshot CHECK. The CHECK and every existing 0026 assertion remain
unchanged.

Rev 4 exhaustively audits every 0028 SQL statement for role context. Each API
role window now contains only the call or calls under test and `pg_temp`
handoff; all fixture DML and reads of privileged or RLS-scoped tables run after
`RESET ROLE`. JWT claims start cleared, are pinned for the authenticated
privilege probe, and are cleared again after that role window.

## Files and line map

| File | Lines | Role |
|---|---:|---|
| `supabase/tests/0026_sku_registry.test.sql` | 346–430 | Rev 3 FIX2 coverage: valid snapshot data on raw negative binding probes, plus production `create_sku_payment_order` coverage and exact returned-snapshot validation for the valid SKU-bound scenario. |
| `supabase/migrations/0028_sku_fulfillment.sql` | 1–1424 | Receipt tables and append-only guards (11–195), including the Lunar grant ID by-value reference with unique btree coverage and no inbound FK (92–112); immutable order-time SKU snapshots and binding-aware order constraints (197–312); service-only registry order creation (314–400); narrowly authorized canonical paid reversal append (401–617); bundle/Lunar/legacy fulfillment, including renewal correlation (619–997); locked available-balance seam (998–1051); exact bundle/Lunar/legacy refund dispatch (1052–1371); RLS and least privilege (1373–1424). |
| `supabase/migrations/0028_sku_fulfillment.test.ts` | 1–272 | Static migration contract: append-only history, immutable snapshots, first-time arithmetic, paid-negative authorization, by-value Lunar grant reference without an inbound FK, repeated Lunar invoices, lock order, unresolved reversals, legacy DML equivalence, and executable-suite coverage. |
| `supabase/tests/0028_sku_fulfillment.test.sql` | 1–849 | Disposable-Postgres lifecycle probes for registry creation, draft rejection, first/subsequent/replayed bundles, covered and insolvent refunds, re-eligibility, repeated Lunar invoices and invoice-specific refunds, legacy dice, retune isolation, and privileges; rev-4 role windows isolate API calls from owner-only setup and privileged assertions through `pg_temp.order_ctx`. |
| `supabase/tests/0028_sku_fulfillment.test.mjs` | 1–97 | Two-session bundle fulfill/refund concurrency proof for the shared first-purchase-anchor → wallet lock order. |
| `supabase/functions/create-checkout/index.ts` | 1–233 | Authenticated checkout handler; explicit registry class/status lookup, legacy catalog backstop, class-specific order RPC, SQL-returned registry amount, `XSOLLA_LUNAR_PLAN_ID` fail-closed configuration, and Xsolla token request. |
| `supabase/functions/create-checkout/index.test.ts` | 1–51 | Source contract for registry filters, RPC routing, SQL-owned amount, and non-invented Lunar plan configuration. |
| `supabase/functions/_shared/catalog.ts` | 1–160 | Pure legacy-map/registry resolver and fail-closed registry row validation. |
| `supabase/functions/_shared/catalog.test.ts` | 1–161 | Mocked registry lookup coverage for `sandbox|live`, draft/die/malformed rejection, price truth, and Lunar product binding. |
| `supabase/functions/_shared/checkout.ts` | 1–60 | Pure class-specific order-RPC router and PostgREST row normalization. |
| `supabase/functions/_shared/checkout.test.ts` | 1–81 | Mocked proof that legacy dice retain `create_payment_order` while registry non-dice call `create_sku_payment_order` without a price argument. |
| `supabase/functions/_shared/xsollaToken.ts` | 1–155 | One-time Store API v3 token body remains intact; subscription inputs use merchant-v2, `purchase.subscription`, and `settings.mode='sandbox'`. |
| `supabase/functions/_shared/xsollaToken.test.ts` | 1–144 | Exact endpoint, auth, one-time body, merchant-v2 subscription body, sandbox, and production-mode wire-shape tests. |
| `supabase/functions/_shared/webhookDispatch.test.ts` | 164–187 | Proves `transaction.id` and the complete signed `purchase.subscription` envelope reach fulfillment unchanged. No dispatcher notification or drain behavior changed. |
| `docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` | 676–680, 692–698 | Blocks Lunar enablement on live-sandbox proof of the merchant-v2 dual purchase envelope; records covered-refund re-eligibility and preserves insolvent-refund resolution as an open question. |

## Branch-by-class behavior

| Class/path | Checkout | Fulfillment and replay | Refund/chargeback |
|---|---|---|---|
| Legacy die | Existing frozen code map, `catalog_items` existence check, and `create_payment_order` with the existing server price. | The catalog-item entitlement DML is executable-equivalent to migration 0013. Exact payment replay returns the existing order and never grants twice. | Preserves 0013 lineage: revoke only when this order established/reactivated the entitlement; linked independently-owned dice survive. Order becomes `refunded`. |
| `star_bundle` | `store_skus` exact ID lookup; class must be `star_bundle`; status must be `sandbox|live`. `create_sku_payment_order` derives USD price and snapshots price, value version, standard total, and first-time total. | First active purchase grants `sku_first_time_total` into `(stars, paid)`; later active purchases grant `sku_star_total`. First-time is double-raw replacing the standard bonus. Fulfillment and ledger keys are idempotent. Registry retunes after order creation cannot change the snapshot or credit. | Locks the first-purchase anchor before wallet state. A covered reversal appends the exact negative credited amount through an internal exact refund intent, appends a reversal receipt, and reverses the first-time event when applicable. Replay/second reversal type cannot double-debit. Insolvency records unresolved evidence and leaves order/credit/eligibility unchanged. |
| Lunar subscription | Registry status/class/price/product checks plus required server env `XSOLLA_LUNAR_PLAN_ID`; absence returns `CATALOG_MISCONFIGURED` before order creation. Token uses merchant-v2 `/merchants/{merchant_id}/token` with exact plan/product fields; no plan ID is invented. | Only signed `payment` envelopes carrying `purchase.subscription` call the migration-0024 300-Star grant. Every distinct `transaction.id` gets an immutable `lunar_order_invoices` receipt and exactly one grant; replay is idempotent. Renewals may correlate through the previously bound subscription when no checkout `external_id` is present. `cancel_subscription` remains a separate lifecycle notification. | Finds and reverses the specific invoice's exact 300-Star grant by append. The recurring order stays `fulfilled`; refunding one invoice does not poison later invoices. A refund followed by chargeback for the same invoice is audited without re-reversal. Insolvent invoices use the same unresolved policy. |
| Draft registry row | Explicit edge filter and SQL boundary both reject it. | Not reachable. | Not reachable. |
| Registry die row | Explicit edge resolver and `create_sku_payment_order` reject it; dice remain on the legacy path. | Not reachable through registry checkout. | Not reachable through registry checkout. |

## Refund policy and specification citations

The implementation follows these exact design points:

- Spec §2, lines 242–243: the first purchase grants `raw × 2`, replacing rather
  than stacking the standard bonus.
- Spec §6 deltas 5–6, lines 600–609: Star bundles credit the paid bucket,
  first-time state is unique per user/SKU, and refunds reverse both the credit
  and first-time state.
- Updated spec §7, lines 687–693: a covered refund restores first-time
  eligibility and re-purchase grants double-raw again; the already-spent-credit
  policy remains open.

Decision implemented for this sandbox slice:

1. Fulfillment snapshots the actual credited amount, SKU value version, and
   source ledger row; refunds never re-read mutable registry totals.
2. If the available balance covers the full snapshot, append the full exact
   reversal. Never append only the coverable portion.
3. If it does not cover the snapshot, append an immutable
   `unresolved_payment_reversals` row and issue `RAISE LOG ... ERRCODE='55000'`.
   A throwing exception was intentionally not used because PostgreSQL would
   roll back the evidence row.
4. On the unresolved path, do not mutate wallet credit, first-purchase state, or
   order status. The product decision—negative clawback, unresolved/manual
   recovery, or netting another balance—remains explicitly open in §7.

## Rev 3 FIX2 fixture decisions

The 0026 sweep found exactly three raw `payment_orders` inserts that name
`sku_id`; each now has an explicit choice and rationale:

| Scenario | Choice | Rationale |
|---|---|---|
| Both catalog and SKU bindings | Keep the raw insert and add the canonical `stars_handful` snapshot: value version 1, price 49, standard total 60, first-time total 120, and NULL product ID. | No production RPC can intentionally construct both bindings. A valid Star snapshot makes the 0028 snapshot CHECK pass so the unchanged 0026 exactly-one-binding assertion remains the rejection under test. |
| Neither catalog nor SKU binding | Keep the raw insert with `sku_id` and every snapshot field NULL. | No production RPC can intentionally construct neither binding. This is the valid legacy-side snapshot shape, so the unchanged 0026 exactly-one-binding assertion remains isolated. |
| Valid `stars_handful` SKU binding | Replace the raw insert with service-role `create_sku_payment_order` and assert its returned binding, version, price, Star totals, product shape, and amount. | The scenario permits the production boundary. Using it proves database-derived economics and a complete immutable snapshot instead of duplicating production insert logic in the fixture. |

## Rev 4 exhaustive role-discipline audit

`pg_temp.order_ctx` is the sole cross-role carrier for RPC-returned values and
identifiers consumed by owner assertions; privileged table reads remain
owner-only.

| Scenario | API-role windows (calls under test) | Privileged/RLS reads after `RESET ROLE` |
|---|---|---|
| Registry create + draft rejection | `service_role`: `create_sku_payment_order`; separate `service_role`: rejected draft create | `payment_orders`; owner-only draft `store_skus` setup |
| First/replayed + subsequent bundle | `service_role`: fulfill + replay; separate `service_role`: create + fulfill | `wallet_balances`, `wallet_ledger_entries`, `star_bundle_fulfillments`, `star_bundle_first_purchases`, `star_bundle_first_purchase_events` |
| Refund-intent guard + covered refund + re-purchase | `service_role`: rejected direct append; separate `service_role`: refund; separate `service_role`: create + fulfill | `star_bundle_fulfillments` source handoff; refund-state `wallet_balances`, `wallet_ledger_entries`, `star_bundle_first_purchase_events`; re-purchase `star_bundle_fulfillments` |
| Insolvent bundle refund | `service_role`: create + fulfill; separate `service_role`: refund | owner-only `wallet_balances` fixture mutation; `unresolved_payment_reversals`, `star_bundle_first_purchase_events`, `payment_refund_reversals` |
| Lunar first invoice, renewal, refund, reversal replay, later invoice | Five isolated `service_role` windows containing only the corresponding create/fulfill/refund calls | `lunar_purchase_star_grants`, `lunar_order_invoices`, `wallet_balances`, `payment_refund_reversals` after every state transition |
| Legacy die | `service_role`: create + fulfill + refund | `user_entitlements` |
| Registry retune | `service_role`: create; separate `service_role`: fulfill | owner-only `store_skus` retune; `star_bundle_fulfillments`, `payment_orders`; owner-only immutable-update probe |
| Privilege + append-only probes | `authenticated` with the exact user JWT: rejected create | owner-only privilege metadata checks and first-purchase-history update probe; JWT cleared after `RESET ROLE` |

## Test and build evidence

### Rev 3 targeted 0026 contract

`npm test -- 0026`

Exit code: `0`

```text
Test Files  1 passed (1)
Tests  7 passed (7)
Duration  547ms
```

### Rev 4 targeted migration contract

`npm test -- 0028`

Exit code: `0`

```text
Test Files  1 passed (1)
Tests  11 passed (11)
Duration  545ms
```

### Rev 4 database behavioral harness attempt

`npm run test:db:supabase`

Exit code: `1`

```text
Error: spawnSync docker EPERM
code: 'EPERM'
syscall: 'spawnSync docker'
```

The command failed at its initial Docker version check, before migrations or
the behavioral SQL/MJS tests ran.

### Migration Vitest suite

`npm test -- supabase/migrations`

Exit code: `0`

```text
Test Files  22 passed (22)
Tests  180 passed (180)
Duration  2.61s
```

### Supabase-focused Vitest

`npm test -- supabase`

```text
Test Files  29 passed (29)
Tests  272 passed (272)
Duration  3.23s
```

### Final targeted edge-function check

`npm test -- supabase/functions`

```text
Test Files  6 passed (6)
Tests  87 passed (87)
Duration  683ms
```

### Full Vitest

`npm test`

Exit code: `1`

```text
Test Files  3 failed | 135 passed (138)
Tests  17 failed | 1311 passed (1328)
Duration  28.05s
```

This gate is **not green**. All 17 failures are in the existing
`check-immutable-catalog-history`, `check-immutable-economy-history`, or
`check-immutable-migration-history` tests with the exact environment error:

```text
Error: spawnSync git EPERM
```

A standalone `node -e ... execFileSync('git',['--version'])` probe reproduced
`spawnSync git EPERM` despite also producing `git version 2.39.5`. This is
classified as an execution-sandbox limitation, not as passing evidence.
Existing React `act(...)` warnings also appeared but were non-failing and are
separate from the immutable-history failures.

### Build

`npm run build`

Exit code: `0`

```text
Verified 69 collectible catalog items
Verified 1 immutable economy contract edition(s)
Verified 1 immutable economy simulation scenario(s)
Verified 1 immutable production economy edition(s)
Runtime dice assets passed: cozy, cyberpunk, dark-dungeon
Verified dice manifest: 4 sets, 19 dice
✓ 1215 modules transformed.
✓ built in 5.95s
PWA generated: 24 entries
```

The chunk-size warning was non-fatal.

### Formatting

`npx eslint --fix supabase/functions/_shared/checkout.test.ts supabase/functions/_shared/checkout.ts supabase/functions/create-checkout/index.test.ts supabase/migrations/0028_sku_fulfillment.test.ts`
completed with:

```text
ESLint: No issues found
```

`git diff --check` completed cleanly with no output.

### Database behavioral harness status

`supabase/tests/0026_sku_registry.test.sql`,
`supabase/tests/0028_sku_fulfillment.test.sql`, and
`supabase/tests/0028_sku_fulfillment.test.mjs` remain **unexecuted against
PostgreSQL in this rev-4 pass**. The runtime harness was attempted, but
`spawnSync docker EPERM` stopped it at the initial Docker version check before
migrations or test SQL. The focused Vitest command above is a static contract
check; it does not substitute for live PostgreSQL execution.

## Risks and remaining proof

- `xsollaToken` currently sends `purchase.checkout` alongside
  `purchase.subscription` on merchant-v2. That exact envelope remains
  unverified against the live Xsolla sandbox and may produce a checkout 502;
  it must be exercised end-to-end before enabling Lunar checkout.
- `XSOLLA_LUNAR_PLAN_ID` must be configured with the real provider-owned plan
  ID. Checkout fails closed when it is absent; no value was invented.
- Full recurring checkout, renewal delivery, cancellation ordering, invoice
  refunds, and signature payload shapes remain unproved against real Xsolla.
- The changed 0026 fixture, 0028 behavioral SQL, and two-session lock-order
  harness remain unexecuted against real PostgreSQL in this FIX4 pass because
  the runtime attempt was blocked by `spawnSync docker EPERM` before migrations.
  They require an environment that can spawn Docker or a hosted sandbox before
  deployment.
- Insolvent paid-currency refunds have durable fail-closed evidence but no final
  business resolution. That policy gap is intentionally retained in spec §7.
- The full `npm test` gate remains sandbox-blocked by `spawnSync git EPERM`; it
  must not be reported as green.
- The build's non-fatal chunk-size warning and existing React `act(...)`
  warnings are unchanged follow-up signals, not Slice 19 correctness failures.
- No client/UI path was enabled or changed, and the production payments feature
  flag remains off.

## Adversarial review closure

The initial adversarial review found P1 issues in subscription token
construction, repeated-invoice correlation/refunds, mutable-registry retune
handling, lock ordering, and generic paid-negative authorization. They were
fixed in one batched pass with targeted tests. The focused re-review then found
one remaining P1: subscription checkout was still using the Store API v3 token
endpoint. Subscription tokens now use the merchant-v2 endpoint and exact body,
while non-subscription checkout retains Store API v3 unchanged. No P0/P1
finding remains on focused inspection.

This closure is inspection plus targeted Vitest evidence, not a claim that all
required gates are green: the full Vitest gate is environment-blocked and the
database/runtime integrations remain unexecuted.

The Slice-19-FIX focused review found and fixed one out-of-line FK test-bypass
P2; focused re-review found no remaining P0/P1/P2 findings.

The Slice-19-FIX2 review found the stale raw SKU-order fixture violated the
correct 0028 snapshot CHECK. Rev 3 preserves both negative raw probes with
valid snapshot shapes, routes the positive case through the production RPC,
and leaves the CHECK and all prior assertions intact. The integration review
then found one P2: the five newly added expected-scalar comparisons were not
NULL-safe, so an unexpected NULL could make the IF condition UNKNOWN instead
of rejecting the row. All five now use `IS DISTINCT FROM`; focused re-review
found no remaining findings.

The rev-4 exhaustive pass audited all 17 `service_role` windows and the one
`authenticated` window. Focused re-review found one weakened intermediate
refund-balance assertion after the first split; refund and re-purchase are now
separate windows, preserving the original exact `60`-Star refund-state check.
The final static role scan found zero privileged `public.*` relation reads or
fixture DML inside an API-role window.

## Provenance

- Original substantive implementation and adversarial review: model
  `gpt-5.6-sol`, effort `high`.
- Rev-4 role-discipline audit and focused re-review: model
  `gpt-5.6-terra`.
- Root orchestration: `GPT-5 Codex`. No more granular root deployment/model ID
  was exposed, so none is invented here.
