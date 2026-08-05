# Slice 5 FIX — two latent base-rate consistency gaps

Focused re-review of your 0018 found no functional/security defect but two
latent trust-boundary gaps to close in one batch. Both are dormant today.

1. **SQL base-rate denominator (0018 ~L405).** The soft-pity base divides the
   signature tier weight by `banner.weight_scale`, but the actual base tier
   draw normalizes by `sum(weight_units)` over eligible tiers. Nothing
   enforces `weight_scale == sum(weight_units)` as a reusable invariant, so a
   hand-inserted ramp banner with mismatched scale gets an effective featured
   rate that is not the ramp target. Fix: derive the base from
   `sum(weight_units)` over ALL tiers of the banner (the same denominator the
   rank-0 draw uses) instead of `weight_scale`. Keep everything else
   identical. Update/extend the static tests to pin the new denominator.

2. **JS `baseFeaturedRate` unconsumed and un-cross-checked**
   (scripts/economy-simulator.js validateSoftPity ~L109, and the same gap in
   scripts/validate-production-economy.js ~L60). The field validates as any
   finite (0,1) but nothing consumes it — DB and sim both derive base from
   tier weights, so a disagreeing config validates clean and is silently
   meaningless. Fix: cross-check it — when a pity config carries a
   linear-rate-ramp softPity, require `baseFeaturedRate` to equal the
   signature/featured tier's weight fraction (weight ÷ total weight) within
   relative epsilon 1e-9, in BOTH validators. Clear error message naming both
   values. Extend both new test files: agreeing config accepted, disagreeing
   rejected, 'none' unaffected.

Boundaries: only supabase/migrations/0018_soft_pity_ramp.sql + its .test.ts,
scripts/validate-production-economy.js + its .test.ts,
scripts/economy-simulator.js + its .test.ts. No other file. No commits.

Verification (run, paste exact lines):
- `npm test -- 0018_soft_pity_ramp`
- `npm test -- supabase/migrations`
- `npm test -- scripts`  (or the correct filter for the two script test files)
- `node scripts/economy-simulator.js --check` (MUST stay exit 0)
- `node scripts/validate-production-economy.js` (MUST stay green)

Report: overwrite SLICE-5-REPORT.md as "rev 2 (post-review fix)" keeping rev 1
content under a heading, exact test output, provenance line.
