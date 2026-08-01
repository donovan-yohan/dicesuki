# Saved Rolls Bonus System

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed saved rolls guidance.

## Overview
The saved rolls feature allows users to save dice roll configurations with bonuses (flat bonuses and per-die bonuses) and advanced mechanics (keep/drop, exploding, reroll, min/max clamps, success counting). The system intelligently manages bonus state to ensure bonuses only apply when appropriate.

## Architecture

### Core Components
1. **`useDiceStore.ts`**: Manages `activeSavedRoll` state with bonus + plan tracking
2. **`savedRollPlan.ts`**: Maps a roll's mechanics onto physical room dice, and scores them
3. **`savedRollExecution.ts`**: Runs the roll as spawn waves over the room protocol
4. **`SavedRollsPanel.tsx`**: Thin wrapper — latch, inline errors, panel close
5. **`useMultiplayerStore.ts`**: Owns authoritative room dice and protocol acknowledgements
6. **`Scene.tsx`**: Reads room dice and displays results with bonuses and kept/dropped state
7. **`diceHelpers.ts`**: Formats saved roll formulas, badges and ranges

### Bonus State Structure
```typescript
activeSavedRoll: {
  name: string
  flatBonus: number                    // Flat bonus added to total (e.g., +4)
  perDieBonuses: Map<string, number>   // Per-die bonuses (dice ID → bonus), group roots only
  plan?: SavedRollPlan                 // Advanced mechanics, mapped to room dice ids
} | null
```

## Bonus Lifecycle

### 1. Execute Saved Roll
When user executes a saved roll (e.g., "6d6 + 4"):
- Clears the local player's current room dice and waits for the exact removals
- Expands saved-roll sources in order; owned sources use `addDie(type, inventoryDieId)` so presentation metadata flows, while anonymous sources use `addGenericDie(type)`
- Waits for `dice_spawned` to contain every exact client request ID for the local owner; response arrival order does not matter
- Reconciles each confirmed room die ID to its requested per-die bonus
- Sends `roll`, waits for the matching local `roll_started`, then marks the saved roll used and closes the panel
- Leaves the panel open with an inline error if clear, spawn, or roll fails or times out

### 2. Result Display
Shows total with bonuses:
- **Grand Total**: `diceSum + perDieBonusesTotal + flatBonus`, or the plan's aggregate when the roll uses advanced mechanics
- **Individual Dice**: Shows the reconciled per-die bonus next to each face value
- **Flat Bonus**: Shows a separate bonus chip when non-zero (hidden in success-counting mode, which ignores it)
- **Dropped dice**: Dimmed and struck through, with an `N dropped` hint
- **Roll notice**: A transient line for follow-up waves that ran out of table

## Advanced Mechanics (physical execution)

There is no server-side notion of a saved roll. `roll_player_dice` (`server/core/src/room.rs`) applies an impulse to **every** die the player owns, and `roll_complete.total` is a plain face sum. So every mechanic is orchestrated client-side as physical spawn waves over the existing protocol — this slice added **no** server, core or protocol changes.

### Waves (`savedRollExecution.ts`)

1. **Base** — clear our dice, spawn `rollCount` dice per entry, send `roll`, wait for all to settle. This is the **only** wave that sends `roll`; a second `roll` would re-roll the dice that already landed.
2. **Reroll** — dice matching the condition are `remove_dice`d and respawned. A spawned die falls from `SPAWN_HEIGHT` and settles on its own, so **for follow-up waves the spawn IS the roll**. Once only: the replacement's face is final. Owned dice are respawned as themselves (removal is awaited first, or `addDie` refuses the duplicate).
3. **Explosions** — each die showing the trigger face spawns one more die whose face **adds** to it. Repeats while dice keep exploding, bounded by `MAX_EXPLOSION_WAVES` (3) and by free room capacity.

> **Known divergence.** `ExplodingConfig.limit` is honoured verbatim by the virtual `rollEngine.ts` (`limit ?? Infinity`), but the physical path uses `min(limit ?? 3, 3)` — every explosion costs a real room slot. An entry with `limit: 10` therefore chains up to 10 times virtually and at most 3 times on the table. `rollEngine.ts` has no production consumers, so this only matters if it ever gains one; the builder never offers a limit above the cap.

The panel closes as soon as the base wave starts rolling, which splits error handling in two:
- **Before** that point → the promise rejects and `SavedRollsPanel` renders its inline alert.
- **After** → `useDiceStore.rollNotice`, rendered by the result HUD (the panel is gone).

