# Slice 13 Report — Client Economy Data Layer

## Summary

Implemented the authenticated client economy data layer without UI, migration,
edge-function, dice-spawner, or dice-presentation changes.

- Added strict, injected-client wallet and roll-ticket readers.
- Added a bounded balance watcher with initial fetch, two
  `postgres_changes` handlers, 4s/8s/15s/30s polling backoff, a 30-minute TTL,
  and idempotent teardown.
- Added strict Lunar subscription reads/watch filtering with the single-sourced
  client product ID `lunar-pass`.
- Added strict full-history `dice_copies` reads, live-copy grouping,
  `everOwned`, and first-copy timestamp derivation.
- Added a dedicated, non-persisted wallet Zustand store with loading/stale
  state, session-safe refresh/Realtime handling, sign-out reset, and
  Stars-to-standard-roll conversion.
- Added a v4 inventory persistence migration and an ephemeral authenticated
  server-copy view joined to the authoritative catalog snapshot.
- Wired starter entitlements, entitlements, catalog, copies, balances, tickets,
  and subscription data into sign-in sync; sign-out tears down watchers and
  restores guest inventory.
- Ran an independent adversarial review plus one focused re-review. All P0/P1
  findings were closed before the final gates.

## Files and line anchors

### Production

- `src/lib/walletBalances.ts`
  - types, typed errors, Lunar product constant: lines 4–74
  - strict wallet/ticket readers: lines 78–209
  - bounded wallet/ticket watcher: lines 211–305
  - Lunar subscription read/watch filter: lines 307–392
  - conversion wrapper and strict receipt parsing: lines 394–461
- `src/lib/diceCopies.ts`
  - copy/group types and typed error: lines 4–32
  - strict full-history read and live/ever-owned grouping: lines 34–128
- `src/store/useWalletStore.ts`
  - dedicated non-persisted server-authoritative store: lines 1–192
  - guarded refresh/Realtime/sign-out lifecycle: lines 51–153
  - optimistic conversion receipt application and best-effort reconciliation:
    lines 155–192
- `src/store/useInventoryStore.ts`
  - retained local dice/assignment slice and actions: lines 44–151
  - complete catalog join into the unchanged `InventoryDie` contract:
    lines 252–308
  - v3-to-v4 migration: lines 317–357
  - server-copy precedence and guest restoration: lines 983–1014
  - persistence v4 and server-copy exclusion: lines 1021–1053
- `src/lib/dataSync.ts`
  - v4 local-only inventory sync payload: lines 68–91
  - sign-in catalog/entitlement/copy/wallet wiring: lines 309–348
  - sign-out teardown/reset: lines 351–384

### Tests

- `src/lib/walletBalances.test.ts` (232 lines): reader validation, duplicate
  rejection, watcher initial/Realtime/poll/TTL teardown, strict conversion
  success/generic error/insufficient mapping, and fetched/Realtime Lunar filter.
- `src/lib/diceCopies.test.ts` (71 lines): live grouping plus retained scrapped
  first-copy latch and malformed-row rejection.
- `src/store/useWalletStore.test.ts` (247 lines): refresh, Realtime application,
  sign-out reset, optimistic conversion, failed reconciliation, delayed refresh,
  delayed subscription, and in-flight conversion session invalidation.
- `src/store/useInventoryStore.serverCopies.test.ts` (148 lines): server-copy
  precedence, guest dice/assignment restoration, v3 migration, persistence
  exclusion, and fail-closed incomplete catalog joins.
- `src/lib/dataSync.slice13.test.ts` (73 lines): sign-in orchestration reaches
  catalog, asset, entitlement, copy, wallet, ticket, and subscription tables.

The pre-existing `src/lib/dataSync.test.ts` and
`src/store/useInventoryStore.test.ts` have no diff. The protected consumers
`src/lib/diceSpawner.ts` and `src/lib/dicePresentation.ts` have no diff.

## Merge rule and persistence decisions

Frontend-ADR-002 requires a dedicated Zustand domain, new `Map`/`Set`
instances, versioned persisted stores with migration, and `partialize` for
ephemeral/non-serializable state (`.claude/rules/architecture.md:18–25`).

- **Authenticated merge rule:** a complete server `dice_copies` + authoritative
  catalog join replaces the active `dice` list used by the existing spawner and
  presentation consumers. The pre-sign-in local dice and assignments are kept
  in `localDice`/`localAssignments` and restored on sign-out. There is no union
  of local and server identities because it could duplicate ownership or attach
  saved-roll assignments to the wrong identity domain.
- **Fail-closed join:** if the catalog fetch is unavailable, or any live copy
  lacks its catalog item/asset, the server view is not activated and the local
  view remains intact. A partial owned inventory is never presented as complete.
- **Inventory persistence:** schema version is bumped from v3 to v4. Migration
  clones v3 `dice` and `assignments` into retained local fields. `partialize`
  always serializes the retained local/guest view and writes
  `serverCopiesActive: false`; server copy rows are rebuilt from server truth on
  sign-in.
