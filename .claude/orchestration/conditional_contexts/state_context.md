# State Management Context (500-800 tokens)

## Zustand Stores

### 1. useDiceManagerStore
**Purpose**: Manages active dice on the table

**State**:
```typescript
interface DiceManagerState {
  dice: DiceInstance[]              // Active dice
  rollHistory: RollResult[]         // Past roll results
  activeSavedRoll: ActiveSavedRoll | null  // Bonus tracking
}

interface DiceInstance {
  id: string                        // Unique instance ID
  diceType: DiceType                // d4, d6, d8, d10, d12, d20
  inventoryDieId: string            // Links to inventory
  position: [number, number, number]
  customAsset?: CustomDiceAsset     // For custom dice
}
```

**Key Actions**:
- `handleAddDice(diceType, inventoryDieId)`: Spawn die from inventory
- `handleRemoveDice(diceId)`: Despawn die, return to inventory
- `handleClearAll()`: Remove all dice
- `handleRollAll()`: Trigger physics impulse on all dice
- `setActiveSavedRoll(savedRoll)`: Track bonuses for saved rolls
- `clearActiveSavedRoll()`: Remove bonus tracking

### 2. useInventoryStore
**Purpose**: Manages owned dice collection

**State**:
```typescript
interface InventoryState {
  inventoryDice: InventoryDie[]     // Owned dice
}

interface InventoryDie {
  id: string                        // Unique inventory ID
  diceType: DiceType
  quantity: number                  // How many owned
  isLocked: boolean                 // Prevent deletion
  customAsset?: CustomDiceAsset     // For custom dice
}
```

**Key Actions**:
- `addDieToInventory(die)`: Add new die
- `removeDieFromInventory(dieId)`: Remove die (if not locked)
- `getAvailableCount(diceType)`: Calculate owned - in use
- `getInUseDiceIds()`: Get IDs of dice on table

**Linking System**:
- Spawn: `inventoryDieId` links table die → inventory die
- Availability: `owned - in use = available`
- Constraints: Can't spawn if available = 0

### 3. useUIStore
**Purpose**: UI preferences and settings

**State**:
```typescript
interface UIState {
  hapticEnabled: boolean            // Vibration on/off
  theme: string                     // Active theme ID
}
```

**Persistence**: localStorage
- Key: `'hapticFeedbackEnabled'`
- Restored on app init

## State Flow

### Dice Lifecycle
```
Inventory → Spawn → Table → Roll → Result → Despawn → Inventory
```

1. **Spawn**: User clicks DiceToolbar button
   - Check `getAvailableCount(diceType) > 0`
   - Create `DiceInstance` with `inventoryDieId`
   - Add to `useDiceManagerStore.dice`

2. **Roll**: User clicks ROLL button
   - Apply physics impulse to all dice
   - Track `activeSavedRoll` if from saved roll
   - Wait for all dice to settle

3. **Result**: Dice settle at rest
   - `useFaceDetection` detects face values
   - Calculate total: `sum + perDieBonuses + flatBonus`
   - Display grand total in Scene.tsx

4. **Despawn**: User removes die
   - Remove from `useDiceManagerStore.dice`
   - Dice returns to inventory (availability increases)

### Saved Roll Bonus System
```typescript
interface ActiveSavedRoll {
  flatBonus: number                 // e.g., +4
  perDieBonuses: Map<string, number>  // diceId → bonus
  expectedDiceCount: number         // Validation
}
```

**Lifecycle**:
1. Execute saved roll → Set `activeSavedRoll`
2. Click ROLL → Preserve if count matches, clear if mismatch
3. Manual add/remove dice → Clear `activeSavedRoll`
4. Display result → Show bonuses in breakdown

## Dependencies
- **Frontend**: Components read stores via hooks
- **Physics**: Roll button triggers physics impulses
- **Testing**: Mock stores in tests
