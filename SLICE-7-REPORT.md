# Slice 7 Report — Discrete dice-copy inventory

## Summary

Implemented spec §6.1 delta 10 as a dormant, additive inventory foundation.
Each acquired die is a retained row; ownership is the count of rows without a
scrap marker. The sole write paths are a service-only idempotent grant function
and an authenticated self-only idempotent marker-only scrap wrapper. The first
retained row for each `(user_id, catalog_item_id)` is the never-unlatched
ever-owned latch.

No existing migration, consumer, entitlement, pull/seal path, wallet value,
scrap value, craft path, or catalog row was changed. No backfill was added.

## Files and lines

- `supabase/migrations/0020_dice_copy_inventory.sql` — lines 1–382:
  table/constraints/indexes, transition enforcement, grant and scrap-marker
  boundaries, RLS, and least-privilege grants.
- `supabase/migrations/0020_dice_copy_inventory.test.ts` — lines 1–179:
  eight static contract tests covering schema, latch, immutability,
  idempotency, authorization, RLS, live-count indexing, and additive scope.
- `supabase/tests/0020_dice_copy_inventory.test.sql` — lines 1–319:
  live-database behavioral suite covering grant/replay, simultaneous copies,
  `2 → 1 → 0 → 1` live counts, retained rows, second-scrap rejection,
  cross-user denial, latch persistence, RLS, and direct-DML denial.
- `SLICE-7-REPORT.md` — lines 1–120: this binding handoff report.

## Design decisions and spec traceability

- **Discrete retained copies:** `dice_copies` has a generated copy UUID plus
  owner, exact catalog item, source kind (`pull|craft|purchase|reward`), bounded
  source reference, grant idempotency key, and acquisition time. A scrap is a
  one-way `scrapped_at` plus `scrap_idempotency_key` transition; update/delete/
  truncate guards prevent mutation or erasure. This implements spec §1.6
  “copy-based ownership” and §6.1 delta 10's append-only/no-negative discipline,
  as formalized by ADR 017 “Discrete-copy dice inventory.”
- **Cheap ownership count:** partial index
  `dice_copies_live_count_idx (user_id, catalog_item_id) WHERE scrapped_at IS
  NULL` supports the live-copy ownership predicate and matched-set counts
  required by spec §1.6 and §6.1 delta 10.
- **Ever-owned latch:** `is_first_copy` is true only on the first retained row
  for one user/catalog pair, enforced by a partial unique index. Grants lock the
  user's stable wallet-account row before checking/inserting, so concurrent
  first acquisitions cannot double-latch. Because the row cannot be deleted or
  have its flag changed, scrap-all and re-grant returns `is_first_copy = false`.
  This follows spec §1.6 “first-copy UI flag (ever-owned latch)” and §6.1 delta
  10, not a zero-to-one live-count transition.
- **Sole write paths and idempotency:** `record_dice_copy_grant` is executable
  only by `service_role`; exact replay returns the original row and payload
  drift fails. `scrap_dice_copy_marker` binds the user to `auth.uid()` and calls
  a non-exposed private primitive. Exact scrap replay returns the original
  transitioned row; a different-key second scrap fails because the copy is no
  longer live. Grant and scrap keys share one user-scoped logical namespace.
- **RLS:** the table forces RLS. Authenticated callers and `service_role`
  receive SELECT only; the owner policy is `(select auth.uid()) = user_id`.
  API roles receive no direct DML.
- **Marker-only scrap:** this slice records the irreversible inventory
  transition required by the task, but intentionally names the public wrapper
  `scrap_dice_copy_marker` and credits no Dust. The valued
  `scrap_dice_copy` RPC, scrap yields, and wallet append remain §6.1 delta 12.
- **No backfill:** §6.1 delta 10 does not prescribe an entitlement backfill,
  while the task says ambiguous backfills must not be invented. Existing
  `user_entitlements` therefore remains untouched and behavior stays dormant.
- **No later deltas:** `0017` grant/duplicate ownership predicates, seal
  predicates, entitlement handling, Dust values, scrap/craft economics, and
  consumer reads remain for deltas 11–14.

## Test output

Final-head focused static command:

```text
$ rtk npm test -- 0020_dice_copy_inventory
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  551ms (transform 31ms, setup 102ms, collect 14ms, tests 7ms, environment 332ms, prepare 6ms)
```

Final-head migration static command:

```text
$ rtk npm test -- supabase/migrations
 Test Files  14 passed (14)
      Tests  114 passed (114)
   Duration  1.62s (transform 294ms, setup 1.64s, collect 349ms, tests 151ms, environment 6.84s, prepare 99ms)
```

Adversarial review found one P2 test gap: the first behavioral draft did not
prove two same-user/same-item copies could be live simultaneously. The fix adds
a second copy and asserts `2 → 1 → 0 → 1`; focused re-review confirmed the
finding resolved. No P0/P1 findings remain.

The Docker-backed live suite was not run in this worktree, per the binding task
boundary. The orchestrator must run:

```text
npm run test:db:supabase
```

## Risks and handoff

- The new behavioral SQL has not yet been parsed/executed by PostgreSQL in this
  sandbox. Static tests are green, but the external live harness is the
  remaining runtime gate.
- Delta 10 is deliberately dormant. Until delta 11 rewires pull ownership and
  grant consumers, existing application behavior continues to use the
  transitional entitlement model.
- The marker wrapper intentionally performs no Dust credit. Calling it from a
  consumer before the later valued scrap RPC lands would discard a live copy
  without economic compensation; this slice adds no consumer call site.
- No commit was created, as required.

## Provenance

Runtime configuration was verified directly from
`/home/donovanyohan/.codex/config.toml`:

- Exact model id: `gpt-5.6-sol`
- Reasoning effort: `high`

---

## Revision 2 — batched review corrections

Revision 1 above is retained verbatim. This revision supersedes its file
counts, focused-test counts, migration-suite counts, and review-closeout
evidence.

### Corrections

- Added ordinary, non-partial
  `dice_copies_catalog_item_id_fkey_idx (catalog_item_id)` for catalog-item
  `ON DELETE RESTRICT` checks and catalog-keyed scans.
- Added ordinary, non-partial
  `dice_copies_user_catalog_item_idx (user_id, catalog_item_id)` to cover
  complete per-user/catalog history scans, including scrapped rows.
- Mirrored `0017` key hygiene exactly:
  `^[A-Za-z0-9][A-Za-z0-9._:-]+$` is now enforced by both table constraints
  and by the grant and scrap trusted-function validation.
- Added owner-role behavioral assertions that reversing `scrapped_at`, changing
  `is_first_copy`, changing `user_id`, and deleting a retained row each fail
  with SQLSTATE `55000`.
- Added authenticated-role behavioral assertions that direct `UPDATE` and
  `DELETE` each fail with `insufficient_privilege`, alongside the existing
  direct-`INSERT` denial.
- Expanded the static suite from 8 to 10 tests to pin both ordinary indexes and
  both constraint/function key-format contracts.

### Revised files

- `supabase/migrations/0020_dice_copy_inventory.sql` — lines 1–398.
- `supabase/migrations/0020_dice_copy_inventory.test.ts` — lines 1–210.
- `supabase/tests/0020_dice_copy_inventory.test.sql` — lines 1–378.
- `SLICE-7-REPORT.md` — revision 2 appended; revision 1 preserved above.

### Required no-Docker test output

Focused command:

```text
$ rtk npm test -- 0020_dice_copy_inventory
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  540ms (transform 31ms, setup 97ms, collect 14ms, tests 8ms, environment 329ms, prepare 5ms)
```

Migration-wide command:

```text
$ rtk npm test -- supabase/migrations
 Test Files  14 passed (14)
      Tests  116 passed (116)
   Duration  1.43s (transform 263ms, setup 1.51s, collect 341ms, tests 135ms, environment 6.08s, prepare 97ms)
```

### Review closure and remaining risk

The pre-gate adversarial hunk review confirmed both new indexes are ordinary
and non-partial, the regex is enforced at storage and trusted-function
boundaries, and each mutation probe runs under the intended owner or
authenticated role. No P0/P1 findings remain.

Per the fix task, no Docker-backed test was run. The behavioral SQL additions
therefore remain pending execution by the orchestrator's live PostgreSQL gate.
No files outside the three `0020` files and this report were edited, and no
commit was created.
