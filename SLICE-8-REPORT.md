# Slice 8 report — pull copy-grant rework

## Summary

Implemented monetization economy spec §6.1 delta 11 without mutating merged
migrations:

- Pull sealing now resolves selected-featured unowned state and duplicate state
  from live `dice_copies` rows (`scrapped_at is null`).
- Every committed sealed result grants one copy through
  `record_dice_copy_grant`; duplicate results additionally retain the single
  aggregated earned-Dust append.
- Pull commit no longer writes `user_entitlements`.
- Reveal results include the immutable `is_first_copy` latch selected by the
  deterministic session/result copy-grant key, so exact commit replay returns
  the identical receipt.
- Dice-copy grants and scraps are rejected with SQLSTATE `55000` while any
  unexpired non-terminal pull session holds the account ownership snapshot.
- A fully owned selected-featured pool leaves the selected target null and does
  not arm selected hard or soft pity; existing epic/rare/base order resolves
  the draw.

No frontend, server, CI, harness, or merged migration files were changed. No
commit was created.

## Files and line evidence

- `supabase/migrations/0021_pull_copy_grant_rework.sql`
  - lines 1-13: delta intent, 0018 inheritance contract, and conservative
    zero-unowned-target rule.
  - lines 14-629: canonical 0018 `prepare_pull_for_user`; the only body changes
    are the three live-copy predicates at lines 260-266, 288-294, and 415-421.
  - lines 630-722: committed reveal builder and deterministic per-result
    `is_first_copy` lookup (lines 695-702).
  - lines 724-944: reworked 0017 commit engine; the all-results copy grant is
    lines 896-911 and the existing aggregated duplicate-Dust append is lines
    913-934.
  - lines 946-995: account-wide entitlement/copy grant snapshot guard and new
    `dice_copies` insert trigger.
  - lines 997-1123: 0020 scrap primitive with exact-replay-first behavior and
    the account-wide unexpired/non-terminal hold exclusion.
- `supabase/migrations/0021_pull_copy_grant_rework.test.ts`
  - lines 1-180: static proof for exact 0018-body inheritance modulo the three
    ownership predicates, zero-target fallback, all-result copy grants,
    aggregated Dust, deterministic latch receipts, both hold guards, and the
    inherited 0011 behavioral ownership oracle.
- `supabase/tests/0011_earned_pull_preparation.test.sql`
  - lines 765-786: fully-owned guarantee fixture now grants live copies through
    the canonical service boundary instead of inserting entitlements.
  - lines 817-823 and 1084-1108: selected-target and duplicate/Dust oracles now
    recompute ownership from unscrapped live `dice_copies`.
  - lines 624-640 remain the original entitlement snapshot-guard assertion,
    proving the direct-purchase entitlement trigger was not dropped.
- `supabase/tests/0017_pull_commit_reveal.test.sql`
  - lines 260-279 and 375-380: reveal shape/count assertions now include
    `is_first_copy`.
  - lines 564-611: replay cardinality snapshot now proves two copies, one
    ever-owned latch, one Dust append, and no pull entitlement.
  - lines 722-747 and 895-917: cancellation and ticket-funded settlement now
    assert copy effects.
- `supabase/tests/0021_pull_copy_grant_rework.test.sql`
  - lines 1-200: deterministic banner/users and pre-owned-copy fixtures.
  - lines 204-275: non-duplicate first-ever copy, duplicate copy + Dust, no
    entitlement grant, and identical replay including latch flags.
  - lines 277-347: scrap-all then re-pull is non-duplicate, grants a live copy,
    and does not re-fire the ever-owned latch.
  - lines 349-424: live hold rejects scrap and service grant with `55000`, then
    commit releases the exclusion.
  - lines 426-466: cancellation releases the scrap exclusion.
  - lines 468-504: fully owned featured inventory leaves a null selected target
    and falls through to `epic-guarantee`.

## Design decisions and specification citations

1. **Copy plus Dust, with an ever-owned receipt latch.** Spec §1.6 defines a
   duplicate as another spawnable copy plus tier Dust and defines
   `is_first_copy` as a never-re-fired ever-owned latch. Spec §6.1 delta 11 and
   ADR-017 require the commit path to supersede 0017's Dust-only/entitlement
   transition. The deterministic key
   `pull-copy-grant:<session>:result:<position>` is distinct from the wallet and
   ticket prefixes and binds receipt replay to the immutable granted row.
2. **Live-copy sealing predicates.** Spec §1.6 “Impact on pull-seal semantics,”
   §6.1 delta 11, and ADR-017 define unowned as zero live copies and duplicate
   as at least one live copy. The 0018 body is byte-identical after mechanically
   restoring only those three old entitlement predicates; the 0021 static test
   enforces this equality.
