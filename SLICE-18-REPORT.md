# Slice 18 Report — Revision 2: stale sensors and #154 gate tags

## Revision 2 summary

Revision 2 closes the post-review compatibility findings without changing the
0027 runtime boundary:

- `0009_earned_economy_ledger.test.sql` now proves a service-role
  `(stars, paid)` append succeeds and materializes exactly one paid balance and
  ledger row, while `(dust, paid)` still fails with SQLSTATE `22023`.
- Its exact cardinality and owner-read assertions now account for both the
  existing promotional row and the newly admitted paid row; replay, overspend,
  immutability, cross-user RLS, and reconciliation protections remain intact.
- `0013_paid_checkout_foundation.test.sql` now treats `(stars, paid)` as the
  admitted direct pair under the latest schema, proves `(dust, paid)` still
  violates the pair CHECK, and performs an actual authenticated insert probe
  that must fail with `insufficient_privilege`.
- Each of the three widened 0027 constraint clauses now carries an adjacent
  `[#154] GATE` tag, and the static Vitest contract requires all three tags.

This is revision 2. The complete revision 1 report and its evidence remain
below as historical evidence; statements there describing `0009` and `0013`
as still stale describe the pre-revision-2 tree and are not current status.

## Revision 2 gate status

The orchestrator ran both final requested commands through the
repository-required `rtk` wrapper on the final revision 2 tree.

Exact requested command:

```text
npm test -- 0027
```

```text
> vitest 0027
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0027_paid_stars_bucket.test.ts (6 tests) 8ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  22:00:09
   Duration  4.17s (transform 103ms, setup 591ms, collect 23ms, tests 8ms, environment 1.93s, prepare 6ms)
```

Exact requested command:

```text
npm test -- supabase/migrations
```

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0026_sku_registry.test.ts (7 tests) 9ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 10ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 11ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 11ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 21ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 38ms
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 28ms
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (9 tests) 15ms
 ✓ supabase/migrations/0027_paid_stars_bucket.test.ts (6 tests) 14ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 17ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 12ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 43ms
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 25ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 25ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 9ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 16ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 15ms
 ✓ supabase/migrations/0025_pity_read.test.ts (5 tests) 10ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 10ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 12ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 Test Files  21 passed (21)
      Tests  169 passed (169)
   Start at  22:00:09
   Duration  4.99s (transform 1.37s, setup 6.35s, collect 831ms, tests 355ms, environment 21.88s, prepare 261ms)
