# Slice 2 Report — rev 2 (post-review fix)

## Summary

Rev 2 corrects the 0015 ticket-funding model from prepare-time debit/refund to prepare-time reservation semantics. A ticket-backed preparation now computes available quantity as `roll_ticket_balances.current_quantity` minus active `pull_sessions.held_amount` for the same user and exact `roll_type`; it does not call `record_roll_ticket_ledger_entry`. Expiry therefore releases capacity naturally without a refund entry. The future commit/reveal boundary is explicitly responsible for the real debit and must not double-count the active hold.

Legacy NULL-funded preparations retain the original promotional-Star balance and cost behavior, while their active-hold sum now joins `pull_banner_versions` and excludes ticket-funded sessions. The sibling wallet guards retain the same filter, so Star and ticket reservations cannot cross-reserve.

The adversarial fix batch also:

- removed the dead `release_roll_ticket_pull_hold` function and revoke;
- requires a ticket-funded offer's `target_cost` to equal `p_pull_count`, then stores the original `target_cost` in `held_amount`, preserving the inherited 0011 offer foreign key while making ticket holds count ticket units;
- added a private `roll_ticket_balances` update trigger that prevents later ledger debits from reducing quantity below active same-user/same-type holds;
- made the premium pairing constraint reject a NULL `roll_type` explicitly under PostgreSQL three-valued CHECK semantics;
- strengthened static assertions for both coalesces, active-time predicates, pool isolation, the offer-unit guard, no prepare debit, no refund helper, and the ticket balance backstop.

One broad adversarial review and one focused re-review were completed. The re-review reported no remaining P0/P1 findings in the changed hunks.

## Files Changed

- `supabase/migrations/0015_banner_roll_type_binding.sql` — 786 lines
- `supabase/migrations/0015_banner_roll_type_binding.test.ts` — 229 lines
- `SLICE-2-REPORT.md` — 199 lines

No 0011/0014 file, frontend, server file, task file, or other artifact was modified. Nothing was committed or staged, and all work remained offline.

## Verification

Command: `npm test -- 0015_banner_roll_type_binding` (exit 0)

```text
Test Files  1 passed (1)
Tests  9 passed (9)
```

Command: `npm test -- supabase/migrations` (exit 0)

```text
Test Files  9 passed (9)
Tests  72 passed (72)
```

Command: `npm test` (exit 1, documented sandbox-only history-guard failures)

```text
Test Files  3 failed | 110 passed (113)
Tests  17 failed | 1018 passed (1035)
```

All 17 failures were confined to the three documented history guards:

- `scripts/check-immutable-catalog-history.test.ts` — 4 failures
- `scripts/check-immutable-economy-history.test.ts` — 8 failures
- `scripts/check-immutable-migration-history.test.ts` — 5 failures

Every one failed with the exact environmental error:

```text
Error: spawnSync git EPERM
```

The 0015 suite passed all 9 tests within both targeted runs and the full run. Unrelated React `act()` and Three.js messages were warnings, not test failures.

## Deviations and Why

- The full suite was not green only because sandbox policy denied the three history guards' `git` subprocesses with `Error: spawnSync git EPERM`; no other test failed.
- No live-Postgres harness was built or run, exactly as the fix task required. The repository-wide lack of migration-application/concurrency proof remains a separately tracked harness gap; this slice uses static migration assertions only.
- No hosted Supabase or network validation was run because the task required offline execution.

## Blockers and Risks

- There is no implementation blocker within the requested offline static-assertion scope.
- Ticket-backed banner offers must encode one ticket per pull (`cost = pull_count`). Preparation now fails closed with SQLSTATE `55000` if that immutable configuration contract is violated, while preserving 0011's offer FK and original `target_cost` session insert.
- The actual ticket debit remains intentionally absent until a future atomic append-only commit/reveal path lands. That committer must debit the tickets and avoid double-counting the active reservation.
- Static regex tests do not apply the SQL in PostgreSQL or directly prove trigger/concurrency behavior; that is the residual live-Postgres gap above.
- Premium random pulls remain disabled; this migration provides only constrained metadata plus the trusted preparation guard.

## Working Tree Evidence

Command: `git status --porcelain`

