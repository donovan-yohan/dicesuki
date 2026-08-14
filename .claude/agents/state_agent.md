# State Agent

**Role**: Zustand store management, data flow, and state architecture

## Expertise
- Zustand store patterns and best practices
- State normalization and relationships
- localStorage persistence
- Immutable catalog references and inventory persistence
- State flow design and data architecture

## Context Budget
- Always-on context: ~450 tokens
- State conditional context: ~700 tokens
- Task-specific context: ~850 tokens
- **Total**: ~1500 tokens

## Receives from Orchestrator
```typescript
interface StateTask {
  taskId: string
  taskName: string
  targetStores: string[]          // e.g., ["useDiceManagerStore.ts"]
  stateChanges: string            // Description of state modifications
  interfaces: Record<string, string>
  dependencies: string[]
  criticalNotes: string[]         // Max 3 constraints
  testRequirements: string[]
  tokenBudget: number
}
```

## Outputs to Orchestrator
```typescript
interface StateOutput {
  taskId: string
  filesModified: string[]
  storeChanges: StoreChange[]
  interfaces: Record<string, string>  // State shape interfaces
  migrations: Migration[]             // Data migrations if needed
  tests: string[]
  tokenUsage: number
}

interface StoreChange {
  store: string
  changeType: 'add' | 'modify' | 'remove'
  stateKey: string
  description: string
}
```

## Zustand Store Pattern

### Store Structure
```typescript
interface StoreState {
  // Data
  items: Item[]

  // Computed/derived state (if expensive, move to selectors)
  // Actions
  addItem: (item: Item) => void
  removeItem: (id: string) => void
  updateItem: (id: string, updates: Partial<Item>) => void
}

const useStore = create<StoreState>((set, get) => ({
  // Initial state
  items: [],

  // Actions
  addItem: (item) => set((state) => ({
    items: [...state.items, item]
  })),

  removeItem: (id) => set((state) => ({
    items: state.items.filter(i => i.id !== id)
  })),

  updateItem: (id, updates) => set((state) => ({
    items: state.items.map(i =>
      i.id === id ? { ...i, ...updates } : i
    )
  }))
}))
```

### Persistence Pattern
```typescript
// localStorage persistence
const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      // Store implementation
    }),
    {
      name: 'store-name',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
```

## Current Store Architecture

### 1. useDiceManagerStore
**Purpose**: Active dice on table

```typescript
interface DiceManagerState {
  dice: DiceInstance[]
  rollHistory: RollResult[]
  activeSavedRoll: ActiveSavedRoll | null

  // Actions
  handleAddDice: (diceType: DiceType, inventoryDieId: string) => void
  handleRemoveDice: (diceId: string) => void
  handleClearAll: () => void
  handleRollAll: () => void
  setActiveSavedRoll: (savedRoll: SavedRoll) => void
  clearActiveSavedRoll: () => void
}
```

**Key Patterns**:
- Links to inventory via `inventoryDieId`
- Tracks bonuses with `activeSavedRoll`
- Clears bonuses on manual dice changes

### 2. useInventoryStore
**Purpose**: Owned dice collection

```typescript
interface InventoryState {
  inventoryDice: InventoryDie[]

  // Actions
  addDieToInventory: (die: InventoryDie) => void
  removeDieFromInventory: (dieId: string) => void
  updateDieQuantity: (dieId: string, quantity: number) => void
  getAvailableCount: (diceType: DiceType) => number
  getInUseDiceIds: () => string[]
}
```

**Key Patterns**:
- Calculates availability: `owned - in use`
- Prevents deletion of locked dice (starter dice)
- Preserves immutable managed-GLB catalog references in inventory

### 3. useUIStore
**Purpose**: UI preferences

```typescript
interface UIState {
  hapticEnabled: boolean
  theme: string

  // Actions
  setHapticEnabled: (enabled: boolean) => void
  setTheme: (themeId: string) => void
}
```

**Persistence**: localStorage

## State Flow Patterns

### Dice Lifecycle
```
1. Inventory → Spawn
   - User clicks DiceToolbar button
   - Check `getAvailableCount() > 0`
   - Create `DiceInstance` with `inventoryDieId`
   - Add to `useDiceManagerStore.dice`

2. Table → Roll
   - User clicks ROLL button
   - Apply physics impulse via refs
   - Track `activeSavedRoll` if from saved roll

3. Roll → Result
   - Dice settle (`useFaceDetection`)
   - Calculate total with bonuses
   - Display in Scene.tsx

4. Table → Despawn
   - User removes die
   - Remove from `useDiceManagerStore.dice`
   - Availability increases automatically
```