```

No revision 1 output was deleted or relabeled as revision 2 evidence.

---

## Revision 1 history — retained verbatim

# Slice 18 Report — Paid Stars bucket enablement

## Summary

Implemented the dormant paid-Stars schema boundary without adding a production
caller or activating paid spending:

- `(stars, paid)` is now the only newly valid currency/bucket pair.
- A trusted `service_role` caller can append a paid-Star credit through the
  canonical wallet boundary, materializing both ledger and balance rows.
- Paid-Star debits remain rejected with SQLSTATE `55000` until the issue #154
  activation/debit-policy slice.
- Authenticated and anonymous callers still cannot execute the wallet append or
  write the wallet tables directly.
- Stars-to-standard-roll conversion, legacy pull holds/commit, and both Lunar
  Star grants remain promotional-only.
- Scrap and craft remain earned-Dust-only.
- Every touched CHECK is explicitly NULL-safe, and the function validator
  rejects NULL currency/bucket inputs with SQLSTATE `22023`.

The documented future spend policy remains
`debitPolicy promotional-before-paid`. Paid participation in conversion, pull
reservation, and pull commit is deferred to activation.

## Files and current line map

- `supabase/migrations/0027_paid_stars_bucket.sql` — 235 lines
  - lines 1–12: dormant issue #154 boundary and deferred debit-policy comments
  - lines 13–24: NULL-safe wallet-balance pair widening
  - lines 26–32: ledger bucket-domain widening required for paid rows
  - lines 33–43: NULL-safe wallet-ledger pair widening
  - lines 45–222: canonical `0017` append body with the bounded validator and
    paid-debit gate delta
  - lines 224–235: updated boundary comment and explicit service-role-only
    execute privileges
- `supabase/migrations/0027_paid_stars_bucket.test.ts` — 206 lines
  - lines 1–78: source fixtures, canonical extraction, and comment stripping
  - lines 79–136: exact widening, inherited-body equality, debit gate, caller,
    and privilege contracts
  - lines 138–184: promotional-only conversion/Lunar/hold proofs and
    earned-Dust Scrap/craft proof
  - lines 186–205: executable behavioral-suite evidence contract
- `supabase/tests/0027_paid_stars_bucket.test.sql` — 802 lines
  - lines 1–38: users and privilege posture
  - lines 40–151: paid credit success, paid debit rejection, and authenticated
    privilege probes
  - lines 153–268: paid-only conversion and pull-hold rejection
  - lines 270–313: Lunar daily promotional-Star proof
  - lines 315–395: Scrap credit and craft debit earned-Dust proof
  - lines 397–514: canonical invalid-pair calls and installed-constraint
    definition audit
  - lines 516–782: direct invalid-pair, invalid-domain, and NULL-hole probes
  - lines 784–802: final no-partial-mutation check and rollback

No existing migration, edge function, client file, or unrelated worktree file
was changed. No commit was created.

## Exact widened validation points

The widening required four physical validation updates:

1. `supabase/migrations/0027_paid_stars_bucket.sql:13` —
   `wallet_balances_currency_bucket_pair` now admits promotional Stars, paid
   Stars, and earned Dust only.
2. `supabase/migrations/0027_paid_stars_bucket.sql:26` —
   `wallet_ledger_entries_balance_bucket_check` adds `paid` to the ledger's
   independent bucket domain. Although spec delta 1 names the pair rule, this
   separate `0009` check also had to widen or a paid ledger row could not
   materialize.
3. `supabase/migrations/0027_paid_stars_bucket.sql:33` —
   `wallet_ledger_entries_currency_bucket_pair` admits the same exact three
   pairs.
4. `supabase/migrations/0027_paid_stars_bucket.sql:79` —
   `append_wallet_ledger_entry` rejects NULL inputs and admits exactly the same
   three pairs before account locking or mutation.

The adjacent dormant debit guard is
`supabase/migrations/0027_paid_stars_bucket.sql:89`; it rejects every paid
negative delta pending issue #154 activation.

## Inherited-guard preservation evidence

The canonical source is
`supabase/migrations/0017_pull_commit_reveal.sql:1202`, whose append function
continues through line 1368.

`supabase/migrations/0027_paid_stars_bucket.test.ts:98` extracts both complete
function definitions. It replaces only the current function's explicitly
bounded issue #154 region (NULL-safe pair validator, updated error, and dormant
paid-debit gate) with the canonical `0017` pair region, then requires complete
byte equality with `toBe(canonical)` at line 115.

That proof preserves the inherited function signature, volatility,
`SECURITY DEFINER`, empty search path, user/delta/reason/idempotency/provenance
validation, economy-edition FK probe, account-first lock, exact replay and
payload-drift checks, balance-row materialization, negative/overflow guards,
terminal-transition-aware active-hold query, append fields, and snapshot update
byte-for-byte outside the bounded delta.

The behavioral suite additionally proves the new validator rejects
`dust/paid` and `stars/earned` through actual service-role calls without partial
state, and inspects the installed CHECK definitions for exact literals and
explicit NULL guards.

## Review and fix history

One adversarial review found no schema defect and one behavioral coverage gap:
invalid non-NULL pairs were exercised directly against the tables but not
through a live call to the canonical append. The single fix pass added
service-role `dust/paid` and `stars/earned` calls, no-partial-state assertions,
and installed-constraint definition checks. Focused re-review found no
remaining P0/P1/P2 issue.

A later focused ESLint gate found two `no-regex-spaces` violations in the
canonical-body proof. They were mechanically changed to `{2}` quantifiers;
behavior was unchanged, and the focused and full gates were rerun on the final
tree.

## Final requested test output

Commands were run through the repository-required `rtk` wrapper. Exact
requested command:

```text
npm test -- 0027
```

```text
> vitest 0027
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0027_paid_stars_bucket.test.ts (6 tests) 7ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  21:43:14
   Duration  534ms (transform 31ms, setup 99ms, collect 13ms, tests 7ms, environment 320ms, prepare 6ms)
