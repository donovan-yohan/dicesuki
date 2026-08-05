# Fix — Saved-rolls execution on the room backend

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `fix/saved-rolls-room-backend` (create off origin/main; fetch first).
User-reported regression: executing a saved roll does nothing — the room-first
refactor (Shared-ADR-005/007) left `SavedRollsPanel.handleRoll` writing to the
dead legacy client store. PO acceptance: **tapping Roll on a saved roll must
CLEAR the table of other dice, spawn that roll's dice, and roll them.**

## Diagnosis (verified, build on it — do not re-derive)
- Dead: SavedRollsPanel.tsx:71 `useDiceManagerStore.removeAllDice()`, :81
  `spawnSpecificDie(...)`, :84,90 legacy `addDice`, no `roll()` ever fired;
  failures invisible (dead store always accepts).
- Live pattern: Scene.tsx:486 `handleAddDice` → `activeBackend.addDie(type,
  inventoryDieId)` (useMultiplayerDiceBackend.ts:27,59 → useMultiplayerStore
  `spawnDice` → `spawn_dice` WS) ; roll = `activeBackend.roll()` →
  `{type:'roll'}` (Scene.tsx:595, useMultiplayerStore.ts:860).
- Wrinkle: `spawnDice` returns void; server assigns ids async via
  `dice_spawned` — the current sync `perDieBonuses` keying
  (SavedRollsPanel.tsx:97) cannot work inline.
- Stale legacy reads: Scene.tsx:811 (ResultDisplay), DiceToolbar.tsx:41.
- docs/guides/saved-rolls.md partly stale (`expectedDiceCount`).

## Task
1. Rewire `handleRoll` to the room backend (panel already sits inside the
   DiceBackendProvider): verify/obtain `useDiceBackend()`; sequence =
   clear-table (find the backend's existing clear mechanism — if none exists
   on the protocol, STOP and report rather than inventing an engine change)
   → `addDie` per expanded saved-roll source (owned dice carry their
   inventoryDieId so presentation metadata flows; anonymous types plain) →
   `roll()`. Confirm WS ordering guarantees (same socket, server processes
   in order) and cite where; if roll-before-spawn-ack is racy in the
   protocol, gate roll on the expected `dice_spawned` acks.
2. Per-die bonus reconciliation: key `ActiveSavedRoll` bonuses via post-spawn
   id reconciliation (match `dice_spawned` results to the requested spawn
   list by order/presentation) or presentation metadata — choose the robust
   option the protocol actually supports, document it. Bonus/result display
   must work end-to-end (fix the stale ResultDisplay read at Scene.tsx:811
   as part of this — it must read the room store).
3. User-visible failure states: spawn/roll errors surface (toast/inline per
   panel idioms), no more silent success.
4. Dead-code cleanup: delete src/lib/diceSpawner.ts and
   src/store/useDiceManagerStore.ts, fix the stale reads (Scene.tsx:811,
   DiceToolbar.tsx:41), remove dead imports. Update the CLAUDE.md gotcha
   line ("All dice spawning goes through src/lib/diceSpawner.ts") to name
   the real single source of truth (the room backend / spawn_dice protocol
   path). Update docs/guides/saved-rolls.md where stale.
5. Tests: RTL/unit for the rewired handleRoll (mock backend: clear→spawnN→
   roll sequence, bonus reconciliation incl. out-of-order dice_spawned,
   error surfaces); EXTEND the existing wasm-room e2e
   (e2e/solo-wasm-room.spec.ts — read its harness) with a saved-roll
   execution case: create a saved roll, execute, assert table cleared +
   correct dice present + roll fired (whatever room-state observables the
   spec already uses). Do not run playwright yourself if the sandbox blocks
   it — write it; orchestrator runs it.

## Boundaries
src/ + docs/guides/saved-rolls.md + CLAUDE.md gotcha line + e2e spec. NO
server/core changes (if the protocol lacks table-clear, stop+report). No
commits. Run: targeted vitest + `npm test` + `npm run build` (paste lines).

## Report
`SLICE-SR-REPORT.md`: summary, files+lines (incl. deletions), sequencing/
reconciliation decisions with protocol citations, test output, what the e2e
covers, risks, provenance (EXACT model id + effort).
