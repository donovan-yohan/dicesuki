# Slice 9 report — Scrap Dust credit and craft RPC

## Summary

Implemented monetization economy spec §6.1 deltas 12–13 as a dormant backend
rail without changing any pull preparation, seal, commit, frontend, harness, CI,
or previously merged migration:

- `dice_economy_values` stores service-retunable Scrap yields and craft costs
  for all six catalog rarity values. `common` and `uncommon` both map to the
  proposal's standard tier.
- Scrap now marks one owned live copy and credits the exact tier yield to earned
  Dust through the canonical 0009 wallet append in the same transaction.
- The old `scrap_dice_copy_marker` name remains compatible but now performs the
  full valued operation, so callers cannot continue taking the marker-only path.
- Exact pre-0022 marker-only replays receive their missing deterministic Dust
  append once. Present-but-mismatched ledger payloads fail closed.
- Craft is self-only and owned-live-copy-only, debits earned Dust before
  granting one `source_kind = 'craft'` copy through
  `record_dice_copy_grant`, and returns an immutable replay receipt.
- Craft relies on the 0021 copy-insert trigger for SQLSTATE `55000` hold
  blocking; a rejected grant rolls the preceding debit back atomically.
- Economic payload retunes must advance `value_version` exactly once.
  Status-only governance changes retain the version, and the database owns
  `updated_at`.

No commit was created.

## Files and line evidence

- `supabase/migrations/0022_scrap_craft_economy.sql` (691 lines)
  - lines 1–20: scope, no-pull-path boundary, and PROPOSED / PO-pending source
    citations.
  - lines 22–90: six catalog-rarity rows, standard-tier mapping, positive Scrap
    constraint, strict craft-to-Scrap floor, and mythic NULL craft cost.
  - lines 92–157: sequential value-version enforcement, public-read RLS, and
    service-only writes.
  - lines 159–216: immutable Scrap and craft receipt builders with private
    execution grants.
  - lines 218–414: wallet-first valued Scrap engine, exact replay validation,
    pre-0022 marker upgrade, 0021 marker/hold reuse, and canonical earned-Dust
    append.
  - lines 415–488: self-only `scrap_dice_copy` plus the now-valued legacy
    `scrap_dice_copy_marker` compatibility wrapper.
  - lines 490–663: wallet-first owned-live-copy craft engine, immutable replay
    and payload-drift checks, NULL-cost rejection, debit-before-grant ordering,
    and 0021 hold-trigger rollback contract.
  - lines 664–691: self-only authenticated `craft_dice_copy` wrapper and grants.
- `supabase/migrations/0022_scrap_craft_economy.test.ts` (282 lines)
  - lines 35–116: value data, constraints, RLS/grants, and enforced sequential
    version semantics.
  - lines 117–186: valued Scrap, compatibility wrapper, live ownership, and
    debit-before-copy-grant structure.
  - lines 187–234: immutable replay, nullable-provenance fail-closed checks, and
    payload drift.
  - lines 235–282: no-pull-path guard and sensors for every binding behavioral
    case.
- `supabase/tests/0022_scrap_craft_economy.test.sql` (1,192 lines)
  - lines 78–203: public-read value rows, client-write rejection, RLS/function
    privileges, and the live anti-pump constraint.
  - lines 205–312: value identity/version/timestamp enforcement and restoration.
  - lines 315–543: service fixtures, genuine pre-0022 marker-only state,
    malformed-ledger state, wallet funding, and reset-role discipline.
  - lines 544–685: cross-owner `42501`, legacy marker upgrade/replay, and
    malformed-present-ledger `55000` with no added mutation.
  - lines 686–789: exact Scrap marker plus earned-Dust credit for all six
    catalog rarities, including mythic 50, and once-only replay.
  - lines 790–963: craft happy path, exact debit/copy/`source_kind`/
    `is_first_copy` assertions, payload drift, and byte-identical Scrap/craft
    replay after a service retune.
  - lines 964–1091: zero-live, never-owned, insufficient-Dust, and mythic craft
    rejection with no wallet or inventory mutation.
  - lines 1092–1165: live-hold `55000` through the 0021 trigger and atomic debit
    rollback.
  - lines 1166–1192: craft-then-Scrap remains a net `-209` Dust sink and the
    live table satisfies `scrap_yield < craft_cost`.

## Design decisions and specification citations

1. **Six catalog rows represent five economy tiers.** Migration 0004 permits
   `common`, `uncommon`, `rare`, `epic`, `legendary`, and `mythic`. The
   production edition maps both common and uncommon catalog items to the
   standard economy tier. Spec §7 and DUST-SIM-REPORT rev 2 supply the proposal:
   standard `1/210`, rare `4/220`, epic `10/615`, signature `25/2500`, and
   mythic `50/NULL`.
2. **Values are retunable data with auditable versions.** Spec §6.1 deltas 12–13
   and §7 make Scrap yield and craft cost economy tuning rather than schema
   constants. Service-role updates are allowed, while database checks preserve
   `scrap_yield > 0`, `craft_cost IS NULL OR craft_cost > scrap_yield`, mythic
   non-craftability, and exact sequential payload versions.
