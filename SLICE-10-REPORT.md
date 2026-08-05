# Slice 10 Report — Subscription status schema + event state machine

## Summary

Implemented Lunar Pass slice A as dormant schema + RPC plumbing only:

- immutable `subscription_events` webhook receipt ledger;
- monotone, terminal-dominant `user_subscriptions` projection;
- service-only `record_subscription_event` RPC backed by a private engine;
- authenticated-self/service `is_lunar_pass_active` predicate;
- owner-read RLS, service-only mutation, and Realtime publication of only the
  projected snapshot;
- colocated static contract tests and a transactional behavioral PostgreSQL
  suite.

No webhook/edge-function, faucet, client, monetary activation, commit, or
Docker work was performed. The rail is explicitly dormant `[free]`; activation
still requires both issue #154 and subscription-law clearance under spec §3.6.

## Files and line counts

- `supabase/migrations/0023_subscription_status.sql` — 576 lines.
- `supabase/migrations/0023_subscription_status.test.ts` — 323 lines.
- `supabase/tests/0023_subscription_status.test.sql` — 893 lines.
- `SLICE-10-REPORT.md` — 261 lines.

No other files were changed by this slice.

## Schema and RPC decisions

### Immutable receipt ledger

`subscription_events` begins at migration line 25. It stores the resolved
`auth.users` UUID, Xsolla subscription ID as `text`, normalized notification
class, event-specific dates, parsed raw envelope, lowercase raw-body SHA-256,
processed state, and receipt time.

Known notifications are exactly:

- `create_subscription`
- `update_subscription`
- `non_renewal_subscription`
- `cancel_subscription`

Unrecognized names normalize to the explicit `unknown` passthrough class. The
verbatim notification remains available inside `raw_payload`, `processed=false`
marks that no projection rule ran, and the event does not create or mutate a
snapshot.

The delivery key is:

`(subscription_id, normalized notification_type, relevant event date, body_sha256)`

The relevant date is `date_create` for create, `date_next_charge` for update
and non-renewal, `date_end` for cancellation, and a fixed null sentinel for
unknown events. A transaction advisory lock on the global `subscription_id`
aligns concurrent execution with that unique-key scope. An exact replay returns
the original immutable receipt before projection.

Update/delete/truncate triggers reject post-insert ledger mutation with
SQLSTATE `55000`.

### Exact Xsolla event shapes

The table constraint and private RPC both enforce:

- create: `date_create` and `date_next_charge` required; `date_end` forbidden;
- update: `date_next_charge` required; `date_create` and `date_end` forbidden;
- non-renewal: `date_next_charge` required; `date_create` and `date_end`
  forbidden;
- cancel: `date_end` required; `date_create` and `date_next_charge` forbidden.

This encodes the task's official Xsolla contract:

- [Created subscription](https://developers.xsolla.com/webhooks/subscriptions/created-subscription/)
- [Updated subscription](https://developers.xsolla.com/webhooks/subscriptions/updated-subscription/)
- [Nonrenewing subscription](https://developers.xsolla.com/webhooks/subscriptions/nonrenewing-subscription/)
- [Canceled subscription](https://developers.xsolla.com/webhooks/subscriptions/canceled-subscription/)

Xsolla documents update notifications for renewals and plan/date changes and
does not expose a status on that payload. The implemented projection therefore
uses the notification class itself as the transition input rather than
inventing a provider status.

### Monotone projection

`user_subscriptions` begins at migration line 115 and has one row per
`(user_id, subscription_id)`.

The transition rank is:

`active(0) < non_renewing(1) < canceled(2)`

The defining invariant is that rank never decreases and `canceled` is
absorbing. This is a guarded finite-state-machine adaptation: invalid or stale
events remain auditable in the ledger while the projection stays in its
current state. That matches the pinned state-machine pattern's central rule
that unhandled/guard-rejected events leave state stable:
[battle-tested state machine pattern](https://raw.githubusercontent.com/Totoro-jam/battle-tested-patterns/08448fc6613d790ae635fa12751e8a3cf9617816/docs/patterns/state-machine/index.md).

Transition behavior:

- create establishes `active`; it refreshes only an existing active row with a
  non-stale next-charge date and cannot resurrect a canceled subscription ID;
- update establishes or refreshes `active`, but is ignored for projection once
  rank is `non_renewing` or `canceled`;
- non-renewal advances to `non_renewing` unless canceled and refreshes an
  existing rank-1 row only with a non-stale next-charge date;
- cancel always advances a lower-rank row to `canceled`; repeated cancellation
  refreshes only with a non-stale `date_end`.

Within-rank stale create/update/non-renewal/cancel receipts append successfully
but do not overwrite newer plan/date fields.

### Entitlement predicate

`is_lunar_pass_active` begins at migration line 476. It is `STABLE`,
`SECURITY DEFINER`, uses an empty search path, and is executable only by
`authenticated` and `service_role`.

Authenticated callers are restricted to `auth.uid() = p_user_id`; anonymous or
cross-user calls fail with SQLSTATE `42501`. Service-role calls may query the
resolved webhook user.

The predicate is true only when at least one row is:

- `active`: entitled regardless of dates because the documented subscription
  notifications expose renewal outcomes but no failed-renewal/grace/dunning
  state;
- `non_renewing`: `p_at < date_next_charge`;
- `canceled`: `date_end IS NOT NULL AND p_at < date_end`.

The non-renewal and cancellation arms follow the Xsolla pages cited above.
Every date arm is explicit and null-safe; null user/time input returns false
for an authorized service/self call.

### Security, Realtime, and dormant gate

Both tables enable and force RLS. Authenticated users may select only their own
rows from both tables. API roles receive no direct insert/update/delete/truncate
capability; the public record wrapper is executable only by `service_role`, and
the private engine and trigger function are explicitly revoked.

Only `user_subscriptions` is added to `supabase_realtime` (migration line 551).
Raw webhook receipts are not published.

Migration lines 4–6 preserve the launch boundary: this schema is dormant and
adds no Stars, tickets, faucet, checkout, or randomized purchase activation.
Spec §3.6 and ADR-017 require both issue #154 and subscription-law clearance
before monetary activation.

## Behavioral coverage

The SQL suite is transaction-wrapped and resets role between trust windows. It
covers:

- full create → renewal update → non-renewal → cancel lifecycle, asserting the
  projection after every transition;
- cancel followed by late update, then create on the same subscription ID;
- stale active update, stale non-renewal, and earlier repeated cancellation:
  receipt appended, full projection unchanged;
- exact replay returns the prior receipt, adds zero rows, and preserves the
  projection tuple identity (`ctid`);
- unknown type appends as unprocessed and leaves projection absent;
- active/non-renewing/canceled entitlement truth tables, strict date
  boundaries, and null date/input cases;
- RLS own-row visibility and cross-user denial;
- direct table/RPC DML denial;
- update/delete/truncate ledger rejection;
- invalid documented event shapes pinned to SQLSTATE `22023` with zero event or
  projection state left behind.

The focused re-review found no remaining P0/P1.

## Exact required test output

Both commands were run from:

`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`

### `rtk npm test -- 0023`

Exit code: `0`

```text
> vitest 0023
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 11ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  03:18:18
   Duration  549ms (transform 36ms, setup 99ms, collect 18ms, tests 11ms, environment 326ms, prepare 6ms)
```

### `rtk npm test -- supabase/migrations`

Exit code: `0`

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 7ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 18ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 23ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 12ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 19ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 24ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 9ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 16ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 10ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 11ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 15ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 10ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 Test Files  17 passed (17)
      Tests  142 passed (142)
   Start at  03:18:22
   Duration  2.11s (transform 386ms, setup 2.04s, collect 496ms, tests 208ms, environment 7.72s, prepare 120ms)
```

## Risks and limitations

1. Per the task boundary, no Docker/PostgreSQL harness was run. The Vitest
   gates validate the migration and behavioral-suite contracts statically;
   `supabase/tests/0023_subscription_status.test.sql` still requires execution
   by the orchestrator-owned live/disposable PostgreSQL harness before merge.
2. Slice B must validate the signed raw Xsolla envelope and prove every parsed
   RPC argument corresponds to that envelope. Slice A stores both forms but
   cannot authenticate their correspondence without the webhook handler.
3. The raw-body SHA-256 is trusted input at this RPC layer. Slice B must compute
   it from the exact signed bytes, not reserialized JSON.
4. The focused re-review noted one non-blocking P2 coverage duplication:
   `update_subscription + date_end` is explicitly rejected by both the table
   constraint and RPC, while the behavioral invalid-shape matrix directly
   exercises the sibling forbidden-field cases rather than naming that exact
   combination separately.
5. Xsolla exposes no failed-renewal/grace/dunning subscription webhook in the
   four-event contract. Therefore `active` remains entitled until an actual
   non-renewal or cancellation outcome arrives; operational monitoring belongs
   in slice B.

## Provenance

- Implementation worker runtime model id: `gpt-5.6-terra`
- Implementation worker runtime effort: `xhigh`
- Adversarial reviewer runtime model id: `gpt-5.6-terra`
- Adversarial reviewer runtime effort: `high`
- Orchestrator runtime model id: `gpt-5.6-sol`
- Orchestrator reasoning effort: `high`
- Orchestrator provenance source: active runtime config keys `model` and
  `model_reasoning_effort`.

The agentic-engineering-delivery workflow supplied the intent/context/harness
map, one broad adversarial review, one batched fix pass, and one focused
re-review. The pinned state-machine pattern supplied the explicit
guard-rejected-event invariant; the repository SQL suite remains the
authoritative proof.

# Revision 2 — Batched review fixes

Revision 1 above is preserved unchanged. This revision resolves all four
findings from `SLICE-10-FIX-TASK.md`.

## Changes

1. The migration now states at both the `user_id` FK and public record RPC that
   `p_user_id` is the already-resolved Supabase auth uid. Slice B owns the
   upstream Xsolla `user.id` to auth uid resolution. Static tests pin that
   boundary.
2. `user_subscriptions` now projects and validates `product_id`.
   `is_lunar_pass_active` has the trailing optional
   `p_product_id text default null` parameter: null retains the existing
   any-subscription behavior and a non-null value requires an exact projected
   product match. The function comment requires slice C daily claims to pass
   the Lunar product id once its SKU exists. Function comments, revokes,
   grants, privilege assertions, and behavioral match/mismatch/null cases use
   the new `(uuid, timestamptz, text)` signature; existing two-argument calls
   remain compatible through the default.
3. The active-to-non-renewing transition now mirrors the existing
   `excluded.date_next_charge >= user_subscriptions.date_next_charge` guard.
   Its comment records the sequential-delivery reliance, and the behavioral
   suite proves an earlier stale non-renewal appends its receipt without
   shortening the newer projected entitlement date or advancing status.
4. A projection-column comment records that Xsolla `is_gift` and `trial`
   deliberately remain only in `subscription_events.raw_payload`; future gift
   logic reparses that jsonb.

No Docker or PostgreSQL harness was run in this fix pass. The orchestrator owns
the live/disposable database rerun. The prior live result remains 23 migrations
and 19 suites green, but it predates revision 2 and is not claimed as
exact-revision-2 evidence.

## Exact required test output

Both commands were run from:

`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`

The repository-required RTK wrapper executed the requested npm commands.

### `rtk npm test -- 0023`

Exit code: `0`

```text
> vitest 0023
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 12ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  03:33:52
   Duration  541ms (transform 36ms, setup 98ms, collect 19ms, tests 12ms, environment 319ms, prepare 5ms)
```

### `rtk npm test -- supabase/migrations`

Exit code: `0`

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 11ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 9ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 16ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 13ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 11ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 17ms
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 21ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 8ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 8ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 10ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 9ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 Test Files  17 passed (17)
      Tests  142 passed (142)
   Start at  03:33:55
   Duration  1.97s (transform 382ms, setup 1.91s, collect 452ms, tests 181ms, environment 7.16s, prepare 114ms)
```

## Revision 2 closeout

- Changed only the three `0023` files and this report.
- Focused changed-hunk review found no unresolved P0/P1 issue.
- No commit was created.