3. **Scrap snapshot exclusion.** Task item 3 closes the new hazard created by
   §1.6's player-controlled live-count decrement: a scrap between prepare and
   commit could invalidate sealed duplicate/selected predicates. The scrap path
   therefore takes the canonical account lock and mirrors 0017's unexpired,
   non-terminal, account-wide hold query. It intentionally remains
   family-agnostic, with the multi-family liveness/safety trade-off documented
   in the migration.
4. **Zero unowned featured targets.** Spec §1.6 explicitly marks this case
   undefined. Per the binding task's conservative default, no selected target
   means neither selected hard pity nor soft pity arms; epic, then rare, then
   base resolution remains unchanged.
5. **Grant snapshot exclusion and direct-purchase choice.** Because §1.6 and
   ADR-017 move pull ownership truth to live copies, service copy inserts now
   use `preserve_pull_ownership_snapshot`. The existing
   `user_entitlements` trigger is deliberately retained: ADR-017 keeps
   entitlements as the direct-purchase rail, and preserving its existing hold
   exclusion avoids weakening that independent mutation boundary.
6. **Open refund rule remains open.** Spec §1.6/§7 and ADR-017 state that
   scrap-then-refund/chargeback reconciliation is unresolved. This slice does
   not invent claw-back, clamp, or negative-copy behavior.

## Adversarial review

The broad adversarial review reported one P1: the inherited 0011 PostgreSQL
suite still created its fully-owned fixture and recomputed duplicate ownership
from `user_entitlements`, although the harness applies 0021 before every suite.
The finding was accepted and fixed in one focused pass:

- the fully-owned fixture now calls `record_dice_copy_grant`;
- both ownership oracles now use live `dice_copies`;
- the suite's separate entitlement-insert-during-hold `55000` assertion remains
  unchanged;
- a seventh 0021 static test pins all three compatibility conditions.

No production migration logic changed during the review fix. The permitted
focused re-review found the P1 resolved, found no new issue in the repaired
hunks, and confirmed that no P0/P1 finding remains.

## Test evidence

