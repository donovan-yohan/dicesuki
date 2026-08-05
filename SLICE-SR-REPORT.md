# SLICE-SR Report — Saved-roll execution on the room backend

## Summary

Implemented the saved-roll execution repair without server/core changes or commits.

- `SavedRollsPanel` now executes through `useDiceBackend()` as a guarded room workflow: clear the local player's current table dice, wait for their removal acknowledgements, send every saved-roll spawn, wait for every exact local-owner `dice_spawned` acknowledgement, install bonuses against those exact IDs, send `roll`, then wait for the matching `roll_started` acknowledgement before marking the roll used and closing.
- Specific owned dice retain their `inventoryDieId` and presentation metadata. Anonymous saved-roll sources use the explicit generic-spawn path.
- Spawn, clear, connection, acknowledgement-timeout, and roll failures remain visible in the panel and cannot produce false success.
- Result labels/bonuses and toolbar availability now read authoritative room dice. The dead client dice manager/spawner and their tests were deleted.
- The wasm-room Playwright spec now creates and executes a 4d6 saved roll and checks clear, exact dice types/count, roll start, saved-roll result name, and four per-die bonuses.
- An adversarial review found no unresolved P0/P1 issue in the changed clear → spawn acknowledgement → roll acknowledgement path.

No files under `server/` or `server/core/` were changed. No commit was created.

## Files and lines

| File | Relevant lines | Change |
| --- | ---: | --- |
| `src/components/panels/SavedRollsPanel.tsx` | 21-72, 120-192, 236-248, 323-357 | Added room acknowledgement helpers, guarded clear/spawn/roll execution, exact-ID bonus reconciliation, inline errors, and in-flight button disabling. |
| `src/components/panels/SavedRollsPanel.test.tsx` | 1-190 | Added RTL coverage for ordered backend calls, out-of-order acknowledgements, unrelated-owner dice, exact bonus IDs, spawn rejection, and roll rejection. |
| `src/contexts/DiceBackendContext.tsx` | 9-20 | Made both spawn APIs return their client request ID or `null`. |
| `src/hooks/useMultiplayerDiceBackend.ts` | 26-65, 71-78 | Returns room spawn IDs, preserves specific-die presentation metadata, provides a plain generic spawn, and reuses the existing owner-scoped clear. |
| `src/store/useMultiplayerStore.ts` | 114-162, 244-264, 516-538, 656-702, 794-802, 830-882, 912-921 | Tracks actionable room errors and roll acknowledgements; sends client-generated spawn IDs; returns send success IDs; records disconnected, duplicate, send, and server failures. |
| `src/components/Scene.tsx` | 806-955 | Replaced the stale legacy result read with authoritative room dice and room presentation metadata; existing totals now consume bonuses keyed by acknowledged room IDs. |
| `src/components/layout/DiceToolbar.tsx` | 37-76 | Replaced the stale legacy table read with local-owner room dice plus pending inventory IDs. |
| `src/components/layout/DiceToolbar.test.tsx` | changed room-store setup/assertions | Updated toolbar tests for the authoritative room state. |
| `src/components/SoloRoom.tsx` | 33-68, 76-86, 126-136 | Removed legacy cleanup and exposed room dice count/types and roll sequence for the existing wasm-room harness. |
| `src/components/multiplayer/MultiplayerRoom.tsx` | 59-68 | Removed legacy manager cleanup while retaining unified result-state cleanup. |
| `src/components/panels/saved-rolls/SavedRollCard.tsx` | 11-27, 124-135 | Added disabled execution state and a stable accessible roll name. |
| `src/contexts/ThemeProvider.tsx` | 8-12, 58-61 | Removed dead legacy-manager color synchronization. |
| `src/contexts/ThemeProvider.test.tsx` | 1-44 | Removed dead-manager assertions while preserving theme behavior coverage. |
| `src/store/useInventoryStore.ts` | 247-251 | Corrected the consumer-contract comment to name the room backend. |
| `e2e/solo-wasm-room.spec.ts` | 93-118 | Added real worker/WASM saved-roll execution coverage. |
| `docs/guides/saved-rolls.md` | 8-85 | Documented the room-authoritative lifecycle, exact-ID reconciliation, failures, and test expectations; removed stale count-based guidance. |
| `CLAUDE.md` | 55 | Names `DiceBackendContext` → room protocol as the single table-dice source of truth. |
| `src/lib/diceSpawner.ts` | deleted, 213 lines | Removed the dead legacy spawner. |
| `src/lib/diceSpawner.test.ts` | deleted, 78 lines | Removed tests for the deleted spawner. |
| `src/store/useDiceManagerStore.ts` | deleted, 120 lines | Removed the dead legacy client dice manager. |
| `src/store/useDiceManagerStore.test.ts` | deleted, 41 lines | Removed tests for the deleted manager. |

