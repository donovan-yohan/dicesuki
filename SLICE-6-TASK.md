# Slice 6 — Behavioral live-DB suites for migrations 0014–0018

## Context
- Worktree `/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`, branch `feat/economy-db-behavior` (off updated main — migrations 0014–0018 are MERGED and already apply cleanly in the harness).
- The repo HAS a live-postgres harness: `scripts/test-supabase-postgres.mjs` (docker container, applies all migrations sorted, then runs `supabase/tests/*` suites sorted; CI runs it at ci.yml:49). Baseline: "passed 18 sorted migrations and 9 sorted test suites".
- Suite pattern: `supabase/tests/00XX_name.test.sql` (psql, ON_ERROR_STOP, assertion style — study 0011_earned_pull_preparation.test.sql, 44.7K, it already solves auth.users seeding, auth.uid()/role simulation, banner/offer/catalog seeding for the pull path) + optional `00XX_name.test.mjs` (node `run({psql, psqlAsync})` for concurrency — study 0009's).

## Task
Author behavioral suites covering the money-path scenarios the static tests cannot. Files (follow naming/sorting conventions):
- `supabase/tests/0014_roll_ticket_ledger.test.sql` (+ `.test.mjs` for the concurrency case)
- `supabase/tests/0015_banner_roll_type_binding.test.sql`
- `supabase/tests/0016_stars_to_standard_roll_conversion.test.sql`
- `supabase/tests/0017_pull_commit_reveal.test.sql` (+ `.test.mjs` if concurrency cases fit better there)
- `supabase/tests/0018_soft_pity_ramp.test.sql`

### Required scenarios
0014: grant + spend via `record_roll_ticket_ledger_entry`; no-negative rejected; exact replay returns original row (no double effect); payload-drift replay fails 22023; cross-roll_type key reuse rejected; RLS: authenticated user reads own rows only, cannot write directly; concurrent identical replays (mjs) yield one ledger row.
0015: seed a `standard_roll`-bound banner (mirror 0011's seeding; offer target_cost == pull_count); ticket-funded prepare RESERVES — `roll_ticket_balances.current_quantity` unchanged, second prepare exceeding available rejected; after hold expiry capacity frees with zero ticket loss; ticket holds do NOT block legacy Stars pulls and vice versa (pool isolation, both directions); premium-class banner prepare rejected; legacy NULL-roll_type banner still debits nothing at prepare and reserves Stars.
0016: conversion debits 160×N promotional Stars + credits N tickets atomically; replay returns original receipt (no re-debit); same-key different-count rejected; insufficient available Stars rejected INCLUDING the case where the shortfall is due to an active Stars pull hold (held Stars not convertible).
0017 (the money core): full lifecycle — prepare (Stars-funded) → commit: Stars debited exactly held_amount, `pull_guarantee_states` advanced to projected, non-dupe entitlements granted, dupe Dust credited to earned bucket, reveal payload returned; VERIFY THE COMMITMENT: recompute sha256 per revealed result (nonce + fields per 0011's `pull_result_commitment` scheme) and match `commitment_sha256` + root — do this in SQL or mjs, exactly as a verifying client would; replay of commit returns identical receipt with zero additional ledger/entitlement/guarantee effects; cancel-then-commit rejected; commit-then-cancel rejected; expired-session commit rejected; cross-user commit and cross-user reveal getter rejected; ticket-funded variant: commit debits tickets (balance drops by held_amount) exactly once; after commit, a NEW same-family prepare works (terminal exclusion frees the family gate).
0018: deterministic activation — banner with `soft_pity_model='linear-rate-ramp'`, `soft_pity_start_pull=2`, `soft_pity_per_pull_increment=1.0` (target hits 1.0 at attempt 2): first pull non-featured (thanks to... if pull 1 randomly hits featured at 0.6%, reroll-proof the test: use a fresh user per attempt or accept either-reason; design the assertion so it cannot flake — e.g. prepare 2 pulls in one session for a user whose attempt counter starts at 0 and assert the second sealed result is the featured die with `resolution_reason='soft-pity'` UNLESS result 1 already featured naturally, in which case assert reason ordering per engine; prefer constructing certainty: set signature tier weight so base draw cannot hit — weight_units must be >=1 per constraints, so instead assert: at attempt 2 the featured award exists with reason in ('soft-pity','base') and featured is GUARANTEED by target=1.0 — the unconditional claim "attempt 2 always yields featured" IS deterministic, assert that); constraint checks live: all-or-none violated → rejected, start >= hard pity → rejected; NULL-ramp banner behaves exactly as before (no 'soft-pity' reasons ever sealed).

### Constraints
- Read the actual function signatures/behaviors from the merged migrations — do not trust this summary where they disagree.
- Suites must be deterministic — no assertions on random outcomes except where the engine makes them certain (hard guarantees, target=1.0 ramp, structural facts). If a scenario cannot be made deterministic, cover the deterministic envelope and document the residual.
- Follow the existing suites' cleanup/isolation discipline (fresh UUIDs per scenario; do not corrupt state other suites depend on; suites run in sorted order after ALL migrations).
- DO NOT modify migrations, the harness script, or CI. Only add the new files under supabase/tests/.
- You CANNOT run docker in your sandbox. Do NOT attempt `npm run test:db:supabase`. Validate what you can statically (SQL syntax discipline, matching function signatures against the migration sources) and via any pure-node checks. The orchestrator runs the harness outside and will send back failures for a fix pass — write the suites expecting that loop.

## Report
`SLICE-6-REPORT.md`: summary; files + line counts; per-file scenario checklist (which required scenario lands where); known risks/assumptions to check when the harness runs; provenance `Authored by: Codex CLI 0.144.1 (codex exec), model: <model>`.