3. **Public read, no public write.** The exact PROPOSED values and status are
   already disclosed in spec §7, so public read is intentional. RLS is enabled
   and forced; `anon` and `authenticated` receive only `SELECT`. Only
   `service_role` receives value-table `INSERT`/`UPDATE`.
4. **Scrap is an earned-Dust append, not a balance edit.** Spec §1.6 and §6.1
   delta 12 require every die to be scrappable and the credit to land in the
   earned bucket. The engine takes the stable wallet-account lock first, reuses
   0021's owner/once/hold-safe marker, then invokes 0009's canonical append with
   a hashed `scrap-dust:` key distinct from the copy marker key.
5. **Legacy marker compatibility is valued.** The 0020 public wrapper was
   marker-only. Replacing it with another marker-only path would violate delta
   12, while simply rejecting an exact historical marker replay would strand
   its Dust permanently. An exact owner/copy/key marker with no deterministic
   ledger row is therefore upgraded once from the current live rarity value.
   Any present mismatched row, including missing JSON provenance keys, fails
   closed.
6. **Craft means a current live copy, not an ever-owned latch.** Spec §1.6 and
   §7's working PO assumption say players duplicate dice they already have.
   The engine therefore requires at least one row with `scrapped_at IS NULL`;
   never-owned and scrap-to-zero histories are both rejected. Mythic's NULL
   cost is rejected explicitly.
7. **Debit then canonical copy grant.** Spec §6.1 delta 13 requires earned Dust
   debit followed by one `record_dice_copy_grant(..., 'craft', ...)`. Both occur
   after the wallet-account lock. Exact replay derives its receipt only from the
   immutable ledger and granted-copy rows, so later retuning cannot change it.
8. **The 0021 freeze is reused.** Task requirement 3 says the existing
   copy-insert freeze must block craft during live pull holds rather than being
   reimplemented. The behavioral sensor proves the trigger returns `55000` and
   the enclosing transaction restores the attempted Dust debit.
9. **No catalog pattern was added.** The evaluated MVCC, WAL, and state-machine
   patterns were no-fits here: PostgreSQL transactions, row locks, durable WAL,
   constraints, triggers, and the repository's canonical append ledger already
   provide the required primitives. The defining invariants are instead pinned
   at the RPC/ledger interface by the 0022 static and behavioral suites.

## Adversarial review

One broad independent review ran before final gates.

Accepted findings were fixed as one batch:

- **P1:** exact pre-0022 marker-only rows initially had no recovery path to
  their Dust credit. Exact missing-ledger replays now upgrade once.
- **P2:** cross-owner Scrap was structurally protected but lacked a runtime
  sensor. The suite now proves `42501` and no mutation.
- **P2:** replay-after-retune was claimed but not behaviorally proven. Both
  Scrap and craft receipts are now byte-compared after a real versioned retune.
- **P2:** `value_version` was descriptive rather than enforced. Economic
  payload changes now require exactly `old + 1`.

The permitted focused re-review found one changed-hunk P1: JSON `->>` fields
were compared with `<>`, which can evaluate to NULL for missing provenance and
therefore bypass a PL/pgSQL `IF`. Every nullable provenance comparison now uses
`IS DISTINCT FROM`, and a malformed-present-ledger behavioral fixture proves
SQLSTATE `55000` with no additional mutation.

No P0/P1 remains. Review was not reopened after the precise final fix.

## Test evidence

