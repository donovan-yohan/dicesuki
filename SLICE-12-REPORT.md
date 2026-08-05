# Slice 12 Report — Lunar Pass daily faucet + purchase grant

## Summary

Implemented the dormant Lunar Pass slice-C database boundary:

- authenticated, self-only `claim_lunar_daily_stars()` with a private
  timestamp seam;
- exactly one 90-Star promotional credit per user and UTC day, with same-day
  receipt replay and no retroactive accrual or banking;
- service-only `grant_lunar_purchase_stars(bigint)` using immutable
  subscription-event receipts;
- exactly one 300-Star promotional credit per user, subscription, and billing
  period, including renewal periods;
- append-only claim/grant receipts, owner-read forced RLS, explicit privilege
  revocation, and no direct API-role DML;
- no webhook, edge-function, or client wiring.

The production/test change is exactly the three requested new `0024` files.
This required report is the only additional file. No existing file was edited,
no commit was created, and Docker was not used.

Base:

- branch: `econ/12-lunar-daily-faucet`
- HEAD: `40c8b82a7e225ab2c2948aefa08f97d78a4f0248`

## Files and lines

### `supabase/migrations/0024_lunar_pass_faucet.sql` — 537 lines

- lines 17–31: single canonical private `lunar-pass` product constant.
- lines 35–96: daily-claim and purchase-period append-only receipt tables,
  uniqueness, foreign keys, and indexes.
- lines 99–127: UPDATE/DELETE/TRUNCATE rejection with SQLSTATE `55000`.
- lines 134–257: private daily engine, UTC-day derivation, account-first
  serialization, eligibility, exact replay, and canonical 90 promotional-Star
  append.
- lines 261–281: zero-argument authenticated self-only daily wrapper.
- lines 290–472: private purchase engine, immutable historical product
  derivation, initial/renewal period derivation, delayed-period support,
  active-product gate, bounded hashed idempotency key, and canonical 300
  promotional-Star append.
- lines 476–489: service-only public purchase wrapper.
- lines 497–537: forced owner-read RLS and least-privilege grants/revocations.

### `supabase/migrations/0024_lunar_pass_faucet.test.ts` — 289 lines

- lines 35–258: eight structural/security tests pin the product constant,
  receipt schemas, append-only enforcement, UTC claim-or-lose behavior,
  purchase-period derivation, historical product binding, canonical ledger
  appends, wrapper exposure, RLS, and dormant/no-webhook boundary.
- lines 259–289: assertions that the behavioral SQL covers every required
  scenario with role resets and pinned SQLSTATEs.

### `supabase/tests/0024_lunar_pass_faucet.test.sql` — 910 lines

- lines 1–269: isolated users/subscription fixtures and privilege checks.
- lines 270–345: active claim, exact 90 promotional Stars, same-day replay,
  zero replay effects, and the UTC-midnight boundary.
- lines 346–431: different-user isolation plus non-subscriber, canceled,
  expired non-renewing, and product-mismatch failures.
- lines 432–576: initial purchase, exact replay, second billing period, and
  duplicate event convergence.
- lines 577–681: NULL-product renewal inheritance, later projection advance,
  delayed older-period grant, and replay.
- lines 682–732: negative historical product-switch proof preventing a
  NULL-product event from borrowing a later Lunar projection.
- lines 733–759: 255-character subscription ID with a bounded hashed ledger key.
- lines 760–850: append-only SQLSTATE checks, direct-DML denial, service-only
  purchase rejection, and RLS cross-user isolation.
- lines 851–910: authenticated public daily-wrapper success and anonymous
  rejection.

## Design decisions and specification citations

1. **Offer amounts and promotional bucket.** The locked offer is 300 Stars on
   purchase plus 90 Stars/day × 30 (`docs/exec-plans/active/2026-07-22-
   monetization-economy-spec.md`, §3.1, lines 299–303). The task explicitly
   keeps every pre-#154 Star credit in the promotional bucket
   (`SLICE-12-TASK.md`, lines 6–11), so both flows call the canonical `0009`
   append with `(stars, promotional)` and distinct reasons `lunar.daily` and
   `lunar.purchase`.

