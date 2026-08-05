# Slice 3 Report — Stars to standard-roll conversion

## Summary

Added the offline Supabase RPC for converting promotional Stars into
`standard_roll` tickets at the specification rate of 160 Stars per roll. The
private engine accepts an explicit user, validates a bounded roll count and
client idempotency key, acquires the canonical `wallet_accounts` lock first,
then atomically debits Stars through 0015's canonical
`append_wallet_ledger_entry` and credits tickets through 0014's
`record_roll_ticket_ledger_entry`.

The public `SECURITY DEFINER` wrapper derives the signed-in, non-anonymous user
from the authenticated session, so callers cannot convert for another user.
Deterministic, distinct inner ledger keys make exact retries return the original
two ledger rows without another debit or credit; payload drift fails closed
with the existing SQLSTATE `22023` convention. The returned receipt exposes the
original ledger IDs, debit/credit amounts, and resulting balances.

The conversion is promotional-only and standard-roll-only. Premium conversion
remains issue #154-gated and was not implemented.

## Files changed

- `supabase/migrations/0016_stars_to_standard_roll_conversion.sql` — 162 lines
- `supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts` — 149 lines
- `SLICE-3-REPORT.md` — 122 lines

The Slice 3 implementation boundary contains only the two new 0016 files; this
required report is the sole additional artifact. No 0009, 0011, 0014, 0015,
frontend, server, task, or other existing file was modified. Nothing was
committed or staged, and all work remained offline.

## Verification

Command: `npm test -- 0016_stars_to_standard_roll_conversion` (exit 0)

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

Command: `npm test -- supabase/migrations` (exit 0)

```text
Test Files  10 passed (10)
Tests       79 passed (79)
```

Command: `npm test` (exit 1; documented sandbox-only history-guard failures)

```text
Test Files  3 failed | 111 passed (114)
Tests       17 failed | 1025 passed (1042)
```

All 17 failures were confined to the three expected immutable-history guards:

- `scripts/check-immutable-catalog-history.test.ts` — 4 failures
- `scripts/check-immutable-economy-history.test.ts` — 8 failures
- `scripts/check-immutable-migration-history.test.ts` — 5 failures

Every failure reported the exact environmental error:

```text
Error: spawnSync git EPERM
```

The 0016 suite passed all 7 tests inside the targeted, migration-wide, and full
runs. No other test failed. Unrelated React `act()` and Three.js messages were
warnings only.

## Review evidence

One broad adversarial review found no implementation-code P0/P1 defect and two
P1 static-test blind spots: the wallet call did not pin the negative debit sign,
and the privilege assertions did not explicitly reject an `authenticated`
grant on the arbitrary-user private engine. Both findings were fixed in one
test-only batch by asserting the complete canonical debit call and forbidding
private-engine grants to every API role. One focused re-review confirmed both
gaps closed, introduced no new P0/P1 finding, and satisfied the review stop
condition. The SQL did not change during review.

## Deviations

- The required aggregate `npm test` command was not green only because sandbox
  policy denied nested Git processes in the three documented history guards;
  no slice or unrelated functional test failed.
- The task's offline boundary prevented the Supabase skill's normal live
  changelog/documentation check and any hosted Supabase validation. The local
  canonical 0014/0015 contracts and repository tests were authoritative.
- The pinned external pattern catalog was not fetched because the task was
  offline. PostgreSQL's existing transaction, row-lock, and unique-ledger
  primitives were retained rather than adding a parallel pattern. The opted-in
  categorical no-fit evidence could not be written because
  `/home/donovanyohan/.codex/pattern-evidence` is read-only in this sandbox.

## Blockers and risks

- No implementation blocker remains within the requested offline,
  static-assertion scope.
- Static tests verify the migration text but do not apply it to PostgreSQL or
  directly exercise concurrent transactions. Live/local database execution was
  outside the binding verification commands.
- The 100-roll upper bound intentionally matches the existing pull-preparation
  ceiling and caps a single conversion at 16,000 Stars. Changing this product
  limit or the pinned `earned-collection@1` economy rate requires a reviewed
  migration rather than editing published history.
- Atomic crash safety relies on PostgreSQL function execution within one
  transaction: both ledger appends commit or both roll back. Retrying the same
  conversion key reconstructs the same two inner keys.

## Working tree evidence

`git status --porcelain` before this report was added showed the pre-existing
Slice 1/2/task artifacts plus only the two new 0016 files. Final status adds
`SLICE-3-REPORT.md`; `git diff --stat` remains empty because all slice artifacts
are untracked and nothing is staged.

## Provenance

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5
