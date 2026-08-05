# Slice 5 Report — rev 2 (post-review fix)

## Rev 2 summary

Closed both dormant base-rate consistency gaps from the focused review without
changing the ramp's ordering, RNG, resolution, or counter behavior.

The SQL engine now derives the fixed signature-tier base from that tier's
`weight_units` divided by `sum(weight_units)` over every tier belonging to the
banner. It no longer uses `banner.weight_scale` for this calculation, so the
ramp target remains aligned with the rank-0 tier draw even for a hand-inserted
banner whose declarative scale does not match its tier weights.

Both JavaScript validators now derive the same signature-tier weight fraction
from the tier array and require a configured linear ramp's
`baseFeaturedRate` to match within relative epsilon `1e-9`. Mismatch errors
include both `configured=<value>` and `derived=<value>`. Explicit tests prove
that `none` remains unaffected, `0.01` agrees with the current `1 / 100`
signature fraction, and the old `0.006` value is rejected in both validators.

## Rev 2 files changed

- `supabase/migrations/0018_soft_pity_ramp.sql` — 733 lines
- `supabase/migrations/0018_soft_pity_ramp.test.ts` — 238 lines
- `scripts/validate-production-economy.js` — 818 lines
- `scripts/validate-production-economy.test.ts` — 327 lines
- `scripts/economy-simulator.js` — 1,037 lines
- `scripts/economy-simulator.test.ts` — 247 lines
- `SLICE-5-REPORT.md` — overwritten as rev 2 with rev 1 preserved below

No other file was edited for this correction. The pre-existing
`src/types/gacha.ts` Slice 5 change remains untouched. Nothing was staged or
committed.

Final rev 2 implementation SHA-256 values:

```text
b718b2ba643cf145af6927aa64eec38b2c6d90e8be3340c03961b208d4ea4152  supabase/migrations/0018_soft_pity_ramp.sql
1d65a1f10006779b0405898aac53bc65833f86e71e50b676ab005a260bcc99fb  supabase/migrations/0018_soft_pity_ramp.test.ts
99df56337b9896757d5b34458701c3c5eca3b6816fcda0882e0c011a5ed5ffca  scripts/validate-production-economy.js
956348fcf9de5eb12b086c45bf1798c7a4a3c91444b1a7b0e6f516c41536e257  scripts/validate-production-economy.test.ts
4d3916fe8ed1ff1fd0578bb48429629a746f0e3247ccbfb163a92c80cc7c9d16  scripts/economy-simulator.js
2b71361618ce97f6c377acc0978b615edea5987002c9eedb1a7e38b80d49da57  scripts/economy-simulator.test.ts
```

## Rev 2 verification

Command: `npm test -- 0018_soft_pity_ramp` (exit 0)

```text
> dicesuki@0.1.0 test
> vitest 0018_soft_pity_ramp


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 8ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  02:47:56
   Duration  534ms (transform 32ms, setup 99ms, collect 14ms, tests 8ms, environment 318ms, prepare 6ms)
```

Command: `npm test -- supabase/migrations` (exit 0)

```text
> dicesuki@0.1.0 test
> vitest supabase/migrations


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 9ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 14ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 15ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 21ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 14ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 27ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 9ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 7ms

 Test Files  12 passed (12)
      Tests  103 passed (103)
   Start at  02:48:01
   Duration  1.38s (transform 351ms, setup 1.39s, collect 391ms, tests 146ms, environment 4.93s, prepare 78ms)
```

Command:
`npm test -- scripts/economy-simulator.test.ts scripts/validate-production-economy.test.ts`
(exit 0; the task-authorized correct filter for the two script test files)

```text
> dicesuki@0.1.0 test
> vitest scripts/economy-simulator.test.ts scripts/validate-production-economy.test.ts


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ scripts/validate-production-economy.test.ts (10 tests) 24ms
 ✓ scripts/economy-simulator.test.ts (9 tests) 2877ms
     ✓ reproduces the committed fixed-seed report and its required decision outputs  2867ms

 Test Files  2 passed (2)
      Tests  19 passed (19)
   Start at  02:48:07
   Duration  3.46s (transform 125ms, setup 200ms, collect 107ms, tests 2.90s, environment 662ms, prepare 11ms)
```

Command: `node scripts/economy-simulator.js --check` (exit 0)

```text
Verified 1 immutable economy simulation scenario(s)
```

Command: `node scripts/validate-production-economy.js` (exit 0)

```text
Verified 1 immutable production economy edition(s)
```

Additional exact-head checks:

```text
git diff --check
# exit 0, no output

node --check scripts/economy-simulator.js
# exit 0, no output

node --check scripts/validate-production-economy.js
# exit 0, no output
```