2. **UTC day and claim-or-lose.** A claim day is
   `(effective_at AT TIME ZONE 'UTC')::date`, giving one receipt per
   `(user_id, utc_day)`. No missed-day rows are derived. This follows the
   binding UTC/no-banking requirement (`SLICE-12-TASK.md`, lines 30–42) and the
   deliberately chosen paid-pass claim-on-login pressure model
   (`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md`, §3.5,
   lines 337–344). The UTC-period precedent is documented in spec §4,
   lines 353–360.

3. **Separate Lunar rail.** Migration `0010` remains untouched: its frozen
   reward-kind domain has no Star outcome, as recorded by the binding scout
   truths (`SLICE-12-TASK.md`, lines 13–20). Slice 12 copies its derived
   eligibility/private-engine idiom but writes dedicated Lunar receipts and
   reuses the canonical wallet append.

4. **Welkin recurrence.** Initial purchase uses the immutable
   `create_subscription.date_create`; each renewal uses its immutable
   `update_subscription.date_next_charge`. The same service RPC therefore
   grants one 300-Star receipt per billing period, including delayed delivery,
   while the unique period key and ledger idempotency hash prevent replays.
   This is the binding recurrence decision in `SLICE-12-TASK.md`, lines 43–52,
   implementing the monthly Welkin offer described in spec §3.1.

5. **Historical product identity.** A NULL-product update inherits only the
   latest preceding non-NULL product from the same immutable
   user/subscription event history. It cannot borrow a later Lunar projection.
   The engine separately requires the current exact subscription to be
   canonical Lunar and active.

6. **Dormant activation boundary.** No webhook/client call was wired, as
   required by `SLICE-12-TASK.md`, lines 53–54. The migration documents that
   launch still depends on #154 and subscription-law compliance, matching spec
   §3.6, lines 346–349.

## Adversarial review

The broad review and focused changed-hunk re-review resolved:

- overlong ledger keys for 255-character Xsolla subscription IDs;
- purchase lock ordering and cancellation-race rechecks;
- valid NULL-product renewal inheritance;
- delayed older-period fulfillment after projection advancement;
- historical cross-product misclassification;
- missing authenticated public-wrapper success coverage.

Final state has no unresolved P0/P1 finding.

## Required test output

Commands were executed through the repository-mandated RTK wrapper; the
underlying requested command lines were exactly:

```text
npm test -- 0024
```

```text
> vitest 0024
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (8 tests) 10ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  562ms
```

```text
npm test -- supabase/migrations
```

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (8 tests) 10ms
 Test Files  18 passed (18)
      Tests  150 passed (150)
   Duration  2.22s