```text
?? SLICE-1-REPORT.md
?? SLICE-1-TASK.md
?? SLICE-2-FIX-TASK.md
?? SLICE-2-REPORT.md
?? SLICE-2-TASK.md
?? supabase/migrations/0014_roll_ticket_ledger.sql
?? supabase/migrations/0014_roll_ticket_ledger.test.ts
?? supabase/migrations/0015_banner_roll_type_binding.sql
?? supabase/migrations/0015_banner_roll_type_binding.test.ts
```

Command: `git diff --stat`

```text
(no output; all task artifacts are untracked and nothing was staged)
```

## Provenance

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5.6 Terra

## rev 1

# Slice 2 Report — Banner to Roll-Type Binding

## Summary

Slice 2 adds an append-only `0015` migration and colocated static-assertion test for standard banner ticket funding. The migration adds `banner_class` and `roll_type` to `pull_banner_versions`, preserves existing rows and legacy behavior as `('standard', NULL)`, constrains valid class/type pairings, and rejects premium banners in `prepare_pull`.

For a non-NULL standard roll type, preparation debits one ticket per pull through the Slice 1 ledger function. The migration also defines a private, replay-safe refund helper with a distinct reason and hold-derived idempotency key. It does not claim that expiry or cancel invokes that helper today: `0011` has no actual terminal commit/cancel transition to replace. Premium support is columns plus fail-closed behavior only; no premium random path, banner row, or reveal logic is enabled.

The broad adversarial review found no P0/P1 issues. Static boundary hardening was applied, and the focused re-review's P3 finding was fixed.

## Files Changed

- `supabase/migrations/0015_banner_roll_type_binding.sql` — 798 lines
- `supabase/migrations/0015_banner_roll_type_binding.test.ts` — 203 lines
- `SLICE-2-REPORT.md` — 94 lines

The Slice 1 artifacts and both task files shown by Git status pre-existed this report task and were not modified while creating this report.

## Verification

Command: `npm test -- 0015_banner_roll_type_binding`

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

Command: `npm test -- supabase/migrations`

```text
Test Files  9 passed (9)
Tests  71 passed (71)
```

Command: `npm test`

```text
Test Files  3 failed | 110 passed (113)
Tests  17 failed | 1017 passed (1034)
```

All 17 failures were confined to the three documented history guards:

- `scripts/check-immutable-catalog-history.test.ts` — 4 failures
- `scripts/check-immutable-economy-history.test.ts` — 8 failures
- `scripts/check-immutable-migration-history.test.ts` — 5 failures

Each failed with the exact environmental error:

```text
Error: spawnSync git EPERM
```

The `0015_banner_roll_type_binding` suite passed all 8 tests within the full run. Unrelated React `act()` and Three.js messages were warnings, not test failures.

## Deviations and Why

- The full suite was not green because sandbox policy denied the history guards' `git` subprocesses with `Error: spawnSync git EPERM`; no other tests failed.
- The requested offline boundary prevented a pattern-catalog fetch. Existing PostgreSQL conventions and the `0014` idempotency implementation were treated as authoritative instead.
- Pattern evidence consent was enabled, but the no-fit evidence write failed exactly: `error: [Errno 30] Read-only file system: '/home/donovanyohan/.codex/pattern-evidence'`.
- No hosted Supabase or other network validation was run, as required.

## Blockers and Risks

- There is no implementation blocker within the requested offline static-assertion scope. The sandbox-only history-guard failures prevent a fully green aggregate `npm test` result in this environment.
- `0011` has no actual terminal commit/cancel transition. The private release helper is therefore an honest future seam only, not wired runtime expiry/cancel behavior.
- No banner with a non-NULL `roll_type` is enabled. Before enabling one, an atomic append-only terminal transition must invoke the release helper and make replay handling transition-aware.
- Static regex tests verify migration text but do not apply the SQL in PostgreSQL or prove concurrency and runtime behavior.
- The premium path is limited to schema columns and a fail-closed preparation guard.

## Working Tree Evidence

Command: `git status --porcelain`

```text
?? SLICE-1-REPORT.md
?? SLICE-1-TASK.md
?? SLICE-2-REPORT.md
?? SLICE-2-TASK.md
?? supabase/migrations/0014_roll_ticket_ledger.sql
?? supabase/migrations/0014_roll_ticket_ledger.test.ts
?? supabase/migrations/0015_banner_roll_type_binding.sql
?? supabase/migrations/0015_banner_roll_type_binding.test.ts
```

Command: `git diff --stat`

```text
(no output; all task artifacts are untracked and nothing was staged)
```

## Provenance

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5