- **Wallet persistence:** `useWalletStore` intentionally does not use
  `persist`. Wallet, tickets, and subscription state are server-authoritative;
  persisting them would make an old local snapshot appear authoritative.
- **Local currency stub:** the pre-existing inventory `Currency` remains
  local/guest-only and is not treated as the server wallet.

## Test and build evidence

All commands were run from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`.

### Required focused commands

`npm test -- walletBalances` (exit 0):

```text
Test Files  1 passed (1)
     Tests  8 passed (8)
```

`npm test -- diceCopies` (exit 0):

```text
Test Files  1 passed (1)
     Tests  2 passed (2)
```

`npm test -- useWalletStore` (exit 0):

```text
Test Files  1 passed (1)
     Tests  7 passed (7)
```

`npm test -- useInventoryStore` (exit 0):

```text
Test Files  2 passed (2)
     Tests  11 passed (11)
```

`npm test -- dataSync` (exit 0):

```text
Test Files  2 passed (2)
     Tests  12 passed (12)
```

### Full suite

`npm test` was run exactly as required (exit 1):

```text
Test Files  3 failed | 124 passed (127)
     Tests  17 failed | 1153 passed (1170)
```

All 17 failures are confined to the three immutable-history test files:

- `scripts/check-immutable-catalog-history.test.ts`
- `scripts/check-immutable-economy-history.test.ts`
- `scripts/check-immutable-migration-history.test.ts`

Each fails at its unchanged `execFileSync('git', ...)` helper with the exact
environment error:

```text
Error: spawnSync git EPERM
```

The sandbox limitation was reproduced independently with Node invoking
`git --version`; Node received stdout `git version 2.39.5` but still threw
`spawnSync git EPERM`. Running the migration-history file alone produced the
same 5/5 failures.

As a diagnostic only, the suite was rerun excluding exactly those three
environment-blocked files (exit 0):

```text
Test Files  124 passed (124)
     Tests  1153 passed (1153)
```

No Slice 13 test failed in the exact full-suite run.

### Production build

`npm run build` (exit 0):

```text
Verified 69 collectible catalog items
Verified 1 immutable economy contract edition(s)
Verified 1 immutable economy simulation scenario(s)
Verified 1 immutable production economy edition(s)
Verified dice manifest: 4 sets, 19 dice
✓ 1208 modules transformed.
✓ built in 5.84s
PWA v1.3.0
precache  24 entries (3786.47 KiB)
files generated
  dist/sw.js
  dist/workbox-f3c018a6.js
```

The existing Vite large-chunk warning remains; build/typecheck completed.
`git diff --check` is clean. No commit was created.

## Risks and follow-ups

1. **Wallet/ticket Realtime publication is not deployed by the current
   migrations.** The migration history publishes `payment_orders`
   (`0013:557`) and `user_subscriptions` (`0023:606`), but not
   `wallet_balances` or `roll_ticket_balances`. Therefore wallet/ticket channels
   are polling-backed only until a future migration publishes those tables.
   Migrations were explicitly outside this slice, so no publication change was
   made.
2. **Full immutable-history gate is sandbox-blocked.** The product/test code is
   green outside the three files whose nested Git subprocess is denied. Those
   guards should be rerun in normal CI or an execution environment that permits
   Node child-process Git.
3. **Fail-closed catalog availability:** signed-in users retain the local view
   rather than seeing a partial server inventory when the authoritative catalog
   or join is incomplete. A future UI slice should expose that stale/offline
   state rather than silently implying a refreshed server inventory.
4. This slice provides injected-client unit proof and a production build; it
   does not claim live hosted Supabase or UI/device dogfood.

## Provenance

Runtime configuration:

```text
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
```

No commit was created, per task boundary.

---

## Revision 2 — Batched review-finding closure

Revision 1 above is preserved verbatim. This revision records the six
`SLICE-13-FIX-TASK.md` findings and their exact-head evidence.

### Summary and behavior decisions

1. **Session-long wallet watch:** removed the 30-minute watcher TTL. Polling and
   both Realtime handlers now remain live until explicit unsubscribe, so
   polling-only wallet/ticket deployments cannot silently freeze while looking
   fresh (`src/lib/walletBalances.ts:223–310`).
2. **Conversion double-spend protection:** the wallet store now coalesces
   concurrent conversion calls behind one in-flight promise. Reset/account
   transitions clear the guard without allowing an older promise to clear a
   newer attempt. The RPC wrapper retries one thrown transport failure with the
   same generated or caller-supplied idempotency key; server-returned hard
   failures are not retried (`src/lib/walletBalances.ts:407–489`,
   `src/store/useWalletStore.ts:28–209`).
3. **Coalesced refresh:** a boolean pending latch queues exactly one
   fetch-after-current when any Realtime/poll signal arrives during an active
   read. Teardown suppresses the queued read (`src/lib/walletBalances.ts:235–257`).
4. **Lunar DELETE:** a DELETE whose replica-identity payload lacks both old and
   new `product_id` now triggers a refresh; known non-Lunar products remain
   filtered (`src/lib/walletBalances.ts:375–395`).
5. **No-channel sign-in consistency:** data sync sets the authenticated wallet
   `userId` before the initial economy refresh, independent of whether the
   injected/offline client implements `.channel`
   (`src/lib/dataSync.ts:309–350`).
6. **Real persistence migration coverage:** the v3→v4 and earliest historical
   v1 paths now write versioned localStorage payloads and invoke Zustand
   `persist.rehydrate()`, proving the configured middleware calls the migration
   and restores the retained local fields
   (`src/store/useInventoryStore.serverCopies.test.ts:111–148`).

### Revision 2 files

- `src/lib/walletBalances.ts`
- `src/store/useWalletStore.ts`
- `src/lib/dataSync.ts`
- `src/lib/walletBalances.test.ts`
- `src/store/useWalletStore.test.ts`
- `src/store/useInventoryStore.serverCopies.test.ts`
- `src/lib/dataSync.slice13.test.ts`
- `SLICE-13-REPORT.md`

The existing Slice 13 `diceCopies` production and test files were unchanged by
this fix pass. No file outside the Slice 13 production/test/report boundary was
edited.

### Review closure

After the targeted tests, an independent adversarial review checked every
finding-specific runtime and test seam. It found no P0/P1 or other valid
blocking finding: the queued fetch is boolean-coalesced and teardown-safe; the
conversion key and promise guard are stable across retry/reset; unknown DELETE
handling is event-scoped; no-channel setup precedes refresh; and middleware
coverage exercises v3 plus historical v1. Because no fix was requested by the
review, there was no post-review production delta requiring another broad
review.

### Exact test and build evidence

Commands were run from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`
through the repository-required RTK command wrapper.