```

## Risks and remaining evidence

- The behavioral SQL suite is authored and statically checked, but was not
  executed against PostgreSQL here because the binding task forbids Docker and
  reserves that harness for the orchestrator. ADR 017 requires live/disposable
  PostgreSQL proof for money paths (`docs/adrs/shared/017-monetization-economy-
  architecture.md`, lines 208–212); that remains the required next gate.
- The RPCs are intentionally dormant until the later subscription-SKU webhook
  slice wires fulfillment.
- All Stars remain promotional until #154 enables the paid-bucket design.

## Provenance

Authoritative runtime configuration:

- exact model ID: `gpt-5.6-sol`
- reasoning effort: `high`
- source: `/home/donovanyohan/.codex/config.toml`, lines 1–2

Implementation and adversarial review were delegated under the repository
procedure. The collaboration surface did not expose a separate runtime
model/effort override, so no unverified worker model identifier is claimed.

---

# Revision 2 — invoice-keyed purchase grant and batched fixes

Revision 1 above is preserved unchanged as the original delivery record. This
revision supersedes its subscription-event/period-keyed purchase design,
purchase-grant line map, and final static-test timestamps.

## Outcome

The 300-Star grant is now anchored to the signed Xsolla `payment` event that
proves money moved:

- service-only signature:
  `grant_lunar_purchase_stars(uuid, bigint, text, text, text)`, matching the
  verified user, normalized transaction id, and normalized
  `purchase.subscription` fields available to the future payment webhook path;
- immutable receipt key:
  `(user_id, subscription_id, xsolla_transaction_id)`;
- wallet idempotency key:
  `lunar-purchase:<canonical bigint text>`, scoped to the locked buyer account;
- exact product validation against `private.lunar_pass_product_id()`;
- exact replay returns the prior receipt with zero effects;
- same user/invoice drift in subscription, plan, product, or canonical amount
  fails closed;
- distinct paid invoices grant independently, including within the same
  subscription period;
- a paid invoice grants after cancellation, because refund/chargeback handling
  owns reversal; and
- payment fulfillment is ordering-independent from subscription lifecycle
  processing.

The purchase table and engine no longer read or reference
`subscription_events` or `user_subscriptions`. The only purchase-record owner
FK is `auth.users`; its wallet-entry FK remains the immutable append lineage.
This removes the FK that intercepted migration 0023's TRUNCATE-denial test
before the `55000` reject trigger could run. The 0023 file remains unchanged.

The migration also adds immutable, private amount functions for 90 daily Stars
and 300 purchase Stars. Each table CHECK, wallet append, and receipt insert
calls its respective function; no amount literal is repeated at those seams.

## Changed files

| File | Revision 2 result |
|---|---|
| `supabase/migrations/0024_lunar_pass_faucet.sql` | 472 lines. Replaces subscription-event period grants with the invoice-keyed service boundary, removes purchase subscription-state FKs/reads, single-sources both offer amounts, and adds the exact `(user_id, xsolla_transaction_id)` replay-probe btree index. |
| `supabase/migrations/0024_lunar_pass_faucet.test.ts` | 392 lines. Pins the realistic five-argument signature, canonical invoice key, exact product gate, replay/drift checks, amount single-sourcing, supporting-index shape, absence of purchase subscription dependencies, future wiring contract, and deterministic concurrency-harness shape. |
| `supabase/tests/0024_lunar_pass_faucet.test.sql` | 885 lines. Keeps the daily scenarios intact and rewrites purchase behavior for exact replay, distinct invoices, plan-change no-grant, product rejection, paid-after-cancel, payment-before-subscription ordering, and subscription/plan/product/amount drift. |
| `supabase/tests/0024_lunar_pass_faucet.test.mjs` | 234 lines. Precreates otherwise-empty wallet accounts, uses named blocker and racer sessions to force both calls to a visible lock wait, and reconciles identical and differing-subscription invoice races to one receipt, one ledger row, and a 300-Star balance. |
| `SLICE-12-REPORT.md` | Preserves Revision 1 and appends this Revision 2 record. |

No 0023 file or production webhook file was edited. No commit was created and
Docker was not used.

## Design and invariant evidence

1. **Invoice, not lifecycle date, is the grant fact.**
   `update_subscription`, `date_create`, `date_next_charge`, period keys, and
   source lifecycle receipt ids are absent from the purchase engine and table.
   The migration comment directs only the future `payment` fulfill branch to
   call the RPC for a Lunar `purchase.subscription` block and explicitly
   forbids calls from `update_subscription`.
2. **Replay is serialized and drift-sensitive.**
   `private.lock_wallet_account(p_user_id)` runs before lookup. Lookup uses
   user plus invoice, then compares subscription, plan, product, and the
   canonical amount before returning the prior receipt. This catches a changed
   subscription even though the required table UNIQUE is the three-column
   user/subscription/invoice tuple.
3. **Canonical invoice text is timezone-independent.**
   The wallet key uses `p_xsolla_transaction_id::text`. No purchase
   `timestamptz::text` derivation remains.
4. **Ordering and cancellation do not deny paid value.**
   The SQL suite grants once with no subscription event/projection present and
   once after the projected subscription is already canceled. Refund and
   chargeback paths remain the reversal authority.
5. **Amount semantics have one definition.**
   Static tests prove exactly one immutable function definition for each
   amount and prove all three enforcement/use seams call it. The SQL suite
   also reuses the first invoice's 0009 key with a different delta and pins the
   canonical ledger's `22023` zero-effects rejection.
6. **The lock-before-read concurrency claim is executable.**
   The new repository-convention `run({ psql, psqlAsync })` suite precreates
   otherwise-empty wallet accounts. For each race a named blocker locks the
   account row, both named grant sessions must become visible in
   `pg_stat_activity` with `:Lock:`, and explicit termination releases the
   blocker under guarded cleanup. Identical grants must return the same receipt;
   different subscription ids require one winner and the exact drift rejection.
   Both reconcile to `1:1:300` receipt/ledger/balance state. The supporting
   btree index matches the engine's post-lock user/invoice lookup.

The pinned battle-tested-pattern catalog had no direct invoice-idempotency or
inbox pattern. WAL and state-machine candidates were not a fit: this seam
already uses PostgreSQL transactions, the existing 0009 idempotent append
primitive, account locking, and immutable receipts. Repository SQL/static
tests remain the authoritative invariant proof. Categorical telemetry was not
recorded because the task forbids external writes.

## Exact required test output

All commands ran from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`
through the required RTK wrapper.