All task-required gates were invoked from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`.

1. `npm test -- 0021`
   - PASS
   - 1 test file passed
   - 7 tests passed
   - final orchestrator run duration 549 ms
2. `npm test -- supabase/migrations`
   - PASS
   - 15 test files passed
   - 123 tests passed
   - final orchestrator run duration 2.07 s
3. `npm test -- 0018_soft_pity_ramp`
   - PASS
   - 1 test file passed
   - 9 tests passed
   - final orchestrator run duration 558 ms
   - No canonical-chain update was needed: 0018 remains immutable, and 0021's
     static test proves its inherited prepare body differs only at the three
     ownership predicates.
4. `npm run check:immutable-migration-history -- origin/main`
   - PASS
   - merge base `aa43a04a452007d3f0d3e00efa92b17b008be3d4`
   - verified one appended migration.
5. `git diff --check`
   - PASS
6. `npm run test:db:supabase`
   - BLOCKED before PostgreSQL startup, migration application, or suite
     execution
   - exact failure: `Error: spawnSync docker EPERM`
   - Node reported `code: 'EPERM'`, `syscall: 'spawnSync docker'`,
     `path: 'docker'`, and `spawnargs: [ 'version' ]`

The first optional immutable-history invocation omitted its mandatory base ref
and returned only
`Usage: check-immutable-migration-history.js <base-git-ref>`; it was rerun with
`origin/main` and passed as recorded above.

Per the binding task, the implementation worker did not invoke Docker. The
orchestrator invoked the repository-owned live harness after review closure,
but the sandbox denied the harness's initial `docker version` process with
`EPERM`; no Docker container or PostgreSQL process started. Therefore
`supabase/tests/0011_earned_pull_preparation.test.sql`,
`supabase/tests/0017_pull_commit_reveal.test.sql` and
`supabase/tests/0021_pull_copy_grant_rework.test.sql` remain authored
behavioral coverage awaiting execution in a Docker-capable environment.

## Risks and follow-up evidence

- The money-path behavioral SQL has not executed locally. The orchestrator ran
  the required command, but the sandbox returned `spawnSync docker EPERM`
  before the harness could start PostgreSQL. Static tests cannot prove
  PostgreSQL trigger/function runtime behavior; the required follow-up is
  `npm run test:db:supabase` in a Docker-capable environment.
- The ownership exclusion is account-wide across banner families, matching the
  existing 0017 safety pattern. A future second concurrent family may create a
  conservative liveness block; the migration documents that constraint.
- Existing committed pre-0021 sessions have no deterministic 0021 copy-grant
  row, so their newly shaped reveal would contain a null `is_first_copy`.
  Normal 0021 commits cannot do so because grant and transition are atomic, and
  behavioral coverage requires booleans for every new result. If historical
  committed-session reveal compatibility is a product requirement, it needs a
  separately specified backfill/versioning rule.
- Duplicate Dust and future scrap yields remain jointly PO-pending per spec
  §1.6/§7; this slice preserves the sealed configured Dust amount and does not
  freeze economy tuning.

## Provenance

- Implementation and review worker runtime model id: `gpt-5.6-terra`
- Implementation and review worker runtime effort: `xhigh`
- Worker verification source: runtime assignment identified
  `gpt-5.6-terra`; runtime configuration exposed `CLAUDE_EFFORT=xhigh`.
- Orchestrator runtime model id: `gpt-5.6-sol`
- Orchestrator reasoning effort: `high`
- Orchestrator verification source:
  `/home/donovanyohan/.codex/config.toml` (`model`,
  `model_reasoning_effort`).
- Branch: `econ/08-copy-grant-rework`
- Starting head: `aa43a04 feat(economy): discrete dice-copy inventory
  (migration 0020) (#186)`

---

## Revision 2 — SQL-suite role repair and PO-pending spec flag

Revision 1 is retained in full above. Revision 2 is limited to the three files
authorized by `SLICE-8-FIX-TASK.md`; it does not change production SQL, grants,
or any file outside that scope.

### Role-window audit and fixes

The entire `0021_pull_copy_grant_rework.test.sql` suite was swept for direct
reads of privileged pull, copy, and wallet state while an API role was active.
The audit found and repaired four role-window seams:

1. The reported scrap-all assertion read `sealed_pull_results` while still
   `authenticated`. The prepared session id is now carried through a
   transaction-local setting, followed by `reset role` before the sealed-result
   assertion; `authenticated` is re-entered only for
   `commit_pull_session`.
2. Scrap-all discovered copy ids directly from `dice_copies` while
   `authenticated`. The privileged setup block now captures and validates the
   two ids before the API window, and the API block only calls the scrap and
   prepare RPCs.
3. The commit-hold and cancel-hold cases each discovered a copy id from
   `dice_copies` while `authenticated`. Both ids are now captured under the
   reset/default role and passed into API-only RPC windows through
   transaction-local settings.
4. The fully-owned case asserted against both `sealed_pull_results` and
   `pull_sessions` while `authenticated`. Preparation now records only the
   returned session id; the suite resets role before both privileged reads.

The existing copy-cardinality, wallet-balance, wallet-ledger, and entitlement
assertions were already after `reset role` and remain there. The service-role
windows contain only calls to `record_dice_copy_grant`; the authenticated
windows now contain only the public RPC calls under test, returned-receipt
checks, and transaction-local setting reads. No client `SELECT` grant was
added, and the sealed-seed secrecy boundary remains unchanged.

### Specification flag

Spec §7 now records the PO-pending mismatch: `0010` reward claims and `0013`
direct purchases write `user_entitlements`, not dice copies, so copy-count pull
ownership treats those dice as unowned and can grant a fresh non-duplicate copy
without duplicate Dust. The documented working assumption is that the split is
intentional per ADR 017, reward/faucet copy grants are a future delta, and the
PO must confirm.

### Revision 2 test evidence

Both required gates were invoked from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`
through the profile-required RTK wrapper.

1. Requested gate `npm test -- 0021`
   - exact invocation: `rtk npm test -- 0021`
   - exit code: `0`
   - relevant output:

     ```text
     > vitest 0021
     ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 8ms
     Test Files  1 passed (1)
          Tests  7 passed (7)
       Duration  1.46s
     ```

2. Requested gate `npm test -- supabase/migrations`
   - exact invocation: `rtk npm test -- supabase/migrations`
   - exit code: `0`
   - relevant output:

     ```text
     > vitest supabase/migrations
     ✓ supabase/migrations/0021_pull_copy_grant_rework.test.ts (7 tests) 15ms
     Test Files  15 passed (15)
          Tests  123 passed (123)
       Duration  3.66s
     ```

3. Orchestrator-owned live Docker/PostgreSQL harness
   - exact invocation: `rtk npm run test:db:supabase`
   - exit code: `1`
   - exact failure: `Error: spawnSync docker EPERM`
   - process evidence: `syscall: 'spawnSync docker'`, `path: 'docker'`,
     `spawnargs: [ 'version' ]`

The focused post-fix review found no remaining direct privileged-table read
inside an API-role window and no new P0/P1 issue in the changed suite blocks.

### Revision 2 limitations

The revision-2 worker did not run the live Docker/PostgreSQL harness. The
orchestrator attempted the owned rerun, but `docker version` was denied with
`EPERM` before Docker/PostgreSQL startup, migration application, or SQL-suite
execution. The two passing Vitest gates provide static migration/suite coverage
but do not replace live execution of
`supabase/tests/0021_pull_copy_grant_rework.test.sql`.