`rtk npm test -- walletBalances` (exit 0):

```text
Test Files  1 passed (1)
     Tests  11 passed (11)
```

`rtk npm test -- diceCopies` (exit 0):

```text
Test Files  1 passed (1)
     Tests  2 passed (2)
```

`rtk npm test -- useWalletStore` (exit 0):

```text
Test Files  1 passed (1)
     Tests  8 passed (8)
```

`rtk npm test -- useInventoryStore` (exit 0):

```text
Test Files  2 passed (2)
     Tests  13 passed (13)
```

`rtk npm test -- dataSync` (exit 0):

```text
Test Files  2 passed (2)
     Tests  12 passed (12)
```

`rtk npm test` (the exact full `npm test` gate, exit 1):

```text
Test Files  3 failed | 124 passed (127)
     Tests  17 failed | 1159 passed (1176)
```

All 17 failures remain confined to the same three immutable-history files
documented in Revision 1:

- `scripts/check-immutable-catalog-history.test.ts`
- `scripts/check-immutable-economy-history.test.ts`
- `scripts/check-immutable-migration-history.test.ts`

Every failure has the unchanged sandbox error:

```text
Error: spawnSync git EPERM
```

The exact full run passed all Slice 13 tests, including the new
`walletBalances` 11-test file, `useWalletStore` 8-test file, inventory
middleware migration cases, and no-channel data-sync assertion.

`rtk npm run build` (the exact production `npm run build` gate, exit 0):

```text
Verified 69 collectible catalog items
Verified 1 immutable economy contract edition(s)
Verified 1 immutable economy simulation scenario(s)
Verified 1 immutable production economy edition(s)
Runtime dice assets passed (cozy-forest-imagegen-set): 6 dice, 3595840 bytes
Runtime dice assets passed (cyberpunk-imagegen-set): 6 dice, 3642714 bytes
Runtime dice assets passed (dark-dungeon-imagegen-set): 6 dice, 3680224 bytes
Verified dice manifest: 4 sets, 19 dice
✓ 1208 modules transformed.
✓ built in 5.79s
PWA v1.3.0
precache  24 entries (3786.88 KiB)
files generated
  dist/sw.js
  dist/workbox-f3c018a6.js
```

The pre-existing large-chunk warning remains; TypeScript and the production
bundle completed successfully. `rtk git diff --check` completed with exit 0 and
no output.

### Remaining risks and blockers

- The only full-suite blocker remains the sandbox denial of nested
  `execFileSync('git', ...)` in the three immutable-history test files. No Slice
  13 test failed.
- Wallet/ticket tables remain polling-backed until a future, out-of-scope
  migration publishes them to Realtime. Removing the TTL makes polling
  session-long, closing the silent-freeze failure without widening this slice
  into migrations.
- No hosted Supabase or UI/device claim is added by this client data-layer fix.

### Revision 2 provenance

Runtime configuration:

```text
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
```

No commit was created.