### `rtk npm test -- 0024`

Exit code: `0`

```text
> vitest 0024
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (9 tests) 12ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  05:30:34
   Duration  540ms (transform 38ms, setup 97ms, collect 21ms, tests 12ms, environment 318ms, prepare 6ms)
```

### `rtk npm test -- 0023`

Exit code: `0`

```text
> vitest 0023
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 12ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  05:30:40
   Duration  550ms (transform 42ms, setup 97ms, collect 24ms, tests 12ms, environment 321ms, prepare 6ms)
```

### `rtk npm test -- supabase/migrations`

Exit code: `0`

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 8ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 15ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 15ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 11ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 21ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 9ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (9 tests) 14ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 10ms
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 18ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 8ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 21ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 Test Files  18 passed (18)
      Tests  151 passed (151)
   Start at  05:30:41
   Duration  1.97s (transform 385ms, setup 1.97s, collect 483ms, tests 202ms, environment 7.49s, prepare 121ms)
```

Additional focused static lint:

```text
rtk npx eslint supabase/migrations/0024_lunar_pass_faucet.test.ts supabase/tests/0024_lunar_pass_faucet.test.mjs --report-unused-disable-directives --max-warnings 0
ESLint: No issues found
```

## Review and remaining gate

The adversarial pass found and fixed stale one-argument calls, a literal-amount
static assertion, an invalid service-role function-replacement test, and the
test file's pre-existing extra-semicolon lint error. The final focused review
also identified the missing user/invoice lookup index and the absence of direct
concurrency proof; both valid P2 findings were batched into the index plus
`.test.mjs` harness above. The changed-hunk re-review then found that bare
`Promise.all` races were probabilistic; the final targeted fix adopts 0011's
named blocker, activity wait, explicit termination, and guarded cleanup pattern
so both grant sessions demonstrably reach the same lock. No further broad
review was opened. All final static gates above are green.

The behavioral SQL and concurrency module are statically pinned but were not
executed against PostgreSQL in this worker because Docker is forbidden.
Removal of every purchase FK to `subscription_events` structurally removes the
reported 0023 TRUNCATE blocker, but the orchestrator's disposable/live SQL
rerun remains the runtime proof for 0023, 0024 behavior, and both new races.