## Rev 2 review evidence

The required adversarial review checked the two important bypass risks:

- the SQL denominator is a correlated subquery over all banner tiers and is not
  a window aggregate accidentally restricted by the selected-tier predicate;
- both production guarantee paths and the simulator path derive the expected
  fraction from tier weights, not from `weightScale`.

It also confirmed the symmetric relative comparison, clear two-value error,
explicit accept/reject/`none` tests, unchanged soft-pity ordering and draw
logic, clean JavaScript syntax, and a clean diff check. No P0/P1 or other valid
follow-up finding remained, so review closed before the full required gates.

## Rev 2 deviations

- Used the task-authorized precise filter
  `npm test -- scripts/economy-simulator.test.ts scripts/validate-production-economy.test.ts`
  instead of the broader `npm test -- scripts`; this ran exactly the two
  changed script test files and stayed green.
- No PostgreSQL apply or statistical runtime sampling was added because the
  binding fix packet requires static migration coverage plus the existing
  executable validators.

## Rev 2 blockers and risks

No implementation or verification blocker remains within the binding task.
The dormant migration behavior remains statically tested rather than applied
to a disposable/live PostgreSQL instance, matching the original Slice 5 scope.
No banner enables the ramp.

## Rev 2 provenance

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5

## Rev 1 content

### Slice 5 Report — Dormant soft-pity ramp support

### Summary

Added dormant `linear-rate-ramp` support to the pull engine without enabling it
on any banner. `pull_banner_versions` now has nullable, all-or-none soft-pity
configuration with a start after pull one, a positive finite increment, and a
required selected hard guarantee later than the ramp start. Existing rows
remain NULL and therefore retain canonical 0017 behavior.

The preparation engine preserves selected hard-pity precedence, then performs
one domain-separated rejection-sampled upgrade draw when a configured ramp is
active and the selected featured item remains unowned. It computes the fixed
full-banner signature base, linear target, and conditional excess in
PostgreSQL `numeric`; a billion-point threshold is floored, so rounding is
downward by less than `1e-9`. A normal ramp upgrade seals `soft-pity`. At
rare/epic hard-pity intersections, the item may upgrade but the hard-guarantee
reason retains precedence, matching the locked design driver. Natural and
upgraded selected hits share the canonical duplicate and counter handling.

The inherited sealed-result constraint now admits `soft-pity`, and the seeded
helper admits only one new draw label, `soft-pity-upgrade`. NULL-ramp banners
consume no extra RNG draw; the canonical tier/item draw block remains
byte-identical to 0017.

Both economy validators now admit either `none` or an exact-key structured
ramp with `model`, `startPull`, `perPullIncrement`, and `baseFeaturedRate`.
They reject malformed, non-finite, nonpositive, out-of-range, or hard-pity-
overlapping values. Frozen study/edition artifacts remain unchanged and green;
edition 0001 remains protected by its SHA guard. `PityConfig.softPity` now uses
the accurate TypeScript union.

### Files changed

- `supabase/migrations/0018_soft_pity_ramp.sql` — 728 lines
- `supabase/migrations/0018_soft_pity_ramp.test.ts` — 233 lines
- `scripts/validate-production-economy.js` — 800 lines
- `scripts/validate-production-economy.test.ts` — 309 lines
- `scripts/economy-simulator.js` — 1,022 lines
- `scripts/economy-simulator.test.ts` — 233 lines
- `src/types/gacha.ts` — 163 lines
- `SLICE-5-REPORT.md` — 191 lines

No production edition JSON, simulation scenario/report, draft, prior migration,
or other file was modified. Nothing was committed or staged. Work remained
offline.

Final implementation SHA-256 values:

```text
99a52e884ffcbeb17c06fea974f8d0dc058bce841c5bf6ea3b17cc171b0d6de1  supabase/migrations/0018_soft_pity_ramp.sql
aeb88a8efa109ad2375645634b3468dff5b35c2e52b8e4c0c5fe5abe34257845  supabase/migrations/0018_soft_pity_ramp.test.ts
e8a90a1735dd11c5353043639df2e34c59c5f5bc9938d43dce3b096df3d43670  scripts/validate-production-economy.js
6ff8d57fdf2b22ee6320471f2b0727465e31b42b8380b2ced82b963b5df4f1b0  scripts/validate-production-economy.test.ts
3fc02f823daad5f2aceed56f7d1aaef81816100eee335c8dd268343a82eb21c6  scripts/economy-simulator.js
3cd69f2de71f8f8f227a74ea91cf3d484fed163f41e3b46f3cb584f357685e42  scripts/economy-simulator.test.ts
5db1f73824b69d8a654a9ba89977685f7c23eab7f5767361e2e8ea77963b1596  src/types/gacha.ts
```