## Sequencing and reconciliation decisions

The implementation uses a guarded workflow/state machine rather than inferring completion from message count or arrival order:

1. Capture the current local-owner IDs.
2. Send `remove_dice` through the existing backend clear and wait until every captured ID is absent.
3. Expand saved-roll sources. Specific sources call `addDie(type, inventoryDieId)`; anonymous sources call `addGenericDie(type)`.
4. Retain each client-generated request ID with its requested bonus.
5. Wait until the authoritative room map contains every exact request ID with the local owner. Arrival order and unrelated players' dice do not affect reconciliation.
6. Set `ActiveSavedRoll.perDieBonuses` using those confirmed exact IDs.
7. Capture the current roll sequence, send `roll`, and require a newer `roll_started` whose ID set exactly matches the saved-roll spawn set.
8. Only then mark the saved roll used and close. Each acknowledgement phase has a five-second timeout.

Why this is safe:

- Browser WebSocket message fragments are delivered in sender order by [RFC 6455 section 5.4](https://www.rfc-editor.org/rfc/rfc6455#section-5.4). The native endpoint consumes one `ws_receiver.next()` loop and dispatches each parsed message in that loop (`server/src/ws_handler.rs:92-126`); its spawn, remove, and roll arms are `server/src/ws_handler.rs:244-299`.
- The solo transport posts each send to one worker (`src/lib/workerRoomTransport.ts:129-141`), the worker handles sends through one `onmessage` dispatch (`src/workers/roomWorker.ts:111-127`), and the WASM host synchronously dispatches spawn, remove, and roll (`server/wasm/src/host.rs:121-152`).
- The client creates and sends the die ID in the `spawn_dice` entry (`src/store/useMultiplayerStore.ts:830-867`). Native and WASM hosts broadcast the spawned entries returned by the room (`server/src/ws_handler.rs:244-251`, `server/wasm/src/host.rs:128-133`), and the client inserts those echoed IDs into the authoritative map (`src/store/useMultiplayerStore.ts:656-668`).
- Socket ordering alone was not treated as sufficient. The client explicitly gates each phase on authoritative acknowledgements, so a roll cannot race ahead of spawn acceptance and a rejected spawn cannot silently become a partial roll.
- Observer-style completion was rejected because raw notification order/count is weaker than the required invariant. Exact client IDs plus a guarded workflow provide deterministic, order-independent reconciliation.

## Test output

### Targeted Vitest

Command:

```text
rtk npx vitest run src/components/panels/SavedRollsPanel.test.tsx src/store/useMultiplayerStore.test.ts src/components/layout/DiceToolbar.test.tsx src/contexts/ThemeProvider.test.tsx
```

Result:

```text
✓ src/store/useMultiplayerStore.test.ts (61 tests)
✓ src/contexts/ThemeProvider.test.tsx (1 test)
✓ src/components/panels/SavedRollsPanel.test.tsx (3 tests)
✓ src/components/layout/DiceToolbar.test.tsx (8 tests)
Test Files  4 passed (4)
Tests       73 passed (73)
```

### Full frontend suite

Required command:

```text
rtk npm test -- --run
```

Result:

```text
Test Files  3 failed | 130 passed (133)
Tests       17 failed | 1274 passed (1291)
Duration    20.63s
```

All 17 failures are confined to these three immutable-history guard files:

```text
scripts/check-immutable-catalog-history.test.ts   4 failures
scripts/check-immutable-economy-history.test.ts   8 failures
scripts/check-immutable-migration-history.test.ts 5 failures
Error: spawnSync git EPERM
```

Each failing test attempts `execFileSync('git', ...)`; this managed sandbox denies that child process. No product test or changed saved-roll test failed. A run excluding only those three sandbox-blocked files passed `130` test files / `1274` tests.

### Lint

```text
> eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
exit 0
```

### Production build

Command:

```text
rtk npm run build
```

Key output:

```text
Verified 69 collectible catalog items
Verified 1 immutable economy contract edition(s)
Verified 1 immutable economy simulation scenario(s)
Verified 1 immutable production economy edition(s)
Runtime dice assets passed (cozy-forest-imagegen-set): 6 dice, 3595840 bytes
Runtime dice assets passed (cyberpunk-imagegen-set): 6 dice, 3642714 bytes
Runtime dice assets passed (dark-dungeon-imagegen-set): 6 dice, 3680224 bytes
Verified dice manifest: 4 sets, 19 dice
✓ 1213 modules transformed.
✓ built in 5.88s
PWA v1.3.0
files generated
  dist/sw.js
  dist/workbox-f3c018a6.js
```

Build exited `0`. Vite emitted its existing advisory that some chunks exceed 500 kB.

## E2E coverage

`e2e/solo-wasm-room.spec.ts:93-118` now:

1. Opens the actual solo worker/WASM room and verifies the seeded d20.
2. Creates a saved roll through the UI.
3. Adds `4d6` with a per-die bonus of `+2`.
4. Executes the saved roll.
5. Verifies the old d20 was cleared, exactly four d6 remain, `roll_started` advanced, the saved-roll name is displayed, and four `+2` result bonuses render.

The required browser command was attempted:

```text
> PLAYWRIGHT_TEST_PORT=${PLAYWRIGHT_TEST_PORT:-18181} playwright test e2e/solo-wasm-room.spec.ts
Error: Process from config.webServer was not able to start. Exit code: 1
```

Directly starting the configured Vite server identified the sandbox restriction:

```text
error when starting dev server:
Error: listen EPERM: operation not permitted 127.0.0.1:18181
```

The spec is written but cannot execute in this sandbox because it cannot bind the Playwright web-server port.

## Risks and environment constraints

- The backend clear is intentionally owner-scoped. In multiplayer, it clears every die owned by the executing player, never another player's dice; that preserves the server authority boundary.
- Acknowledgement waits use a five-second timeout. A very delayed room will show a retryable inline timeout rather than report false success.
- `roomActionError` is room-wide state, so any server action error arriving during this workflow aborts it visibly. This is conservative and avoids a partial silent roll.
- Initial `git fetch origin` could not update the linked worktree metadata:

  ```text
  FAILED: git fetch
  error: cannot open '/home/donovanyohan/Documents/Programs/personal/dicesuki/.git/worktrees/slice1-roll-tickets/FETCH_HEAD': Read-only file system
  ```

  The checked-out HEAD and local `origin/main` were both `387f361bc656bab577dfeb1b9b946a4510397a9b` when implementation began, so the requested slice started from the available main baseline. During final verification, another process advanced the local `origin/main` ref to `594ec1fa2cc31b4573f7de424038f3c27ef26307` (`feat(economy): paid Stars bucket enablement (migration 0027) (#197)`). That one-commit delta only changes `supabase/migrations/` and `supabase/tests/`, with no overlap with this slice. The worktree is therefore one commit behind current local `origin/main`; it was not rebased because the task forbids commits and the in-progress diff must not be disturbed.
- Pattern-adoption evidence could not be written outside the workspace:

  ```text
  error: [Errno 30] Read-only file system: '/home/donovanyohan/.codex/pattern-evidence'
  ```

- Existing unrelated untracked task/report files were preserved. The implementation stayed within the task's `src/`, documentation, and e2e boundaries plus this required report.

## Provenance

- Primary orchestrator and final implementation/verification: exact model ID `gpt-5.6-sol`; reasoning effort `high` (from the active Codex configuration).
- Delegated protocol investigation and adversarial review: exact model ID `gpt-5.6-terra`; reasoning effort was not exposed by the delegation runtime and is therefore reported as unavailable rather than guessed.
- Delivery method: intent/boundary audit, guarded-workflow pattern check, targeted tests, one adversarial review, one focused fix pass, and exact-head gates.
- Commit status: no commits created.
