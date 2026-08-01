# Saved Rolls Bonus System

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed saved rolls guidance.

## Overview
The saved rolls feature allows users to save dice roll configurations with bonuses (flat bonuses and per-die bonuses). The system intelligently manages bonus state to ensure bonuses only apply when appropriate.

## Architecture

### Core Components
1. **`useDiceStore.ts`**: Manages `activeSavedRoll` state with bonus tracking
2. **`SavedRollsPanel.tsx`**: Executes clear/spawn/roll through `useDiceBackend()`
3. **`useMultiplayerStore.ts`**: Owns authoritative room dice and protocol acknowledgements
4. **`Scene.tsx`**: Reads room dice and displays results with bonuses
5. **`diceHelpers.ts`**: Formats saved roll formulas

### Bonus State Structure
```typescript
activeSavedRoll: {
  flatBonus: number              // Flat bonus added to total (e.g., +4)
  perDieBonuses: Map<string, number>  // Per-die bonuses (dice ID → bonus)
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
- **Grand Total**: `diceSum + perDieBonusesTotal + flatBonus`
- **Individual Dice**: Shows the reconciled per-die bonus next to each face value
- **Flat Bonus**: Shows a separate bonus chip when non-zero

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
