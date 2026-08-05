# Slice 6 Report — Behavioral live-DB suites for migrations 0014–0018

## Summary

Added six sorted live-Postgres behavioral test files for the money-path behavior
introduced by migrations 0014–0018. The suites cover ticket-ledger
idempotency/concurrency and RLS, banner funding reservation, Stars conversion,
commit/reveal settlement and client-side commitment verification, and the
soft-pity ramp.

No migration, database harness, or CI file was modified. Per the task boundary,
the Docker-backed live-Postgres harness was not run in this sandbox.

## Files and line counts

| File | Lines |
| --- | ---: |
| `supabase/tests/0014_roll_ticket_ledger.test.sql` | 236 |
| `supabase/tests/0014_roll_ticket_ledger.test.mjs` | 50 |
| `supabase/tests/0015_banner_roll_type_binding.test.sql` | 345 |
| `supabase/tests/0016_stars_to_standard_roll_conversion.test.sql` | 261 |
| `supabase/tests/0017_pull_commit_reveal.test.sql` | 892 |
| `supabase/tests/0018_soft_pity_ramp.test.sql` | 442 |
| **Total** | **2,226** |

## Scenario checklist

### `0014_roll_ticket_ledger.test.sql`

- [x] Grant and spend through `record_roll_ticket_ledger_entry`.
- [x] Reject a spend that would make the quantity negative (`22003`).
- [x] Return the original row for an exact replay without a second effect.
- [x] Reject payload drift on replay (`22023`).
- [x] Reject cross-`roll_type` reuse of one idempotency key (`22023`).
- [x] Prove authenticated users read only their own balance/history rows.
- [x] Prove authenticated users cannot mutate ticket tables directly or enter
      the service-only record boundary.

### `0014_roll_ticket_ledger.test.mjs`

- [x] Race two identical replays and require the same returned ledger id.
- [x] Reconcile the race to one ledger row and one balance effect.

### `0015_banner_roll_type_binding.test.sql`

- [x] Seed a standard-class, `standard_roll`-bound banner with exact
      `target_cost == pull_count` offers.
- [x] Prove ticket-funded preparation reserves without changing
      `roll_ticket_balances.current_quantity`.
- [x] Reject a second live same-family preparation and reject ticket spending
      that would invade the active ticket hold.
- [x] Reject a two-pull prepare that exceeds available ticket capacity.
- [x] Prove an expired ticket hold frees capacity with no ticket loss.
- [x] Prove both funding pools are isolated at their canonical balance guards:
      an active ticket hold does not block a Stars debit, and an active Stars
      hold does not block a ticket debit.
- [x] Reject premium-class banner preparation.
- [x] Prove the legacy NULL-`roll_type` banner still reserves Stars and debits
      nothing during preparation.

### `0016_stars_to_standard_roll_conversion.test.sql`

- [x] Atomically debit `160 * N` promotional Stars and credit `N`
      `standard_roll` tickets.
- [x] Return the original receipt on replay without another wallet debit or
      ticket credit.
- [x] Reject the same conversion key with a different count (`22023`).
- [x] Reject conversion when nominal Stars are insufficient (`22003`) with no
      partial effect.
- [x] Reject conversion when an active Stars pull hold makes available Stars
      insufficient, preserving the hold and both ledgers.

### `0017_pull_commit_reveal.test.sql`

- [x] Run a deterministic Stars-funded prepare-to-commit lifecycle.
- [x] Debit Stars exactly once by `held_amount`.
- [x] Advance `pull_guarantee_states` to the session's projected counters.
- [x] Grant the non-duplicate entitlement and credit duplicate Dust to the
      earned bucket.
- [x] Return the committed public reveal payload.
- [x] Independently recompute every result SHA-256 commitment from public reveal
      fields and nonce without private helpers or sealed-table reads.
- [x] Independently recompute the ordered commitment root and compare it with
      `commitment_root`.
- [x] Fail closed for missing, null, malformed, or mismatched reveal,
      commitment, and root fields.
- [x] Return an identical commit replay/getter receipt with no additional
      transition, ledger, entitlement, guarantee-row update, or balance effect.
- [x] Reject commit after cancel and prove no settlement effect.
- [x] Reject cancel after commit.
- [x] Reject commit of an expired session.
- [x] Reject cross-user commit and cross-user reveal retrieval.
- [x] Commit a ticket-funded session and debit the held ticket quantity exactly
      once.
- [x] Allow a new same-family preparation after the prior session reaches a
      terminal committed state.

### `0018_soft_pity_ramp.test.sql`

- [x] Seed a `linear-rate-ramp` banner with start pull 2 and increment 1.0.
- [x] Cover the non-flaky two-result envelope from a zero counter: a natural
      result-1 featured hit resets the counter, otherwise result 2 is the
      guaranteed featured soft-pity award.
- [x] Independently seed `selected_misses = 1` and prove the next result
      deterministically awards the selected featured item with
      `resolution_reason = 'soft-pity'`.
- [x] Exercise live all-or-none constraint violations in both directions.
- [x] Exercise the live `soft_pity_start_pull < selected_hard_guarantee_pull`
      constraint.
- [x] Prove the legacy NULL-ramp banner seals only legacy resolution reasons
      and never `soft-pity`.

## Validation

- `npm test -- --run` for the five migration contract files: **5 files,
  50 tests passed**.
- `npm run lint`: **passed with zero warnings**.
- `node --check supabase/tests/0014_roll_ticket_ledger.test.mjs`: **passed**.
- Static suite checks: expected names, SQL `begin`/`rollback` wrappers, paired
  dollar-quote delimiters, no trailing whitespace, and no private commitment
  helper or sealed-result access in the 0017 client verifier: **passed**.
- One broad adversarial review found two P1 assertion gaps in 0017. Both were
  fixed together; the focused changed-hunk re-review found no unresolved
  P0/P1/P2 findings.

## Known risks and assumptions for the live harness

- The Docker-backed `npm run test:db:supabase` gate remains required outside
  this sandbox. It must confirm PostgreSQL execution of all six new files after
  the 18 sorted migrations and prior suites.
- Migration 0017's account-wide `preserve_pull_ownership_snapshot` trigger
  prevents two simultaneous cross-family prepares because each new prepare
  invokes the starter-entitlement writer. Within the test-only boundary, 0015
  therefore proves ticket/Stars pool isolation at the canonical debit guards,
  not concurrent cross-family prepare liveness. If acceptance requires two
  coexisting opposite-funded prepares for one account, the merged production
  behavior and the no-migration-change boundary must be reconciled separately.
- The 0017 exact-replay guarantee proof uses PostgreSQL `ctid` inside the
  disposable transaction: any `UPDATE`, including a same-values upsert, creates
  a new tuple and changes `ctid`. The live harness should confirm this assertion
  under its PostgreSQL 17 image.
- The deterministic 0017 banner fixture and transaction-local custom settings,
  and the 0018 cloned canonical tier/item fixture, were checked against the
  merged migrations but still require live execution.
- The 0014 concurrency module intentionally persists its fresh, unique test
  identity and ledger row for later sorted suites, matching the existing MJS
  suite convention.

Authored by: Codex CLI 0.144.1 (codex exec), model: gpt-5.6-terra.
