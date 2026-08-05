# Slice 6 FIX Report — 0019 three-valued CHECK repair

## Summary

Added migration `0019_soft_pity_constraint_fix.sql` without modifying immutable
`0018`. The migration drops and recreates the soft-pity all-or-none constraint
with an explicit `soft_pity_model is not null` guard. It also independently
repairs the start-before-hard constraint with an explicit
`soft_pity_start_pull is not null` guard before the nullable comparison.

Added the colocated static migration test and one `CLAUDE.md` Gotchas line.
The behavioral sensor `supabase/tests/0018_soft_pity_ramp.test.sql`, existing
migrations, the database harness, and CI were not modified. Docker was not run,
as required by the task packet.

## Audit table

| Migration | Constraint or CHECK seam | Verdict |
| --- | --- | --- |
| 0014 | `roll_ticket_balances.roll_type` inline allowlist | Safe: `roll_type` is `NOT NULL`. |
| 0014 | `roll_ticket_balances.current_quantity` inline lower bound | Safe: `current_quantity` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries.roll_type` inline allowlist | Safe: `roll_type` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries.delta_quantity` inline nonzero check | Safe: `delta_quantity` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries.quantity_before` inline lower bound | Safe: `quantity_before` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries.quantity_after` inline lower bound | Safe: `quantity_after` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries_quantity_chain` | Safe: all three compared quantity columns are `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries_reason_code` | Safe: `reason_code` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries_idempotency_key` | Safe: `idempotency_key` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries_provenance_object` | Safe: `provenance` is `NOT NULL`. |
| 0014 | `roll_ticket_ledger_entries_provenance_size` | Safe: `provenance` is `NOT NULL`. |
| 0015 | `pull_banner_versions_banner_class` | Safe: `banner_class` is `NOT NULL`. |
| 0015 | `pull_banner_versions_roll_type` | Safe and intentional: NULL means Stars-funded; non-NULL values are allowlisted. |
| 0015 | `pull_banner_versions_class_roll_type_pairing` | Safe: the standard arm explicitly accepts NULL and the premium equality is preceded by `roll_type is not null`. |
| 0016 | All constraints | No CHECK constraints are introduced by 0016. |
| 0017 | `pull_session_transitions.kind` inline allowlist | Safe: `kind` is `NOT NULL`. |
| 0017 | `pull_session_transitions_provenance_object` | Safe: `provenance` is `NOT NULL`. |
| 0017 | `pull_session_transitions_provenance_size` | Safe: `provenance` is `NOT NULL`. |
| 0018 | `pull_banner_versions_soft_pity_model` | Safe: the NULL dormant state is explicitly accepted; every non-NULL value must match the allowlist. |
| 0018 | `pull_banner_versions_soft_pity_all_or_none` configured-model arm | Real hole fixed in 0019: `soft_pity_model is not null` now precedes the equality. |
| 0018 | `pull_banner_versions_soft_pity_all_or_none` increment bounds | Safe: `soft_pity_per_pull_increment is not null` precedes `> 0` and `NOT IN`. |
| 0018 | `pull_banner_versions_soft_pity_before_hard_guarantee` | Constraint-local hole fixed in 0019: `soft_pity_start_pull is not null` now precedes `<`; the nullable hard guarantee was already guarded. |
| 0018 | `sealed_pull_results_resolution_reason_check` | Safe: `resolution_reason` is `NOT NULL`. |

No real 0014–0017 hole of the requested nullable-comparison-in-an-OR-arm class
was found, so 0019 repairs only the two affected 0018 constraints.

## Verification

Command: `npm test -- 0019_soft_pity_constraint_fix` (exit 0)

```text
> dicesuki@0.1.0 test
> vitest 0019_soft_pity_constraint_fix


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  22:15:12
   Duration  538ms (transform 26ms, setup 103ms, collect 8ms, tests 4ms, environment 329ms, prepare 6ms)
```

Command: `npm test -- supabase/migrations` (exit 0)

```text
> dicesuki@0.1.0 test
> vitest supabase/migrations


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 10ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 9ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 14ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 11ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 17ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 12ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 8ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 8ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms

 Test Files  13 passed (13)
      Tests  106 passed (106)
   Start at  22:15:17
   Duration  1.38s (transform 234ms, setup 1.54s, collect 275ms, tests 122ms, environment 5.46s, prepare 91ms)
```

`git diff --check` also exited 0 with no output.

## Review

The single adversarial review found one P2 static-test bypass: raw-source
regexes would still match SQL wrapped in comments. The test now strips block
and line comments before checking executable SQL. The permitted focused
changed-hunk re-review found no remaining P0/P1/P2 findings.

## Provenance

Authored by: Codex CLI 0.144.1 (orchestrator), model: GPT-5; delegated implementation and review workers.
