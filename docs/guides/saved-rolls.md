# Saved Rolls Bonus System

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed saved rolls guidance.

## Overview
The saved rolls feature allows users to save dice roll configurations with bonuses (flat bonuses and per-die bonuses). The system intelligently manages bonus state to ensure bonuses only apply when appropriate.

## Architecture

### Core Components
1. **`useDiceStore.ts`**: Manages `activeSavedRoll` state with bonus tracking
2. **`SavedRollsPanel.tsx`**: Spawns dice and sets active saved roll
3. **`Scene.tsx`**: Displays results with bonuses and manages lifecycle
4. **`diceHelpers.ts`**: Formats saved roll formulas

### Bonus State Structure
```typescript
activeSavedRoll: {
  flatBonus: number              // Flat bonus added to total (e.g., +4)
  perDieBonuses: Map<string, number>  // Per-die bonuses (dice ID → bonus)
  expectedDiceCount: number      // Total dice expected in this roll
} | null
```

## Bonus Lifecycle

### 1. Execute Saved Roll
When user executes a saved roll (e.g., "6d6 + 4"):
- Spawns dice matching the saved roll configuration
- Sets `activeSavedRoll` with `flatBonus=4`, `perDieBonuses`, and `expectedDiceCount=6`
- Closes panel, ready for rolling

### 2. Roll Button Click
When user clicks ROLL button:
- **Checks dice count**: If current dice count ≠ `expectedDiceCount`, clears `activeSavedRoll`
- **Preserves bonuses**: If count matches, keeps `activeSavedRoll` for result display
- Applies physics impulse to all dice

### 3. Result Display
Shows total with bonuses:
- **Grand Total**: `diceSum + perDieBonusesTotal + flatBonus`
- **Breakdown Label**: Shows `"19 + 4"` beneath total (only if `flatBonus ≠ 0`)
- **Individual Dice**: Shows per-die bonuses beneath each die value

### 4. Clear Bonuses
`activeSavedRoll` is automatically cleared when:
- User manually adds dice (`handleAddDice`)
- User removes dice (`handleRemoveDice`)
- User clears all dice (`handleClearAll`)
- Dice count doesn't match expected count during roll

## Formula Formatting

The `formatSavedRoll()` function properly handles operators:
- **Positive bonus**: `6d6 + 4` (not `6d6 + +4`)
- **Negative bonus**: `6d6 - 4` (not `6d6 + -4`)

## Common Issues

### Issue: Bonuses Not Displaying
**Symptom**: Roll shows dice sum only, no flat bonus
**Diagnosis**: `activeSavedRoll` is null or cleared
**Check**:
- Did user manually add/remove dice? (clears bonuses)
- Does dice count match `expectedDiceCount`? (mismatch clears bonuses)

### Issue: Bonuses Persist After Manual Changes
**Symptom**: Bonuses still showing after adding/removing dice
**Solution**: Ensure `clearActiveSavedRoll()` is called in all manual dice operations

## Testing Considerations

When testing saved rolls:
1. Verify bonuses display correctly on first roll
2. Test that bonuses persist when re-rolling same dice set
3. Test that bonuses clear when dice count changes
4. Test manual add/remove dice clears bonuses
5. Test formula formatting with positive and negative bonuses
