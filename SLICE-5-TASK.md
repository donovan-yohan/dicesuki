# Slice 5 — Soft-pity ramp (engine support, dormant)

## Context
Same worktree/branch. Slices 1–4 present, reviewed ship-ready, uncommitted
(0014 tickets, 0015 binding+reservation, 0016 conversion, 0017 commit/reveal —
0017's `prepare_pull_for_user` body is now CANONICAL). Full suite green (1057).

Design (PO-locked 2026-07-22): featured soft pity, linear rate ramp —
`{model:'linear-rate-ramp', startPull:41, perPullIncrement:0.005,
baseFeaturedRate:0.006}`, hard pity unchanged. Semantics (must EXACTLY mirror
the validated design sim in economy/drafts/monetization/simulate-premium-pity.mjs
— read its softPity wrapper): with featured attempt `n = selected_misses + 1`,
for `n >= startPull` the featured (selected signature) probability target is
`min(1, base + perPullIncrement * (n - startPull + 1))` where `base` is the
signature tier's weight fraction; implemented as an UPGRADE with excess
probability `excess = (target - base) / (1 - base)` applied BEFORE the normal
weighted tier draw, so the effective featured rate equals the target exactly
and the no-soft path is byte-identical to today. Upgrades use a distinct
sealed `resolution_reason` ('soft-pity'). Hard-pity due-checks stay untouched
and take precedence.

This slice ships engine SUPPORT only — dormant. No banner row enables it
(premium banners are #154-gated data; nothing sets the columns now).

## Task — two surfaces, one slice

### A) SQL: `supabase/migrations/0018_soft_pity_ramp.sql` + colocated `.test.ts`
1. Read first: 0011's seeded-draw helpers (`pull_seeded_uint32_below`,
   0011:553-607) and tier-draw region (0011:964-988) as inherited by 0017's
   canonical prepare body; 0015's pairing-constraint style for column checks.
2. Columns on `pull_banner_versions`: `soft_pity_model` (text, NULL or
   'linear-rate-ramp'), `soft_pity_start_pull` (int > 1),
   `soft_pity_per_pull_increment` (numeric > 0). All-or-none constraint
   (all three NULL, or model set with both numbers valid). Additional
   constraint: soft pity requires `selected_hard_guarantee_pull` non-null and
   `soft_pity_start_pull < selected_hard_guarantee_pull`. Existing rows
   backfill NULL (dormant).
3. CREATE OR REPLACE the canonical prepare body (0017's version — copy it,
   change ONLY the draw section): when the banner has a ramp AND the selected
   featured die is unowned AND the selected guarantee is not already due:
   compute target/excess as above with the SAME seeded RNG discipline (the
   upgrade roll consumes its own labeled draw from `pull_seeded_uint32_below`
   with a distinct purpose label/cursor so the no-soft draw sequence is
   UNCHANGED for NULL-ramp banners — pin this property); on upgrade, seal the
   featured result with `resolution_reason` 'soft-pity',
   advancing/resetting counters exactly as a natural featured hit does.
   NULL-ramp banners must produce byte-identical behavior to 0017.
4. Numeric care: do the target/excess arithmetic in `numeric`, compare via a
   single uint32 threshold draw (`floor(excess * 2^32)` convention — match
   however 0011 maps probabilities to uint32 draws; if 0011 uses
   `pull_seeded_uint32_below(scale)` weighted style, translate excess to that
   idiom faithfully and document the rounding direction).
5. Tests (static style): column constraints (all-or-none, start<hard,
   bounds); backfill NULL; upgrade block present + gated on unowned+not-due;
   distinct draw label; 'soft-pity' reason sealed; NULL-ramp path contains
   the unchanged draw sequence (assert the original draw text intact); no
   change to hard-pity due logic.

### B) JS: extend contracts/validators to ADMIT the ramp (nothing enables it)
1. Read: scripts/validate-production-economy.js (softPity asserts at ~186,
   ~429), scripts/economy-simulator.js (assert at ~183, and how
   `validateCandidateB` pins the frozen study), src/types/gacha.ts:49.
2. Change the validators so `softPity` accepts EITHER 'none' OR a structured
   `{model:'linear-rate-ramp', startPull, perPullIncrement, baseFeaturedRate}`
   object with the same bounds as the SQL constraints. The frozen study and
   seeded edition (softPity 'none') MUST still validate — immutability guards
   and `node scripts/economy-simulator.js --check` MUST stay green.
3. `src/types/gacha.ts`: replace the unused `softPity: number` with the
   accurate union type ('none' | ramp object).
4. Do NOT modify economy/production/editions/*.json, economy/simulations/**,
   or any frozen scenario/report.
5. Tests: extend the nearest existing test pattern for the validators (see
   scripts/*.test.ts) with: ramp object accepted, malformed ramp rejected
   (missing field, startPull >= hard pity where checkable, nonpositive
   increment), 'none' still accepted.

## Boundaries
Touch ONLY: the two new 0018 files, scripts/validate-production-economy.js,
scripts/economy-simulator.js, src/types/gacha.ts, plus test files for those
scripts following existing patterns. Nothing else. No edition JSON, no frozen
artifacts, no commits, offline. If economy-simulator.js changes risk the
frozen `--check`, run it after EVERY edit.

## Verification (run, paste exact lines)
- `npm test -- 0018_soft_pity_ramp`
- `npm test -- supabase/migrations`
- `node scripts/economy-simulator.js --check` (MUST exit 0)
- `node economy/drafts/monetization/simulate-premium-pity.mjs | head -5`
  (driver must still run — it imports economy-simulator.js exports)
- `npm test` (3 history-guard files fail `spawnSync git EPERM` sandbox-only —
  environmental; anything else is yours)

## Report
`SLICE-5-REPORT.md`: summary; files + line counts; exact test output incl.
--check; deviations; blockers/risks; provenance
`Authored by: Codex CLI 0.144.1 (codex exec), model: <model>`.