```

Exact requested command:

```text
npm test -- supabase/migrations
```

```text
> vitest supabase/migrations
 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c
 ✓ supabase/migrations/0010_earned_reward_claims.test.ts (9 tests) 10ms
 ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0024_lunar_pass_faucet.test.ts (9 tests) 13ms
 ✓ supabase/migrations/0026_sku_registry.test.ts (7 tests) 15ms
 ✓ supabase/migrations/0011_earned_pull_preparation.test.ts (11 tests) 15ms
 ✓ supabase/migrations/0023_subscription_status.test.ts (9 tests) 19ms
 ✓ supabase/migrations/0017_pull_commit_reveal.test.ts (15 tests) 19ms
 ✓ supabase/migrations/0015_banner_roll_type_binding.test.ts (9 tests) 23ms
 ✓ supabase/migrations/0014_roll_ticket_ledger.test.ts (10 tests) 9ms
 ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 12ms
 ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 17ms
 ✓ supabase/migrations/0018_soft_pity_ramp.test.ts (9 tests) 9ms
 ✓ supabase/migrations/0004_collectible_catalog.test.ts (8 tests) 12ms
 ✓ supabase/migrations/0009_earned_economy_ledger.test.ts (7 tests) 8ms
 ✓ supabase/migrations/0013_paid_checkout_foundation.test.ts (8 tests) 15ms
 ✓ supabase/migrations/0005_security_hardening.test.ts (8 tests) 12ms
 ✓ supabase/migrations/0016_stars_to_standard_roll_conversion.test.ts (7 tests) 7ms
 ✓ supabase/migrations/0019_soft_pity_constraint_fix.test.ts (3 tests) 4ms
 ✓ supabase/migrations/0025_pity_read.test.ts (5 tests) 7ms
 ✓ supabase/migrations/0027_paid_stars_bucket.test.ts (6 tests) 13ms
 ✓ supabase/migrations/0012_earned_pull_preparation_fk_indexes.test.ts (2 tests) 4ms
 Test Files  21 passed (21)
      Tests  169 passed (169)
   Start at  21:43:19
   Duration  2.24s (transform 433ms, setup 2.51s, collect 470ms, tests 251ms, environment 9.64s, prepare 172ms)
```

Both requested commands exited 0. Focused ESLint for
`supabase/migrations/0027_paid_stars_bucket.test.ts` reported
`ESLint: No issues found`, and `git diff --check` exited 0 with no output.

## Risks and dormant boundaries

- The requested Vitest gates inspect migration and behavioral-suite source; they
  do not execute SQL against PostgreSQL.
- No SQL execution was performed because the task explicitly prohibits Docker
  and assigns the live harness to the orchestrator. The migration was not
  applied to a hosted or local database in this slice.
- The repository's current all-era SQL harness applies the latest schema before
  running historical suites. Its immutable `0009` and `0013` behavioral files
  still assert that paid rows cannot exist. If the orchestrator runs that script
  unchanged, those historical assertions conflict with the intended `0027`
  post-migration state; filtering/evolution of that orchestration lies outside
  this slice's three-file boundary.
- The generic append is deliberately credit-only for the paid bucket in this
  dormant slice. The future activation must implement the documented
  promotional-before-paid policy and update hold/commit participation together,
  rather than deleting the debit guard in isolation.
- There is deliberately no checkout fulfillment branch, edge-function caller,
  client path, premium conversion, or premium pull activation in this slice.

## Provenance

- Exact primary model ID: `gpt-5.6-sol`
- Reasoning effort: `high`
- Verified source: `/home/donovanyohan/.codex/config.toml` lines 1–2
- Bounded implementation was delegated through the repository's worker
  procedure. The collaboration surface did not expose separate worker model
  telemetry, so this report does not invent an additional exact model ID.
