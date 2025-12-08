# State Agent

**Role**: Zustand store management, data flow, and state architecture

## Expertise
- Zustand store patterns and best practices
- State normalization and relationships
- localStorage persistence
- IndexedDB for binary data (custom dice GLB files)
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
- Manages custom dice with IndexedDB persistence

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

## IndexedDB for Custom Dice

### Database Structure
```typescript
DB_NAME = 'DaisuCustomDiceDB'
STORE_NAME = 'customDiceModels'

// Key-value pairs
key: diceId (string)
value: ArrayBuffer (GLB file data)
```

### Operations
```typescript
// Save GLB file
async function saveCustomDiceModel(diceId: string, file: Blob | ArrayBuffer) {
  // CRITICAL: Convert Blob to ArrayBuffer BEFORE opening DB
  const arrayBuffer = file instanceof Blob
    ? await file.arrayBuffer()  // Do this FIRST
    : file

  // THEN open database and transaction
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)

  return new Promise((resolve, reject) => {
    const request = store.put(arrayBuffer, diceId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// Load GLB file
async function loadCustomDiceModel(diceId: string): Promise<ArrayBuffer | null> {
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)

  return new Promise((resolve, reject) => {
    const request = store.get(diceId)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}
```

### Blob URL Regeneration
```typescript
// On app initialization
async function regenerateCustomDiceBlobUrls() {
  const customDice = inventoryDice.filter(die => die.customAsset)

  for (const die of customDice) {
    const arrayBuffer = await loadCustomDiceModel(die.id)
    if (arrayBuffer) {
      const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' })
      const blobUrl = URL.createObjectURL(blob)

      // Update inventory with fresh blob URL
      updateDie(die.id, {
        customAsset: {
          ...die.customAsset,
          modelUrl: blobUrl
        }
      })
    }
  }
}
```

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

  // Then sync to server/IndexedDB
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

### IndexedDB Tests
```typescript
describe('customDiceDB', () => {
  it('should save and load GLB file', async () => {
    const diceId = 'custom-001'
    const mockGLB = new ArrayBuffer(1024)

    await saveCustomDiceModel(diceId, mockGLB)
    const loaded = await loadCustomDiceModel(diceId)

    expect(loaded).toEqual(mockGLB)
  })
})
```

## Boundaries

### Does NOT Modify
- UI components (coordinate with Frontend Agent)
- Physics logic (coordinate with Physics Agent)
- Build/config (coordinate with Config Agent)

### DOES Modify
- Zustand stores (`src/store/*.ts`)
- IndexedDB utilities (`src/lib/customDiceDB.ts`)
- State interfaces (`src/types/`)
- Persistence logic

### DOES Coordinate With
- **Frontend Agent**: Components consume store state
- **Physics Agent**: Roll actions trigger physics
- **Testing Agent**: Store tests and mocks

## Success Criteria
- Store shape interfaces clearly defined
- Actions follow immutable update patterns
- Persistence working (localStorage or IndexedDB)
- State flow documented and logical
- Tests verify state transitions
- No circular dependencies between stores
- Token budget not exceeded
