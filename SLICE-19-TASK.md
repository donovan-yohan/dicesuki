# Slice 19 — Checkout + fulfill wiring for non-die SKUs (phase c, deltas 5–6, sandbox)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c,
branch `econ/19-checkout-fulfill` (off main; merged: 0026 SKU registry
PR #196, 0027 paid bucket PR #197). This slice closes the sandbox purchase
loop: create-checkout sells registry SKUs; the webhook fulfill path credits
paid Stars (bundles, with first-time double-raw) or fires the Lunar 300-grant
per its invoice contract. Everything stays SANDBOX: only status='sandbox'|
'live' SKUs sellable, and the client flag (VITE_PAYMENTS_ENABLED) remains off
in production config — no UI change here.

Read FIRST: spec §2 (first-time = double-raw REPLACING bonus, once per user
per SKU; §6 deltas 5–6: fulfill currency-credit branch + first-purchase
tracking; refunds must reverse credit AND the first-time flag), 0026
(store_skus shape, payment_orders.sku_id binding), 0027 (canonical append now
admits (stars,paid) for service), 0013 (create/fulfill/refund_payment_order —
current die-entitlement-only branches), 0024 grant_lunar_purchase_stars
(invoice contract in comments: called ONLY from a payment event carrying
purchase.subscription with the Lunar product; transaction.id as the invoice
key; refunds reverse by APPEND, never mutation),
supabase/functions/create-checkout + _shared/catalog.ts (code-only price map
to supersede for non-die SKUs) + xsolla-webhook/index.ts + webhookDispatch.ts
(payment/refund branches, drain discipline), 0009/0027 append conventions.

## Task — SQL first, then edge wiring, one slice
### A) `supabase/migrations/0028_sku_fulfillment.sql` (+.test.ts + behavioral suite)
1. **First-purchase tracking (delta 6):** `star_bundle_first_purchases`
   (user_id, sku_id) UNIQUE, append-only + reversal marker per refund
   discipline (reversal = append a reversal row, never delete; a refunded
   first purchase makes the user first-time-eligible AGAIN per spec — verify
   the spec §6 wording and encode exactly what it says, cite it).
2. **Fulfill branch (delta 5):** extend `fulfill_payment_order` (CREATE OR
   REPLACE on its canonical chain): when the order binds a store_skus row —
   sku_class='star_bundle' → credit star_total OR first_time_total (if no
   unreversed first-purchase row; record it) into the PAID Stars bucket via
   the canonical append (idempotency keyed off the order, distinct prefix);
   sku_class='subscription' + product lunar → call
   grant_lunar_purchase_stars per its documented contract (transaction id
   from the order's xsolla transaction — trace what fulfill actually
   receives from the webhook and pass the right id; if fulfill lacks the
   invoice id, STOP and report rather than inventing);
   sku_class='die' / legacy catalog_item orders → byte-identical existing
   entitlement path.
3. **Refund branch:** star_bundle refunds append a negative paid-Stars
   correction (canonical append; balance may legitimately go negative? NO —
   no-negative discipline: if the user already spent the Stars, follow spec
   §6 delta 6's refund wording; if it doesn't resolve insolvent-refunds,
   implement fail-closed logging (append what's coverable? NO — do not
   invent policy: reverse fully when balance covers it, otherwise record an
   unresolved reversal row + 55000-log path, and FLAG the policy gap in the
   report + a spec §7 open-question edit). Reverse the first-purchase flag
   per spec. Lunar refunds: the subscription cancel arrives separately
   (research: refund→cancel_subscription); the 300-grant reversal follows the
   0024 contract comment (append-based).
4. Behavioral suite: full sandbox purchase lifecycle per class — bundle
   first purchase (double-raw paid credit + flag row), second purchase
   (standard total), replay idempotent, refund (reversal + flag reversal +
   re-eligibility per spec), insolvent-refund path as implemented, lunar
   fulfill → 300 grant fired exactly once per invoice, die orders untouched,
   draft SKUs unsellable, privilege probes.
### B) Edge functions (TypeScript + tests, same slice)
5. create-checkout: accept registry SKU ids; validate against store_skus
   (sandbox|live only) server-side — supersede the code-only map for non-die
   SKUs (die SKUs keep the existing path); price from the registry row.
6. webhookDispatch/fulfill path: pass what the SQL branch needs (the Xsolla
   transaction id already flows for payments — verify and wire); no new
   notification types; drain discipline untouched.
7. Vitest for the dispatcher/create-checkout changes per the established
   mocked-deps patterns; existing tests must stay green unmodified unless
   semantics legitimately changed (state which).

## Boundaries
The 0028 files, the two edge functions + shared deps + their tests, and (if
the refund policy gap is real) a one-bullet spec §7 addition. NO client code.
No commits, no docker. Run: `npm test -- 0028`, `npm test -- supabase`,
`npm test` full, `npm run build` (paste exact lines).

## Report
`SLICE-19-REPORT.md`: summary; files+lines; branch-by-class behavior table;
refund policy decision with spec citation (or the flagged gap); test output;
risks; provenance (EXACT model id + effort).