Either way `executingRef` is held for the whole sequence, so a second roll can never interleave with a half-finished plan, and `finishSavedRollWaves()` always runs so the history row closes and `savedRollWavesPending` never sticks.

While `savedRollWavesPending` is true:
- the HUD's Roll button is disabled (`roll` impulses **every** die the player owns, so it would re-roll dice that already landed and invalidate the plan);
- reopening the saved-rolls panel shows "Still rolling — waiting for the follow-up dice to land" and its roll buttons are disabled, because the execution latch would silently reject them;
- `roll_complete` for the local player is suppressed — `finishSavedRollWaves` writes the authoritative row instead, carrying the same player attribution `roll_complete` would have.

### Invariant: the backend clears the saved-roll context on every spawn
`useMultiplayerDiceBackend.addDie`/`addGenericDie` call `clearActiveSavedRoll()` as their first act — including the executor's own follow-up-wave spawns. Therefore:
- `clearActiveSavedRoll` **must not** touch `savedRollWavesPending`; that flag is owned solely by `beginSavedRollWaves`/`finishSavedRollWaves`. (It did once, which tore down wave tracking on the first reroll or explosion spawn and split one roll across several history rows.)
- every wave **must** re-`publishPlan` after its spawns and **before** `markDiceRolling`, so nothing can observe a settle while the plan is missing.

Both are pinned by `src/lib/savedRollExecution.test.ts`: the fake room's spawn reproduces the `clearActiveSavedRoll` side effect, and one test drives the real `useMultiplayerDiceBackend` with only the protocol send stubbed.

A wait started mid-sequence only fails on a room error raised **after** it began (identity comparison against the error present at wait start) — a stale error from before the roll must not abort a wave that is doing nothing wrong.

### Capacity budgeting
`getRollDiceCount` counts `rollCount` (not `quantity`) toward the 30-die cap, so keep/drop is pre-validated in the builder and re-checked at execution. **Exploding is deliberately not pre-counted** — its worst case is unbounded. Each explosion wave is budgeted against whatever is actually free at that moment; anything that does not fit is skipped and reported through `rollNotice`.

### Scoring (`savedRollPlan.ts`)
A plan groups room dice into **chains** whose faces sum into one logical die result (an explosion joins its parent's chain; a reroll replaces the chain's member). Order of operations matches `rollEngine.ts`: clamp the chain total → add the per-die bonus → keep/drop on those values → sum, or count successes. A roll with any success-counting entry ignores the flat bonus. Dice that have not settled are ignored rather than counted as zero, so a partially settled table shows a running total.

`keepMode` is optional on `DiceEntry` and nothing validates it at runtime, so it defaults to `KEEP_MODE_DEFAULT` (`'highest'`) in one place — `diceHelpers.ts` — and the notation, badges, `rollEngine` and the plan all read that same default.

### Notation
`formatDiceEntry` appends in a fixed order: exploding binds to the die (`4d6!`, `4d6!5`), then ` kh2`/` kl2`, ` r≤2`, ` ≥5`, ` [2 specific]`. Min/max clamps are a badge, not notation. `calculateDiceEntryRange` returns `{ min, max, open? }`; `open` marks an exploding entry, rendered as `Range: 4 - 12+`.

### Known limitation — remote viewers
The plan is **client-side only** and never crosses the wire. A remote viewer in a multiplayer room sees each die's raw face and a raw face sum: no keep/drop, clamps, success counting or bonuses. Their history row is attributed (`displayName`) and carries no saved-roll name, so nothing they see is a mislabelled combined total — it is simply the unadorned dice. Correcting remote totals would need the plan on the protocol, which is out of scope for this slice.

### 3. Clear Bonuses
`activeSavedRoll` is automatically cleared when:
- The user manually adds dice through the room backend
- A saved-roll clear/spawn/roll phase fails
- The unified dice result state is reset

## Formula Formatting

The `formatSavedRoll()` function properly handles operators:
- **Positive bonus**: `6d6 + 4` (not `6d6 + +4`)
- **Negative bonus**: `6d6 - 4` (not `6d6 + -4`)

## Percentile (d100) Entries

A d100 is **not** a hundred-sided die. It is a pair of physical dice:

| Half | Engine shape | Faces |
|------|--------------|-------|
| Tens | `d10tens` | `00, 10, … 90` |
| Ones | `d10` | `0 … 9` |