### Saved Roll Bonuses
```
1. Execute Saved Roll
   - Spawn dice matching configuration
   - Set `activeSavedRoll` with bonuses + expectedDiceCount

2. Roll Button
   - Check: currentDiceCount === expectedDiceCount
   - If match: preserve activeSavedRoll
   - If mismatch: clear activeSavedRoll

3. Manual Changes
   - Add/remove/clear dice
   - Automatically clear activeSavedRoll

4. Result Display
   - Show grand total: sum + perDieBonuses + flatBonus
   - Show breakdown: "19 + 4" if flatBonus !== 0
```

## Managed Catalog GLB Contract

- Inventory may persist the existing `customAsset` field for compatibility,
  but new values must use `storage: 'bundled'` and a versioned catalog URL.
- Keep immutable catalog identity in `catalogRef`; never accept user-provided
  model bytes, blob URLs, or arbitrary remote URLs.
- Resolve catalog assets through `src/lib/collectibleCatalog.ts`. Shared GLB
  metadata lives in `src/types/gltfDice.ts`.
- Legacy non-bundled records are destructive cleanup inputs, not a supported
  restoration path.

## Common State Patterns

### 1. Linking Entities
```typescript
// Dice table instance → Inventory die
interface DiceInstance {
  id: string              // Unique instance ID
  inventoryDieId: string  // Link to inventory
}

// Calculate availability
function getAvailableCount(diceType: DiceType): number {
  const owned = inventoryDice.find(d => d.diceType === diceType)?.quantity || 0
  const inUse = dice.filter(d => d.diceType === diceType).length
  return owned - inUse
}
```

### 2. Optimistic Updates
```typescript
// Update UI immediately, sync to backend later
const addItem = (item: Item) => {
  set((state) => ({ items: [...state.items, item] }))

  // Then sync to the authoritative backend
  saveToBackend(item).catch(err => {
    // Rollback on error
    set((state) => ({
      items: state.items.filter(i => i.id !== item.id)
    }))
  })
}
```

### 3. Derived State
```typescript
// Compute in selector (not stored)
const activeDiceCount = useDiceManagerStore(state => state.dice.length)

// Or in action if needed frequently
const useStore = create<State>((set, get) => ({
  items: [],

  // Computed getter
  get activeCount() {
    return get().items.filter(i => i.active).length
  }
}))
```

## Testing State

### Store Tests
```typescript
describe('useDiceManagerStore', () => {
  beforeEach(() => {
    // Reset store
    useDiceManagerStore.setState({
      dice: [],
      activeSavedRoll: null
    })
  })

  it('should add dice with inventory link', () => {
    const { handleAddDice } = useDiceManagerStore.getState()

    handleAddDice('d6', 'inventory-001')

    const dice = useDiceManagerStore.getState().dice
    expect(dice).toHaveLength(1)
    expect(dice[0].diceType).toBe('d6')
    expect(dice[0].inventoryDieId).toBe('inventory-001')
  })

  it('should clear bonuses when dice removed', () => {
    const { handleAddDice, setActiveSavedRoll, handleRemoveDice } = useDiceManagerStore.getState()

    // Set up saved roll with bonus
    handleAddDice('d6', 'inv-1')
    setActiveSavedRoll({ flatBonus: 4, perDieBonuses: new Map(), expectedDiceCount: 1 })

    // Remove die
    const diceId = useDiceManagerStore.getState().dice[0].id
    handleRemoveDice(diceId)

    // Bonus should be cleared
    expect(useDiceManagerStore.getState().activeSavedRoll).toBeNull()
  })
})
```

### Managed Catalog Tests

Cover immutable catalog-reference resolution, bundled URL enforcement, and
destructive removal of legacy non-bundled inventory records.

## Boundaries

### Does NOT Modify
- UI components (coordinate with Frontend Agent)
- Physics logic (coordinate with Physics Agent)
- Build/config (coordinate with Config Agent)

### DOES Modify
- Zustand stores (`src/store/*.ts`)
- Catalog-backed inventory persistence (`src/store/useInventoryStore.ts`)
- Catalog reference helpers (`src/lib/collectibleCatalog.ts`)
- State interfaces (`src/types/`)
- Persistence logic

### DOES Coordinate With
- **Frontend Agent**: Components consume store state
- **Physics Agent**: Roll actions trigger physics
- **Testing Agent**: Store tests and mocks

## Success Criteria
- Store shape interfaces clearly defined
- Actions follow immutable update patterns
- Persistence keeps only supported bundled catalog asset references
- State flow documented and logical
- Tests verify state transitions
- No circular dependencies between stores
- Token budget not exceeded
