# Slice 6 FIX — 0019 constraint repair (three-valued CHECK hole)

Your 0018 behavioral suite CORRECTLY caught a real merged bug (good): the live
harness failed with "Soft-pity values without a model were accepted".

Root cause in merged `supabase/migrations/0018_soft_pity_ramp.sql`,
`pull_banner_versions_soft_pity_all_or_none`: with `soft_pity_model` NULL and
`soft_pity_start_pull`/`soft_pity_per_pull_increment` set, arm 1 is false
(start not null) and arm 2 evaluates `NULL = 'linear-rate-ramp'` → NULL, so
the whole expression is `false OR NULL` = NULL and the CHECK passes.
Postgres three-valued logic — the identical class you already fixed on the
premium pairing constraint in 0015 (which starts `roll_type is not null and`).

## Task
1. NEW migration `supabase/migrations/0019_soft_pity_constraint_fix.sql`
   (0018 is merged and immutable — the history guard forbids editing it):
   drop `pull_banner_versions_soft_pity_all_or_none` and re-add it with arm 2
   prefixed `soft_pity_model is not null and ...` (mirror the 0015 pairing
   constraint pattern exactly). Audit the OTHER 0018 constraints
   (`..._soft_pity_model`, the start<hard check, increment bounds) for the
   same NULL hole and fix any that have it in the same migration; state your
   audit conclusion per constraint in comments. Also audit 0014–0017
   constraints for the same class (equality/comparison on a nullable column
   inside an OR arm) — report findings; fix only if a real hole exists.
2. Colocated `supabase/migrations/0019_soft_pity_constraint_fix.test.ts`
   static test in the established style: pins the `is not null` guard and the
   drop-and-recreate.
3. Add one line to the repo root `CLAUDE.md` **Gotchas** section: CHECK
   constraints with nullable columns need explicit `is not null` guards —
   three-valued logic makes `NULL = 'x'` arms pass silently (caught live by
   supabase/tests harness).
4. Do NOT modify the behavioral suite `supabase/tests/0018_soft_pity_ramp.test.sql`
   — it is the failing sensor and must pass unchanged once 0019 lands.

Boundaries: the two new 0019 files + the one CLAUDE.md line. No harness/CI
edits. Cannot run docker — orchestrator reruns the harness.

Verification you CAN run: `npm test -- 0019_soft_pity_constraint_fix`,
`npm test -- supabase/migrations` (paste exact result lines).

Report: `SLICE-6-FIX-REPORT.md` — audit table (constraint → verdict), test
output, provenance line.