All commands were invoked from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`
on the final tree.

1. `npm test -- 0022` — exit 0

   ```text
   ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (9 tests) 10ms
   Test Files  1 passed (1)
        Tests  9 passed (9)
     Duration  872ms
   ```

2. `npm test -- supabase/migrations` — exit 0

   ```text
   ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (9 tests) 16ms
   Test Files  16 passed (16)
        Tests  132 passed (132)
     Duration  2.02s
   ```

3. `npx eslint supabase/migrations/0022_scrap_craft_economy.test.ts` — exit 0

   ```text
   ESLint: No issues found
   ```

4. `npm run check:immutable-migration-history -- origin/main` — exit 0

   ```text
   Verified immutable contiguous Supabase migrations against merge base 4fe0c06b5d976211ed1433e765854137270d6175; 1 appended
   ```

5. Trailing-whitespace scan over the three 0022 files — no matches.

6. `npm run test:db:supabase` — blocked before PostgreSQL startup, migration
   application, or behavioral-suite execution

   ```text
   Error: spawnSync docker EPERM
   code: 'EPERM'
   syscall: 'spawnSync docker'
   path: 'docker'
   spawnargs: [ 'version' ]
   ```

The orchestrator attempted the repository-owned disposable-Postgres harness as
required. The sandbox denied its initial `docker version` child process; no
container or database process started.

## Risks and follow-up evidence

- The new 1,192-line money-path behavioral SQL has not executed locally.
  Static tests cannot prove PostgreSQL function, trigger, RLS, rollback, and
  SQLSTATE behavior. Required follow-up: run `npm run test:db:supabase` in a
  Docker-capable orchestrator environment.
- All values remain **PROPOSED / PO-pending** per spec §7 and
  DUST-SIM-REPORT rev 2. This migration makes them service-retunable data but
  does not represent PO approval.
- A pre-0022 marker contains no historical economy-value version because no
  valued Scrap table existed then. Its first exact post-0022 replay therefore
  uses the current row and records that version immutably in wallet provenance.
- `common` and `uncommon` are separate catalog-rarity rows mapped to the same
  standard tier. A PO retune must update both rows deliberately if the shared
  standard price is intended to remain identical.

## Provenance

- Implementation worker runtime model id: `gpt-5.6-terra`
- Implementation worker reasoning effort: `high`
- Orchestrator runtime model id: `gpt-5.6-sol`
- Orchestrator reasoning effort: `high`
- Orchestrator verification source:
  `/home/donovanyohan/.codex/config.toml` (`model`,
  `model_reasoning_effort`).
- Branch: `econ/09-scrap-craft`
- Starting head: `4fe0c06b5d976211ed1433e765854137270d6175`

---

# Revision 2 — batched harness and review fixes

Revision 1 above is preserved as the original delivery record. This revision
supersedes its stale 0020 wallet-neutrality assumption, shared-standard-tier
risk, affected line counts, and final static-test totals.

## Fix closure

1. **0020 live-harness expectation:** The inventory suite retains every
   marker, latch, RLS, and immutability assertion. Its final wallet assertion
   now requires exactly two rare-tier Scrap credits of 4 Dust, exactly two
   ledger rows and an earned-Dust balance of 8 for the owner, with no wallet
   row for the cross-owner user.
2. **Replay provenance fail-closed:** Scrap and craft drift checks now reject
   a replay row when any receipt-sourced `catalog_rarity`, `economy_tier`, or
   `economy_value_version` provenance value is missing. The malformed Scrap
   fixture now includes its identity provenance but deliberately omits
   `economy_tier`, so the new gap is directly sensed.
3. **Shared standard-tier equality:** Chosen approach: keep
   `catalog_rarity` as the directly joinable primary key and add a
   non-deferrable `AFTER ... FOR EACH STATEMENT` trigger that scans for any
   two rows in one `economy_tier` with different `scrap_yield` or
   `craft_cost`. This permits an atomic one-statement retune of both
   `common` and `uncommon`, but a partial statement fails with `55000` and
   rolls back. The behavioral suite proves both the rejected one-row retune
   and a successful two-row retune with both `value_version` values advanced.
   A statement trigger was selected over a deferrable row constraint so
   callers cannot defer the invariant and temporarily split tier prices
   across statements.
4. **SQLSTATE consistency:** Craft replay corruption/partial-state drift now
   raises `55000`, matching Scrap and the migration family's invariant-
   violation convention. The different-catalog craft replay sensor expects
   `55000`.
5. **Valued-Scrap hold sensor:** During a live pull hold, valued Scrap raises
   `55000`; the failed key creates no wallet row. After cancellation, the same
   live copy scraps successfully under a fresh key, credits exactly 1 Dust,
   and leaves the account at 501 Dust. The existing craft hold/rollback sensor
   remains intact.

No Docker command was run. Per the fix packet, the orchestrator owns the
behavioral database harness. No commit was created.

## Revision 2 current line counts

- `supabase/migrations/0022_scrap_craft_economy.sql`: 738 lines.
- `supabase/tests/0022_scrap_craft_economy.test.sql`: 1,259 lines.
- `supabase/tests/0020_dice_copy_inventory.test.sql`: 391 lines.
- `supabase/migrations/0022_scrap_craft_economy.test.ts`: 330 lines.
- `SLICE-9-REPORT.md`: 324 lines, including this revision-2 section.

## Revision 2 final test evidence

All commands ran from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`.

1. `rtk npm test -- 0022` — exit 0

   ```text
   > vitest 0022
   ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 10ms
   Test Files  1 passed (1)
        Tests  10 passed (10)
     Duration  542ms
   ```

2. `rtk npm test -- 0020_dice_copy_inventory` — exit 0

   ```text
   > vitest 0020_dice_copy_inventory
   ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 8ms
   Test Files  1 passed (1)
        Tests  10 passed (10)
     Duration  536ms
   ```

3. `rtk npm test -- supabase/migrations` — exit 0

   ```text
   > vitest supabase/migrations
   ✓ supabase/migrations/0022_scrap_craft_economy.test.ts (10 tests) 11ms
   ✓ supabase/migrations/0020_dice_copy_inventory.test.ts (10 tests) 15ms
   Test Files  16 passed (16)
        Tests  133 passed (133)
     Duration  1.91s
   ```

## Revision 2 focused re-review

The adversarial review identified that a `DEFERRABLE INITIALLY IMMEDIATE`
constraint trigger could be explicitly deferred, allowing transaction-
intermediate tier divergence. The final implementation uses a non-deferrable
statement trigger instead. Focused changed-hunk review found no remaining
P0/P1 issue; the three final targeted gates above pass.