### Verification

Command: `npm test -- 0018_soft_pity_ramp` (exit 0)

```text
Test Files  1 passed (1)
Tests       9 passed (9)
```

Exact final timing lines:

```text
✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 8ms
Duration  538ms (transform 32ms, setup 98ms, collect 14ms, tests 8ms, environment 323ms, prepare 5ms)
```

Command: `npm test -- supabase/migrations` (exit 0)

```text
Test Files  12 passed (12)
Tests       103 passed (103)
```

Exact final timing lines:

```text
✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 8ms
Duration  1.58s (transform 340ms, setup 1.48s, collect 382ms, tests 155ms, environment 5.90s, prepare 127ms)
```

Command: `node scripts/economy-simulator.js --check` (exit 0)

```text
Verified 1 immutable economy simulation scenario(s)
```

Command: `node economy/drafts/monetization/simulate-premium-pity.mjs | head -5`
(exit 1 with pipe failure propagated)

```text
Error: Cannot find module '/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets/economy/drafts/monetization/simulate-premium-pity.mjs'
  code: 'MODULE_NOT_FOUND',
  requireStack: []
```

Command: `npm test` (exit 1; documented sandbox-only history-guard failures)

```text
Test Files  3 failed | 113 passed (116)
Tests       17 failed | 1054 passed (1071)
Duration    15.61s (transform 3.27s, setup 13.12s, collect 8.13s, tests 17.91s, environment 53.59s, prepare 830ms)
```

All 17 failures were confined to the three expected immutable-history guards:

- `scripts/check-immutable-catalog-history.test.ts` — 4 failures
- `scripts/check-immutable-economy-history.test.ts` — 8 failures
- `scripts/check-immutable-migration-history.test.ts` — 5 failures

Every failure reported the exact environmental error:

```text
Error: spawnSync git EPERM
```

No Slice 5 or other functional test failed. Unrelated React `act()` and
Three.js messages were warnings only.

Additional final checks:

```text
git diff --check
# exit 0, no output

node scripts/validate-production-economy.js
Verified 1 immutable production economy edition(s)
```

### Review evidence

One broad adversarial review found four valid defects hidden by the initial
static tests: the inherited sealed-result reason CHECK rejected `soft-pity`,
rare/epic hard-reason precedence differed from the locked driver, PostgreSQL
special numeric values passed the increment bound, and the edition-specific
production validator still hard-pinned `none`.

All four findings were fixed in one batch. Tests now pin the five-value reason
allowlist, selected/epic/rare precedence, finite SQL increment constraint,
canonical NULL-ramp draw text, both production validator call sites, and the
edition-0001 SHA guard. The permitted focused re-review found no new P0/P1 and
passed 17/17 targeted tests.

### Deviations

- The required premium-pity driver file is absent from this worktree. It exists
  only as an untracked file in the owner checkout and was read there to confirm
  the locked wrapper semantics. Copying or modifying it here would violate the
  binding touched-file boundary, so the exact worktree command remains blocked
  with `MODULE_NOT_FOUND`.
- Aggregate `npm test` is not green only because sandbox policy denied nested
  Git processes in the three documented history guards with
  `Error: spawnSync git EPERM`; no functional test failed.
- The task requested static migration tests. No disposable/live PostgreSQL
  migration apply or statistical runtime sampling was available or run.
- Pattern-catalog review found no applicable production pattern beyond the
  existing seeded rejection-sampling primitive. Opted-in categorical evidence
  could not be written because the global ledger is read-only:
  `error: [Errno 30] Read-only file system: '/home/donovanyohan/.codex/pattern-evidence'`.

### Blockers and risks

- Driver execution remains blocked solely by the missing worktree-local draft
  file described above. All implementation and validator gates are complete.
- SQL behavior is proven by static contract tests, not a PostgreSQL apply.
  Residual risk is migration/runtime syntax or catalog-state behavior that only
  an executable database harness would expose.
- Billion-point floor rounding makes realized upgrade probability at most less
  than `1e-9` below the mathematical excess; it never rounds in the player's
  favor beyond the configured target.
- Premium random pulls remain dormant and disabled pending issue #154. No
  banner row enables the new columns.

### Working tree evidence

Slice 1–4 and task/report artifacts were pre-existing untracked WIP and remain
untouched. Slice 5 adds the two 0018 files and this report; only the five
explicitly allowed JS/TypeScript files are tracked modifications. Nothing is
staged or committed.

### Provenance

Authored by: Codex CLI 0.144.1 (codex exec), model: GPT-5
