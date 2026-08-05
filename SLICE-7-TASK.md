# Slice 7 — Discrete dice-copy inventory table (spec §6.1 delta 10)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/07-dice-copies` (off current main — migrations through 0019 merged,
live-DB behavioral harness in CI).

Read FIRST: docs/exec-plans/active/2026-07-22-monetization-economy-spec.md
§1.6 (discrete-copy semantics — ever-owned latch, live-copy ownership
predicate, scrap consequences) and §6.1 (deltas 10–14 — you implement ONLY
delta 10 here); docs/adrs/shared/017-monetization-economy-architecture.md
(discrete-copy decision); supabase/migrations/0013 (user_entitlements shape),
0014 (ledger/idempotency idiom), 0017 (transition-table idiom).

## Task
`supabase/migrations/0020_dice_copy_inventory.sql` + colocated static
`.test.ts` + behavioral `supabase/tests/0020_dice_copy_inventory.test.sql`.

### Schema requirements (follow spec §6.1 delta 10 exactly; where this summary
and the spec disagree, the spec wins)
1. Discrete copies: one row per copy per user per catalog item, with
   acquisition provenance (source kind: pull/craft/purchase/reward + source
   reference), acquired_at. Scrap = irreversible per-copy transition (append
   a scrap marker or timestamp per repo idiom — copies must never be deleted;
   live copy = not scrapped). Live-copy count per (user, item) must be
   cheaply queryable (index for it).
2. Ever-owned latch: per (user, catalog_item) first-copy flag that latches on
   FIRST EVER copy and never un-latches (scrap-all + re-pull must NOT re-fire
   it) — spec §1.6 defines this precisely.
3. Write path: SECURITY DEFINER record function(s) as the SOLE write path
   (grant-copy and scrap-copy primitives; scrap only by the owning user via a
   self-only wrapper, grant only via service paths), idempotency discipline
   like 0014, no-negative equivalent = cannot scrap a non-live copy, cannot
   scrap someone else's copy. RLS: owner reads own rows.
4. NO consumer rework here: 0017's grant path, seal predicates, scrap/craft
   RPC VALUES, and any entitlement backfill are LATER slices (deltas 11–14).
   If the spec prescribes a backfill in delta 10 itself, follow it; if
   ambiguous, do NOT backfill and document why.
5. Dormant and additive: nothing existing may change behavior.

### Tests
Static .test.ts in the established style. Behavioral suite (live harness
pattern, read supabase/tests/0014/0017 suites): grant → live count rises;
scrap → count falls, row retained, second scrap of same copy rejected;
cross-user scrap rejected; ever-owned latch: grant → latch set; scrap-all →
live 0 but latch still set; re-grant → latch NOT re-fired (assert whatever
observable the spec's latch design exposes); RLS cross-user read denial;
idempotent replay of grant.

## Boundaries
Only the three new files. No edits to anything existing. No commits. You
cannot run docker — orchestrator runs `npm run test:db:supabase` outside and
returns failures for a fix pass. Run what you can:
`npm test -- 0020_dice_copy_inventory`, `npm test -- supabase/migrations`
(paste exact result lines).

## Report
`SLICE-7-REPORT.md`: summary, files+lines, design decisions vs spec citations,
test output, risks, provenance with EXACT model id + effort from your runtime
config (verify, do not guess — prior report misstated it).
