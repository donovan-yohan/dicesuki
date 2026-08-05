# Slice 20 Report — Standard Banner Activation

## Summary

Slice 20 activates the permanent earned-collection pool for the standard pull
screen with migration `0029`. It appends `earned-collection-001@2` to the
existing `earned-collection` family, byte-copies the reviewed version-1
tiers, weights, item membership, duplicate values, resolution order, and
8/25/20 shallow guarantee thresholds, then binds the new row to
`banner_class='standard'` and `roll_type='standard_roll'`.

The new 1-pull and 10-pull offers cost exactly 1 and 10 standard-roll tickets.
All three soft-pity columns remain `NULL`. Because guarantee state is keyed by
account and banner family rather than banner version, preparation on `@2`
starts from the counters committed through `@1`; commit advances that same
family row, and `get_my_pull_pity` resolves version 2 as the active threshold
source.

This is a data-only migration. It contains no `CREATE OR REPLACE FUNCTION`,
does not modify an engine body, and does not introduce or enable a premium
banner. No hosted database mutation, deployment, commit, or push was performed.

## Deliverables

| File | Lines | Role |
|---|---:|---|
| `supabase/migrations/0029_standard_banner_activation.sql` | 347 | Appends the version-2 standard-roll banner, exact ticket offers, copied tiers/items, source guards, symmetric-difference checks, and NULL-safe postconditions. |
| `supabase/migrations/0029_standard_banner_activation.test.ts` | 212 | Static contract for data-only scope, exact client discovery shape, source-copy semantics, offer pricing, existing engine/pity seams, comment-stripped behavioral evidence, and review-fix role ordering. |
| `supabase/tests/0029_standard_banner_activation.test.sql` | 500 | Disposable-PostgreSQL suite for exact discovery, NULL audit, legacy `@1` Stars lifecycle, `@2` ticket reservation and commit, copy grants, counter continuity, pity thresholds, and premium fail-closed behavior. |
| `SLICE-20-REPORT.md` | this file | Scope, behavior, review closure, evidence, limitations, hashes, and provenance. |

## Data and runtime contract

### Discovery and binding

`fetchActiveStandardPullBanner` selects:

```text
id, banner_id, banner_version, banner_family_id, banner_class, roll_type
```

from `pull_banner_versions`, filters `banner_class='standard'` and
`roll_type='standard_roll'`, and orders by `banner_version` descending. The
behavioral suite repeats that exact relational projection, predicates, and
ordering and requires exactly `earned-collection-001@2`.

Version 2 retains:

- banner ID `earned-collection-001`;
- family ID `earned-collection`;
- the existing economy edition, source hash, hold policy, currencies, and
  buckets;
- identical four tiers totaling 100 weight units;
- identical 45 item rows and six selected-featured rows;
- hard guarantees of rare 8, epic 25, selected-featured-unowned 20;
- `NULL` soft-pity model, start, and increment.

Only the append-only version identity and funding binding change. Offers become
1 ticket for one pull and 10 tickets for ten pulls, satisfying
`target_cost == pull_count`.

### Counter and grant continuity

The behavioral suite seeds distinctive family counters, prepares and commits an
explicit `@1` pull, then prepares `@2`. It requires every `@2`
`*_misses_before` and `total_pulls_before` value to equal the committed `@1`
projection. After the ten-pull `@2` commit, it requires:

- ticket quantity unchanged at 11 during preparation;
- one exact commit debit of 10 tickets, leaving quantity 1;
- no additional Stars debit from the `@2` path;
- exactly ten new pull-sourced dice-copy rows for the `@2` session;
- the family guarantee row and pity read to equal the `@2` session projection;
- pity metadata to resolve `earned-collection-001@2`, thresholds 8/25/20, and
  all three soft-pity fields as `NULL`.

### Actual legacy schema behavior

Migration `0015` backfilled the existing `earned-collection-001@1` row as
`banner_class='standard'` while leaving `roll_type=NULL`. The pairing constraint
explicitly permits that legacy standard/NULL combination. The current
preparation engine routes a NULL roll type through the promotional-Stars
balance/hold branch; its original offers remain 160 Stars for one pull and
1600 Stars for ten pulls. The commit engine correspondingly debits promotional
Stars. Therefore callers that explicitly name `@1` may still prepare it, even
though standard-banner discovery deliberately excludes it.

The behavioral SQL exercises that actual public API shape by preparing and
committing one `@1` pull for 160 promotional Stars before the `@2` ticket
scenario. That SQL has **not run against PostgreSQL in this environment**; the
schema and engine paths are statically validated here, and live database
execution remains required.

### NULL-hole and premium audit

The migration uses `IS DISTINCT FROM` or explicit `IS [NOT] NULL` checks for
nullable comparisons. It audits the copied version policy, ticket offers,
tiers, items, selected membership, and dormant soft-pity triple. The static
test strips SQL comments before checking executable behavioral control flow, so
comments alone cannot satisfy the evidence contract.

