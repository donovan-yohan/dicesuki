# Slice 4 Report — Pull commit/reveal terminal boundary

## Summary

Added the append-only terminal boundary for prepared pulls. The new
`pull_session_transitions` table permits exactly one immutable `committed` or
`cancelled` row per session, binds transition ownership to the source session,
forces RLS, and exposes authenticated users only to their own transition rows.

All five canonical active-hold sums now require both a live time window and no
terminal transition. The same terminal rule also releases the family-level
preparation gate and the entitlement snapshot guard, so a committed session's
own Star/ticket debit and entitlement grants are not rejected by its former
reservation.

The authenticated self-only commit RPC locks `wallet_accounts` first, rejects
premium banners, appends the committed transition before settlement, and uses
that unique append as the exactly-once guard. It debits promotional Stars or
standard-roll tickets only through the canonical ledger functions, advances
guarantees from the sealed session projections, grants non-duplicate outcomes
through `user_entitlements`, aggregates duplicate Dust into one deterministic
wallet append, and returns the seed, nonces, results, and commitment fields
needed for client verification. Exact committed replays return the same reveal.

Cancellation appends only a `cancelled` transition for a live owned session;
it has no refund, ledger, grant, guarantee, result, nonce, or seed path. A
separate authenticated getter returns reveals only for owned committed sessions.

## Files changed

- `supabase/migrations/0017_pull_commit_reveal.sql` — 1,362 lines
- `supabase/migrations/0017_pull_commit_reveal.test.ts` — 383 lines
- `SLICE-4-REPORT.md` — 141 lines

The Slice 4 implementation boundary contains only the two new 0017 files; this
binding report is the sole additional artifact. No 0009–0016, frontend,
`server/`, edge-function, task, or other existing file was modified. Nothing
was committed or staged, and all work remained offline.

Final implementation SHA-256 values:

```text
5cba5177fd29815631bbd5a654359a6f6308bc3c773c23f03af7c5f5cad353b1  supabase/migrations/0017_pull_commit_reveal.sql
92b4fd5692f96bd91f74681075a3cc0e574e194a8b9bad8729d9a82a2ad657a1  supabase/migrations/0017_pull_commit_reveal.test.ts
```

## Verification

Command: `npm test -- 0017_pull_commit_reveal` (exit 0)

```text
Test Files  1 passed (1)
Tests       15 passed (15)
```

Command: `npm test -- supabase/migrations` (exit 0)

```text
Test Files  11 passed (11)
Tests       94 passed (94)
```

Command: `npm test` (exit 1; documented sandbox-only history-guard failures)

```text
Test Files  3 failed | 112 passed (115)
Tests       17 failed | 1040 passed (1057)
```

All 17 failures were confined to the three expected immutable-history guards:

- `scripts/check-immutable-catalog-history.test.ts` — 4 failures
- `scripts/check-immutable-economy-history.test.ts` — 8 failures
- `scripts/check-immutable-migration-history.test.ts` — 5 failures

Every failure reported the exact environmental error:

```text
Error: spawnSync git EPERM
```

The 0017 suite passed all 15 tests in the targeted, migration-wide, and full
runs. No other test failed. Unrelated React `act()` and Three.js messages were
warnings only. An untracked-file whitespace check reported no errors for either
0017 file.

## Review evidence

One broad adversarial review found no P0/P1 correctness, concurrency, security,
RLS, replay, funding, guarantee, entitlement, Dust, or seed-secrecy defect. It
found two P2 static-test gaps: private-engine ownership predicates were not
asserted directly, and copied 0015 canonical bodies were not protected against
unrelated drift.

Both findings were fixed in one batch. The tests now assert the private getter,
commit, and cancel session scopes and compare all four copied 0015 functions to
their canonical bodies after removing only the added terminal-exclusion
clauses. That comparison exposed and removed an alias-only prepare-body drift.
The permitted focused re-review reported no findings, and the final targeted
suite passed 15/15.

## Deviations

- The aggregate `npm test` command was not green only because sandbox policy
  denied nested Git processes in the three documented history guards with
  `Error: spawnSync git EPERM`; no functional or Slice 4 test failed.
- The task's offline boundary precluded hosted Supabase validation, current
  documentation lookup, and fetching the pinned external pattern documents.
  PostgreSQL's existing transaction, row-lock, unique-constraint, RLS, and
  canonical ledger primitives remained authoritative.
- The task explicitly requested static-style tests. No migration-application or
  concurrent-transaction PostgreSQL harness was added or run.
- The local pattern audit recorded a categorical no-fit for importing a
  parallel state-machine implementation because PostgreSQL already provides the
  required primitive. The opted-in evidence write failed exactly:
  `error: [Errno 30] Read-only file system: '/home/donovanyohan/.codex/pattern-evidence'`.

## Blockers and risks

- No implementation blocker remains within the requested offline,
  static-assertion scope.
- Static tests prove migration text, canonical-body preservation, ordering,
  privileges, and seed-path constraints, but they do not execute PostgreSQL or
  directly schedule concurrent transactions. A disposable/live database apply
  remains the residual validation gap outside the binding commands.
- Premium random pulls remain deliberately disabled pending issue #154 in both
  prepare and commit paths.
- Committed reveal history intentionally exposes the 32-byte RNG seed and
  per-result nonces only after the immutable committed transition. Cancelled or
  merely expired sessions have no reveal path.

## Working tree evidence

Before this report was added, `git status --porcelain` showed the pre-existing
Slice 1–3/task artifacts plus only the two new 0017 files. Final status adds
`SLICE-4-REPORT.md`; `git diff --stat` remains empty because all slice artifacts
are untracked and nothing is staged.

## Provenance

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5
