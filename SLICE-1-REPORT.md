# Slice 1 Report — Roll-ticket item schema

## Summary

Added the offline Supabase schema foundation for durable `standard_roll` and
`premium_roll` ticket balances. The migration provides one nonnegative balance
per user and roll type, an append-only before/after ledger, user-scoped
idempotency, account-first serialization, and a service-role-only
`SECURITY DEFINER` record function that updates the ledger and balance in one
transaction. Authenticated users can read only their own balances and ledger
entries; API roles have no direct write path.

No banner binding, Stars conversion, pull consumption, checkout, entitlement,
frontend, server, or hosted Supabase behavior was added.

## Files changed

- `supabase/migrations/0014_roll_ticket_ledger.sql` — 282 lines
- `supabase/migrations/0014_roll_ticket_ledger.test.ts` — 162 lines
- `SLICE-1-REPORT.md` — 158 lines

No migration registry/index was changed. Repository search found no registry or
index file that migration 0013 had updated; migrations are discovered from the
directory and checked for contiguous numbering.

`SLICE-1-TASK.md` was pre-existing, untracked input and was not modified.

## Verification

### Final targeted test

Command:

```text
npm test -- 0014_roll_ticket_ledger
```

Exact result lines:

```text
Test Files  1 passed (1)
Tests       8 passed (8)
```

### Full test suite

Command:

```text
npm test
```

Exact result lines:

```text
Test Files  3 failed | 109 passed (112)
Tests       17 failed | 1007 passed (1024)
```

All 17 failures were confined to the three pre-existing immutable-history test
files. Each failed when its Node test tried to spawn a nested Git process in the
sandbox:

```text
Error: spawnSync git EPERM
```

The final 0014 test file passed within this full run (`8 tests`). The full-suite
baseline stated in the packet (666 passing) has drifted; the current suite
contains 1024 tests.

### Whole migration test set fallback

Because the full suite had the sandbox-only Git subprocess failures above, the
entire colocated migration test set was run as the packet's permitted fallback.

Command:

```text
npm test -- supabase/migrations
```

Exact result lines:

```text
Test Files  8 passed (8)
Tests       61 passed (61)
```

### Review evidence

One adversarial review found no P0/P1 SQL issue and identified two static-test
blind spots. They were fixed in one test-only pass by enforcing account-lock
ordering, complete idempotent-replay payload comparisons, and the exact two
own-row SELECT-only RLS policies. One focused re-review passed with no remaining
P0/P1/P2/P3 findings. The SQL did not change during review.

### Working-tree evidence

Command:

```text
git status --porcelain
```

Output before this report was written:

```text
?? SLICE-1-TASK.md
?? supabase/migrations/0014_roll_ticket_ledger.sql
?? supabase/migrations/0014_roll_ticket_ledger.test.ts
```

Final output includes this required report as an additional untracked file:

```text
?? SLICE-1-REPORT.md
?? SLICE-1-TASK.md
?? supabase/migrations/0014_roll_ticket_ledger.sql
?? supabase/migrations/0014_roll_ticket_ledger.test.ts
```

Command:

```text
git diff --stat
```

Output:

```text
(no output; all task artifacts are untracked and nothing was staged)
```

## Deviations

- The first development-time targeted run reported 1 failed and 7 passed
  because the new static test incorrectly expected three table-domain matches.
  The assertion was corrected to distinguish the two table constraints from the
  function validation; the SQL was unchanged. All final targeted and migration
  runs are green as shown above.
- The full suite is not all-green because 17 existing history-guard tests cannot
  spawn nested `git` under this sandbox (`EPERM`). The required full suite was
  nevertheless run to completion, and the entire migration suite passed.
- The migration was not applied to hosted Supabase and no network call to
  Supabase was made, as required by the packet.

## Unresolved blockers and risks

- No slice blocker remains.
- The SQL contract is covered by the repository's established static migration
  test style. It was not replayed against a live or hosted PostgreSQL instance,
  which was outside the requested verification commands and network boundary.
- Pattern-adoption telemetry was opted in but could not be recorded because the
  global evidence directory is read-only in this sandbox. This does not affect
  the repository artifacts or their verification.

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5