Premium remains fail-closed. The behavioral suite inserts a rollback-only
premium fixture and requires live `prepare_pull` execution to fail with
SQLSTATE `55000` and the existing issue-154 guard message. No premium production
row or engine change is part of migration `0029`.

## Adversarial review closure

The required adversarial review found two valid test-harness issues:

1. **P1 — temporary-table ownership.** `slice20_lifecycle_ctx` was initially
   created by the owner before `SET ROLE authenticated`, while authenticated
   code inserted and updated it.
2. **P2 — comment-satisfiable static checks.** Some behavioral assertions read
   raw SQL and could be satisfied by comments or message text without an
   executable control-flow assertion.

Both findings were fixed in one batch:

- the temporary lifecycle table is now created after
  `SET LOCAL ROLE authenticated`, so the role that inserts and updates it owns
  it; privileged session/projection assertions remain after `RESET ROLE`;
- all behavioral static assertions use comment-stripped executable SQL;
- claim messages are required inside executable
  `IF ... THEN RAISE EXCEPTION` structures where applicable;
- the static contract explicitly checks authenticated create/insert/update
  ordering before reset.

The focused re-review of those changed hunks closed P1/P2 with no unresolved
P0/P1 finding. The focused 0029 Vitest and diff-check gates remained green
after the batch fix.

## Test evidence

### Final focused Slice 20 contract

`npm test -- 0029`

Exit code: `0`

```text
> vitest 0029
 RUN  v4.0.8
 ✓ supabase/migrations/0029_standard_banner_activation.test.ts (6 tests) 9ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  533ms
```

This Vitest suite statically validates the migration plus the
comment-stripped, executable source of the behavioral SQL. It does **not**
execute that SQL against PostgreSQL.

### Final migration Vitest summary

`npm test -- supabase/migrations`

Exit code: `0`

```text
Test Files  23 passed (23)
Tests  186 passed (186)
Duration  2.55s
```

### Report-time per-file migration replay

The command was replayed to capture every file line. Timing naturally differed
from the authoritative final summary above.

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0028_sku_fulfillment.test.ts (11 tests) 16ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0029_standard_banner_activation.test.ts (6 tests) 11ms
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 14ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 25ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 22ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 13ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 11ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 15ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 10ms
 ✓ supabase/migrations/0025_pity_read.test.ts (5 tests) 9ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 9ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 11ms
 ✓ supabase/migrations/0026_sku_registry.test.ts (7 tests) 9ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 12ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms
 ✓ supabase/migrations/0027_paid_stars_bucket.test.ts (6 tests) 8ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 11ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 Test Files  23 passed (23)
      Tests  186 passed (186)
   Start at  00:17:19
   Duration  2.58s
```

### Database behavioral harness attempt

`npm run test:db:supabase`

Exit code: `1`

```text
Error: spawnSync docker EPERM
code: 'EPERM'
syscall: 'spawnSync docker'
spawnargs: [ 'version' ]
```

The harness stopped at its initial Docker version probe, before applying a
migration or executing any SQL suite. No usable `initdb`, `postgres`, `pg_ctl`,
`psql`, or existing PostgreSQL socket alternative was available. Consequently,
`supabase/tests/0029_standard_banner_activation.test.sql` remains unexecuted
against PostgreSQL here and must be run in a Docker-capable or hosted disposable
database environment before deployment.

### Focused lint and formatting

Focused ESLint:

```text
ESLint: No issues found
```

Focused `git diff --check` completed with exit code `0` and no output.

## File integrity

```text
687437517078d084a69d3e5ae28ac1623d7a00875d065a877b72f89db64b9c79  supabase/migrations/0029_standard_banner_activation.sql
d37b2820cf10700caee81d298336392bb2a71cb64930185293fd7bac4f75055e  supabase/migrations/0029_standard_banner_activation.test.ts
3bc002c8244d681e2e7233ad6f57f1057da85cf7b528a574f0ae9d4d14b686d9  supabase/tests/0029_standard_banner_activation.test.sql
```

These are uncommitted working-tree files. The branch is
`econ/20-banner-activation`, starting at
`4eefe28105656b3152e377b5c734809328748a0d`; the three deliverables and this
report are untracked. This is not exact-head evidence, and no exact-head claim
is made.

## Remaining proof and operational status

- Run `npm run test:db:supabase` in an environment that can start PostgreSQL;
  the static Vitest contract is not a substitute for database execution.
- Do not apply migration `0029` to hosted Supabase until that behavioral suite
  passes.
- No hosted Supabase state, production flag, premium path, deployment, branch
  history, or remote repository state was mutated.
- No commit was created.

## Provenance

- Substantive implementation, adversarial-review fixes, and focused re-review:
  exact model `gpt-5.6-terra`, effort `high`.
- Orchestration and release decision: exact model `gpt-5.6-sol`, effort `high`.