The result is `tens + ones`, with `00 + 0` reading **100** — so the range is
1–100. Per-die bonus applies once, to the combined value.

### Entry model

A percentile entry keeps `type: 'd10'` (the ones half) and adds one additive
marker, `DiceEntry.percentile?: true` (`src/types/savedRolls.ts`).

`'d100'` is deliberately **not** a `DiceShape`. Keeping `type` a real shape means
persistence, `rollSources` normalization, per-die bonus and keep/drop all keep
working untouched, and a roll saved before d100 shipped (no flag) still means
"an ordinary d10 entry" — so **no store migration is required**. Notation renders
`1d100` via `formatDiceEntry`; range math goes through `getEntryMin`/`getEntryMax`.

`d10tens` is an **engine-only** shape: it is never minted, owned, pulled, themed
or dragged out of the inventory. Anything that must be player-ownable uses
`INVENTORY_DICE_SHAPES` / `isInventoryDiceShape` from `src/types/diceShape.ts`.

### Pairing lives on the dice, not on the roll

At spawn, both halves get the same `presentation.percentilePairId` with opposite
`presentation.percentileRole` (`'tens'` / `'ones'`). `presentation` is the
client→server display channel of Shared-ADR-005, echoed back on `dice_spawned`
and `roll_complete.results[].presentation`; the room never interprets it.

This is load-bearing. Pairing kept in local roll state (`activeSavedRoll`) would
be lost the moment the table is edited — adding a die clears the saved-roll
context — would never reach **remote** players, and would not survive a refresh
or reconnect. In each of those cases the pair silently degrades into two
uncorrected halves. Because the pairing travels with the dice, every client that
can see the dice reconstructs it via `derivePercentilePairs`.

All three aggregation paths derive pairs from the dice themselves:
`ResultDisplay` (HUD), `useDiceStore.recordDieSettled` (history snapshot) and
`useMultiplayerStore` `roll_complete` (including other players' rolls).

### Deliberate server-total divergence

`RollComplete.total` (`take_completed_rolls`, `server/core/src/room.rs`) is a
**plain sum of raw face values** and stays that way — the server must not need to
know which dice were paired. For every percentile outcome except `00 + 0` that
plain sum already equals the combined value.

Only `00 + 0` diverges: the **server reports 0** while the **client displays
100**. The `+100` correction lives in `percentileSumCorrection`
(`src/lib/percentileRolls.ts`) and is applied client-side only. Do not "fix" the
server total to match — it is intentional, and both values are correct for their
own purpose.

## Common Issues

### Issue: Bonuses Not Displaying
**Symptom**: Roll shows dice sum only, no flat bonus
**Diagnosis**: `activeSavedRoll` is null or cleared
**Check**:
- Did a clear/spawn/roll phase show an inline room error?
- Did the user manually add another die, which intentionally clears the saved-roll context?
- Do the settled result IDs match the acknowledged room IDs stored in `perDieBonuses`?

### Issue: Bonuses Persist After Manual Changes
**Symptom**: Bonuses still showing after adding/removing dice
**Solution**: Ensure manual room-backend dice additions clear `activeSavedRoll`.

### Issue: Saved Roll Does Not Start
**Symptom**: The panel stays open and no roll begins
**Diagnosis**: The room rejected an action or an expected acknowledgement timed out
**Check**:
- The inline alert contains the server failure or timeout
- Specific owned dice still exist in inventory and are not already pending
- The room is connected

## Testing Considerations

When testing saved rolls:
1. Verify bonuses display correctly on first roll
2. Test clear → spawn N → roll ordering through a mocked backend
3. Deliver `dice_spawned` acknowledgements out of order and include an unrelated owner's die; bonuses must still reconcile to exact request IDs
4. Verify spawn and roll failures render inline and prevent false success
5. Test manual add/remove behavior clears bonuses
6. Test formula formatting with positive and negative bonuses
7. Extend the wasm-room browser smoke whenever the execution protocol changes
8. For percentile rolls, cover all three ways the pairing must survive: a table
   edit that clears `activeSavedRoll`, a **remote** player's `roll_complete` with
   no local roll state, and `00 + 0` reading 100 rather than 0
9. Wave orchestration is unit-tested against a fake room with scripted faces
   (`src/lib/savedRollExecution.test.ts`) — real dice are random, so browser
   coverage (`e2e/roll-advanced.spec.ts`, `npm run test:e2e:roll-advanced`)
   asserts relationships that hold for every outcome (the kept d20 is the
   higher of the two) rather than fixed numbers
