# Player Inventory Architecture

**Status**: Planning/Design Phase
**Branch**: `claude/player-inventory-architecture-01Deozix3ZdqqJxGRVbpix1a`
**Created**: 2025-11-16

## Overview

This document outlines the architecture for the persistent player inventory system, treating each die as a unique collectible entity (similar to Genshin Impact's character collection model).

## Core Philosophy

- **Each die is unique**: Even two "Common d6" dice are separate entities with unique IDs
- **Duplicates are valuable**: Used in crafting system to upgrade/transform dice
- **Rarity matters**: Higher rarity = better VFX/animations (separate implementation task)
- **Unlimited collection**: No inventory size limits
- **Gacha-style acquisition**: Premium/standard banners with pity system (Hoyoverse pattern)

---

## Data Model

### Primary Entity: Dice

```typescript
/**
 * Represents a single collectible die in player inventory
 * Each die is a unique entity, even if same type/rarity
 */
interface InventoryDie {
  // Identity
  id: string                    // Unique: "die_1234567890"
  type: DiceShape               // 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'

  // Core Properties
  setId: string                 // Die set/collection: 'dragon-jade', 'celestial-gold'
  rarity: DieRarity

  // Visual Properties (defined by setId + rarity)
  appearance: {
    baseColor: string           // Primary color
    accentColor: string         // Numbers/pips color
    material: DieMaterial
    texture?: string            // Optional texture URL
    metalness?: number          // 0-1 for PBR materials
    roughness?: number          // 0-1 for PBR materials
    emissive?: string           // Optional glow color
    emissiveIntensity?: number  // Glow strength
  }

  // VFX Configuration (rarity-dependent)
  vfx: {
    trailEffect?: string        // 'sparkles', 'fire', 'lightning', etc.
    impactEffect?: string       // Particle effect on collision
    rollSound?: string          // Custom sound effect
    criticalAnimation?: string  // Special animation on max roll
  }

  // Player Customization
  name: string                  // Player-assigned: "Lucky Persuasion Die"
  description?: string          // Optional flavor text
  isFavorite: boolean           // Star for quick access
  isLocked: boolean             // Prevent accidental deletion/crafting

  // Metadata
  acquiredAt: number            // Timestamp
  source: AcquisitionSource

  // Stats (for player engagement)
  stats: {
    timesRolled: number
    highestRoll?: number        // Highest natural roll (for this die type)
    lowestRoll?: number
    totalValue: number          // Sum of all rolls ever
    critsRolled: number         // Max value rolls
    failsRolled: number         // Min value rolls
  }

  // Assignment tracking
  assignedToRolls: string[]     // SavedRoll IDs using this die
}

type DieRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'

type DieMaterial =
  | 'plastic'      // Basic, matte
  | 'resin'        // Semi-glossy
  | 'metal'        // High metalness
  | 'stone'        // Rough, natural
  | 'glass'        // Transparent
  | 'crystal'      // Refractive
  | 'wood'         // Organic texture
  | 'bone'         // Aged, creamy
  | 'obsidian'     // Black, glossy
  | 'celestial'    // Special shader (stars, nebula)

type AcquisitionSource =
  | 'starter'      // New player gift
  | 'tutorial'     // Tutorial reward
  | 'daily'        // Daily login
  | 'event'        // Limited event
  | 'shop'         // Direct purchase
  | 'gacha_standard' // Standard banner
  | 'gacha_premium'  // Premium/featured banner
  | 'crafting'     // Crafted from duplicates
  | 'achievement'  // Milestone reward
  | 'quest'        // Story/side quest
```

### Die Sets (Collections)

```typescript
/**
 * Defines a cohesive set of dice with shared aesthetic
 * Players collect complete sets for bonuses (future feature)
 */
interface DieSet {
  id: string                    // 'dragon-jade', 'celestial-gold'
  name: string                  // "Dragon Jade Collection"
  description: string

  // Visual theme
  theme: {
    colorPalette: string[]      // Primary colors used
    materialType: DieMaterial
    visualStyle: string         // 'fantasy', 'scifi', 'horror', 'minimalist'
  }

  // Rarity configuration
  // A set can have dice at multiple rarities with different appearances
  rarityVariants: {
    [K in DieRarity]?: {
      appearance: InventoryDie['appearance']
      vfx: InventoryDie['vfx']
    }
  }

  // Availability
  availability: 'always' | 'limited' | 'seasonal' | 'retired'
  releaseDate: number
  endDate?: number              // For limited sets

  // Set completion bonus (future)
  setBonus?: {
    description: string         // "All dice glow when rolling together"
    effectId: string
  }
}
```

### Starter Configuration

```typescript
/**
 * Default dice given to new players
 */
const STARTER_DICE: Partial<InventoryDie>[] = [
  // Basic D&D set in "Adventurer's Starter" collection
  { type: 'd20', setId: 'adventurer-starter', rarity: 'common', name: 'Starter d20' },
  { type: 'd12', setId: 'adventurer-starter', rarity: 'common', name: 'Starter d12' },
  { type: 'd10', setId: 'adventurer-starter', rarity: 'common', name: 'Starter d10' },
  { type: 'd8', setId: 'adventurer-starter', rarity: 'common', name: 'Starter d8' },
  { type: 'd6', setId: 'adventurer-starter', rarity: 'common', name: 'Starter d6' },
  { type: 'd4', setId: 'adventurer-starter', rarity: 'common', name: 'Starter d4' },
]

/**
 * Tutorial rewards (earned during first-time user experience)
 */
const TUTORIAL_REWARDS: Partial<InventoryDie>[] = [
  { type: 'd20', setId: 'lucky-bronze', rarity: 'uncommon', name: 'Lucky d20' },
]
```

---

## State Management

### Inventory Store (Zustand)

```typescript
interface InventoryStore {
  // ============================================================================
  // State
  // ============================================================================

  dice: InventoryDie[]          // All owned dice
  diceSets: DieSet[]            // All available sets (loaded from config)

  // Currency (future - plan for it)
  currency: {
    coins: number               // Free currency (earnable)
    gems: number                // Premium currency (purchasable)
    standardTokens: number      // Standard gacha pulls
    premiumTokens: number       // Premium gacha pulls
  }

  // ============================================================================
  // Dice Management
  // ============================================================================

  addDie: (die: InventoryDie) => void
  removeDie: (dieId: string) => void
  updateDie: (dieId: string, updates: Partial<InventoryDie>) => void

  // Player customization
  renameDie: (dieId: string, name: string) => void
  setDescription: (dieId: string, description: string) => void
  toggleFavorite: (dieId: string) => void
  toggleLock: (dieId: string) => void

  // Stats tracking
  recordRoll: (dieId: string, value: number) => void
  getDieStats: (dieId: string) => InventoryDie['stats'] | undefined

  // ============================================================================
  // Assignment (Integration with Saved Rolls)
  // ============================================================================

  /**
   * Assign a die to a specific entry in a saved roll
   * @param savedRollId - ID of the saved roll
   * @param entryId - ID of the DiceEntry within that roll
   * @param slotIndex - Which slot in that entry (0 to quantity-1)
   * @param dieId - ID of die to assign
   */
  assignDieToSlot: (
    savedRollId: string,
    entryId: string,
    slotIndex: number,
    dieId: string
  ) => void

  unassignDieFromSlot: (
    savedRollId: string,
    entryId: string,
    slotIndex: number
  ) => void

  /**
   * Get all dice assigned to a specific entry
   */
  getAssignedDice: (
    savedRollId: string,
    entryId: string
  ) => (InventoryDie | null)[]  // Array of length entry.quantity

  /**
   * Check if a die is currently assigned anywhere
   */
  isDieAssigned: (dieId: string) => boolean

  /**
   * Get all rolls using this die
   */
  getRollsUsingDie: (dieId: string) => string[]

  // ============================================================================
  // Filtering & Sorting
  // ============================================================================

  getDiceByType: (type: DiceShape) => InventoryDie[]
  getDiceByRarity: (rarity: DieRarity) => InventoryDie[]
  getDiceBySet: (setId: string) => InventoryDie[]
  getUnassignedDice: (type?: DiceShape) => InventoryDie[]
  getFavoriteDice: () => InventoryDie[]

  /**
   * Get duplicate dice (same setId + type + rarity)
   * Used for crafting UI
   */
  getDuplicates: (dieId: string) => InventoryDie[]

  /**
   * Check if player has complete set
   */
  hasCompleteSet: (setId: string) => boolean
  getSetCompletion: (setId: string) => {
    total: number          // Total dice in set
    owned: number          // How many player owns
    missing: Array<{ type: DiceShape, rarity: DieRarity }>
  }

  // ============================================================================
  // Crafting System
  // ============================================================================

  /**
   * Check if crafting recipe is available
   * Example: 2x d6 (uncommon) -> 1x d8 (uncommon) same set
   */
  canCraft: (recipe: CraftingRecipe) => boolean

  /**
   * Execute crafting recipe
   * - Consumes input dice
   * - Creates new die
   * - Records in stats
   */
  craft: (recipe: CraftingRecipe, inputDiceIds: string[]) => InventoryDie | null

  // ============================================================================
  // Economy (Future - Placeholder)
  // ============================================================================

  addCurrency: (type: keyof InventoryStore['currency'], amount: number) => void
  spendCurrency: (type: keyof InventoryStore['currency'], amount: number) => boolean

  /**
   * Purchase from shop
   */
  purchaseDie: (shopItemId: string) => Promise<InventoryDie | null>

  /**
   * Gacha pull (single or multi)
   */
  gachaPull: (
    banner: 'standard' | 'premium',
    count: 1 | 10
  ) => Promise<InventoryDie[]>

  /**
   * Sell die for coins
   */
  sellDie: (dieId: string) => number  // Returns coins earned
}

/**
 * Crafting recipe definition
 */
interface CraftingRecipe {
  id: string
  name: string
  description: string

  // Input requirements
  inputs: Array<{
    type: DiceShape
    rarity: DieRarity
    count: number
    setId?: string        // If undefined, any set works
  }>

  // Output
  output: {
    type: DiceShape
    rarity: DieRarity
    setId: string         // Inherits from input if possible
  }

  // Additional costs
  coinCost?: number
}

/**
 * Example recipes
 */
const CRAFTING_RECIPES: CraftingRecipe[] = [
  {
    id: 'upgrade-d6-to-d8',
    name: 'Upgrade to d8',
    description: 'Combine two d6s to create a d8 of the same set',
    inputs: [
      { type: 'd6', rarity: 'common', count: 2, setId: undefined } // Any set
    ],
    output: {
      type: 'd8',
      rarity: 'common',
      setId: 'inherit'    // Takes setId from inputs
    }
  },
  {
    id: 'rarity-upgrade-d20',
    name: 'Enhance d20',
    description: 'Combine 3 common d20s to create an uncommon d20',
    inputs: [
      { type: 'd20', rarity: 'common', count: 3, setId: undefined }
    ],
    output: {
      type: 'd20',
      rarity: 'uncommon',
      setId: 'inherit'
    },
    coinCost: 100
  }
]
```

---

## Integration with Saved Rolls

### Updated DiceEntry Type

```typescript
/**
 * Individual dice entry in a saved roll
 * NOW supports assigning specific inventory dice to slots
 */
interface DiceEntry {
  id: string
  type: DiceShape
  quantity: number        // How many dice to roll

  // === NEW: Inventory Integration ===
  /**
   * Maps slot index to inventory die ID
   * Length should match `quantity`
   * null = use default theme die for that slot
   *
   * Example: { 0: "die_123", 1: null, 2: "die_456" }
   * Slot 0 uses die_123, slot 1 uses default, slot 2 uses die_456
   */
  assignedDice: Record<number, string | null>

  // Existing fields...
  perDieBonus: number
  rollCount?: number
  keepMode?: KeepMode
  exploding?: ExplodingConfig
  reroll?: RerollConfig
  minimum?: number
  maximum?: number
  countSuccesses?: SuccessCountingConfig
}
```

### Rendering Logic

When spawning dice in the 3D scene:

```typescript
// In DiceManager or Scene component
function spawnDiceForRoll(savedRoll: SavedRoll) {
  const inventoryStore = useInventoryStore.getState()

  savedRoll.dice.forEach(entry => {
    for (let i = 0; i < entry.quantity; i++) {
      const assignedDieId = entry.assignedDice[i]

      let dieConfig: DiceRenderConfig

      if (assignedDieId) {
        // Use inventory die appearance
        const inventoryDie = inventoryStore.dice.find(d => d.id === assignedDieId)
        if (inventoryDie) {
          dieConfig = {
            type: inventoryDie.type,
            appearance: inventoryDie.appearance,
            vfx: inventoryDie.vfx
          }

          // Track stats when rolled
          inventoryStore.recordRoll(inventoryDie.id, rollResult)
        } else {
          // Fallback if die deleted
          dieConfig = getDefaultDieConfig(entry.type)
        }
      } else {
        // Use theme default
        dieConfig = getDefaultDieConfig(entry.type)
      }

      spawnDie(dieConfig)
    }
  })
}
```

---

## Persistence Strategy

### Phase 1: LocalStorage (Current)

```typescript
export const useInventoryStore = create<InventoryStore>()(
  persist(
    (set, get) => ({ /* implementation */ }),
    {
      name: 'daisu-player-inventory',
      storage: createJSONStorage(() => localStorage),
      version: 1,

      // Migrate old data if structure changes
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // Migration from v0 to v1
          return {
            ...persistedState,
            currency: {
              coins: 0,
              gems: 0,
              standardTokens: 0,
              premiumTokens: 0
            }
          }
        }
        return persistedState
      },

      // Partial persistence (don't save diceSets, load from config)
      partialize: (state) => ({
        dice: state.dice,
        currency: state.currency
      })
    }
  )
)
```

### Phase 2: Backend Sync (Future)

When multiplayer/accounts are implemented:

**On Login:**
```typescript
async function syncInventoryOnLogin(userId: string) {
  const localState = useInventoryStore.getState()
  const serverState = await fetchInventoryFromServer(userId)

  // Conflict resolution strategy
  const merged = mergeInventories(localState, serverState, {
    // Server is authoritative for:
    preferServer: ['currency'],

    // Client wins for:
    preferClient: [],

    // Merge both (union):
    merge: ['dice']  // Keep all dice from both
  })

  useInventoryStore.setState(merged)
  await syncInventoryToServer(userId, merged)
}
```

**Real-time Sync:**
- WebSocket for currency updates (purchases, rewards)
- Debounced sync for die customization (name, favorite, lock)
- Immediate sync for acquisitions (gacha, crafting)

---

## Gacha System Design (Future Implementation)

### Banner Structure

```typescript
interface GachaBanner {
  id: string
  name: string
  description: string
  type: 'standard' | 'premium' | 'event'

  // Visual
  bannerImage: string
  backgroundColor: string

  // Cost
  pullCost: {
    single: { gems?: number, tokens?: number }
    multi: { gems?: number, tokens?: number }  // 10-pull
  }

  // Drop rates
  pools: GachaPool[]

  // Pity system
  pity: {
    softPity: number        // Increased rates start here (e.g., 75)
    hardPity: number        // Guaranteed rare+ (e.g., 90)
    featuredPity: number    // Guaranteed featured item (e.g., 180)
    carryOver: boolean      // Does pity carry to next banner?
  }

  // Featured items (boosted rates)
  featured: Array<{
    setId: string
    rarity: DieRarity
    boostedRate: number     // Multiplier on base rate
  }>

  // Availability
  startDate: number
  endDate?: number
  isActive: boolean
}

interface GachaPool {
  id: string
  rarity: DieRarity
  weight: number            // Relative probability

  // Items in this pool
  items: Array<{
    setId: string
    type: DiceShape
    weight: number          // Within this rarity tier
  }>
}

/**
 * Example: Standard Banner
 */
const STANDARD_BANNER: GachaBanner = {
  id: 'standard-permanent',
  name: 'Wanderer\'s Wish',
  description: 'Permanent banner with all standard dice sets',
  type: 'standard',
  pullCost: {
    single: { tokens: 1 },
    multi: { tokens: 10 }
  },
  pools: [
    {
      id: 'common-pool',
      rarity: 'common',
      weight: 94.3,
      items: [
        { setId: 'adventurer-starter', type: 'd20', weight: 1 },
        { setId: 'adventurer-starter', type: 'd12', weight: 1 },
        // ... more common items
      ]
    },
    {
      id: 'uncommon-pool',
      rarity: 'uncommon',
      weight: 5.1,
      items: [/* ... */]
    },
    {
      id: 'rare-pool',
      rarity: 'rare',
      weight: 0.6,
      items: [/* ... */]
    }
  ],
  pity: {
    softPity: 75,
    hardPity: 90,
    featuredPity: 180,
    carryOver: true
  },
  featured: [],
  startDate: 0,
  isActive: true
}
```

### Pity System State

```typescript
interface PityState {
  [bannerId: string]: {
    pullsSinceLastRare: number      // Resets on rare+ pull
    pullsSinceLastFeatured: number  // Resets on featured pull
    guaranteedFeatured: boolean     // Lost 50/50, next is guaranteed
  }
}

// Stored in inventory store
interface InventoryStore {
  // ... existing fields
  pityState: PityState

  // Pity tracking
  incrementPity: (bannerId: string) => void
  resetPity: (bannerId: string, type: 'rare' | 'featured') => void
}
```

---

## UI/UX Flow

### Inventory Panel

```
┌─────────────────────────────────────┐
│  🎲 MY DICE        [Filter ▼] [⭐]  │
├─────────────────────────────────────┤
│  Filters: All Types | All Rarities │
│  Sort: Recent | Rarity | Type       │
├─────────────────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐       │
│  │ d20│ │ d12│ │ d10│ │ d8 │       │
│  │⭐🔒│ │    │ │    │ │ x3 │  (duplicates badge)
│  │Epic│ │Rare│ │Comm│ │Comm│       │
│  └────┘ └────┘ └────┘ └────┘       │
│                                     │
│  [+ Acquire Dice] [🔨 Craft]       │
└─────────────────────────────────────┘
```

**Die Card (on tap):**
```
┌─────────────────────────────┐
│  Dragon Jade d20    [Edit]  │
│  ⭐ Favorited  🔒 Locked    │
├─────────────────────────────┤
│                             │
│      [3D Preview of Die]    │
│                             │
├─────────────────────────────┤
│  Rarity: Epic               │
│  Set: Dragon Jade           │
│  Rolls: 127                 │
│  Best Roll: 20 (x3)         │
│  Worst Roll: 1 (x1)         │
│  Avg: 11.3                  │
├─────────────────────────────┤
│  Used in rolls:             │
│  • Attack Roll (slot 1)     │
│  • Fireball Damage (slot 2) │
├─────────────────────────────┤
│  [Assign to Roll]           │
│  [Rename]                   │
│  [Sell for 50 coins]        │
└─────────────────────────────┘
```

### Saved Roll Builder (Updated)

```
┌─────────────────────────────────────┐
│  FIREBALL DAMAGE                    │
├─────────────────────────────────────┤
│  8d6 + 5                            │
│  ┌──┬──┬──┬──┬──┬──┬──┬──┐        │
│  │🎲│🎲│🎲│🎲│🎲│🎲│??│??│        │  <- Drag dice here
│  └──┴──┴──┴──┴──┴──┴──┴──┘        │
│  Assigned: 6/8                      │
│                                     │
│  [+ Add from Inventory]             │
│  [Clear All Assignments]            │
└─────────────────────────────────────┘

On tap "+Add from Inventory":
┌─────────────────────────────────────┐
│  SELECT d6                          │
├─────────────────────────────────────┤
│  Showing: Unassigned d6s only       │
│  ┌────┐ ┌────┐ ┌────┐              │
│  │ d6 │ │ d6 │ │ d6 │              │
│  │Epic│ │Rare│ │Comm│              │
│  └────┘ └────┘ └────┘              │
└─────────────────────────────────────┘
```

### Crafting Panel

```
┌─────────────────────────────────────┐
│  🔨 CRAFTING                        │
├─────────────────────────────────────┤
│  Recipe: Upgrade d6 → d8            │
│                                     │
│  Requires:                          │
│  • 2x d6 (same set & rarity)        │
│                                     │
│  Creates:                           │
│  • 1x d8 (same set & rarity)        │
│                                     │
│  Select Dice:                       │
│  ┌────┐ ┌────┐                     │
│  │ d6 │ │ d6 │  [Select]           │
│  │Comm│ │Comm│                     │
│  │Jade│ │Jade│                     │
│  └────┘ └────┘                     │
│                                     │
│  Preview:                           │
│  ┌────┐                             │
│  │ d8 │  Common Dragon Jade d8     │
│  │Comm│                             │
│  │Jade│                             │
│  └────┘                             │
│                                     │
│  [Craft] (Costs 50 coins)           │
└─────────────────────────────────────┘
```

---

## File Structure

```
src/
├── store/
│   ├── useInventoryStore.ts          # Main inventory Zustand store
│   ├── useSavedRollsStore.ts         # Update with assignedDice
│   └── useGachaStore.ts              # Gacha/banner state (future)
│
├── types/
│   ├── inventory.ts                  # InventoryDie, DieSet, etc.
│   ├── crafting.ts                   # CraftingRecipe, etc.
│   ├── gacha.ts                      # GachaBanner, GachaPool (future)
│   └── savedRolls.ts                 # Update DiceEntry
│
├── config/
│   ├── dieSets.ts                    # DieSet definitions
│   ├── starterDice.ts                # STARTER_DICE config
│   ├── craftingRecipes.ts            # CRAFTING_RECIPES config
│   └── gachaBanners.ts               # Banner configs (future)
│
├── lib/
│   ├── inventoryHelpers.ts           # Utility functions
│   ├── craftingEngine.ts             # Crafting logic
│   └── gachaEngine.ts                # Gacha pull logic (future)
│
├── components/
│   ├── inventory/
│   │   ├── InventoryPanel.tsx        # Main inventory view
│   │   ├── DieCard.tsx               # Individual die display
│   │   ├── DieCardExpanded.tsx       # Detailed view modal
│   │   ├── DieGrid.tsx               # Grid layout
│   │   ├── InventoryFilters.tsx      # Filter controls
│   │   └── DieStatsDisplay.tsx       # Stats visualization
│   │
│   ├── crafting/
│   │   ├── CraftingPanel.tsx         # Main crafting UI
│   │   ├── RecipeCard.tsx            # Individual recipe
│   │   ├── CraftingPreview.tsx       # Preview output
│   │   └── DieSelector.tsx           # Select input dice
│   │
│   ├── gacha/                        # Future implementation
│   │   ├── GachaPanel.tsx
│   │   ├── BannerCard.tsx
│   │   ├── PullAnimation.tsx
│   │   └── PityDisplay.tsx
│   │
│   └── rolls/
│       └── SavedRollBuilder.tsx      # Update with die assignment
│
└── hooks/
    ├── useInventory.ts               # Convenience hook
    ├── useCrafting.ts                # Crafting state management
    └── useGacha.ts                   # Gacha logic (future)
```

---

## Implementation Phases

### Phase 1: Core Inventory (This Branch)
- [ ] Create inventory types (`types/inventory.ts`)
- [ ] Implement inventory store (`store/useInventoryStore.ts`)
- [ ] Add starter dice configuration
- [ ] Update `DiceEntry` type for assignments
- [ ] Basic persistence with localStorage

### Phase 2: UI - View Only
- [ ] Build inventory panel (read-only)
- [ ] Implement die cards with stats
- [ ] Add filtering/sorting
- [ ] Die detail modal

### Phase 3: Assignment Integration
- [ ] Update saved rolls store
- [ ] Drag-and-drop assignment UI
- [ ] Rendering logic (use inventory dice visuals)
- [ ] Stats tracking on roll

### Phase 4: Crafting System
- [ ] Define crafting recipes
- [ ] Implement crafting engine
- [ ] Build crafting UI
- [ ] Duplicate detection

### Phase 5: Economy Foundation
- [ ] Currency types
- [ ] Sell dice for coins
- [ ] Daily login rewards
- [ ] Achievement rewards

### Phase 6: Gacha (Future)
- [ ] Banner configurations
- [ ] Pity system state
- [ ] Pull animation
- [ ] Rate display (transparency)

### Phase 7: VFX by Rarity (Separate Branch)
- [ ] Particle systems by rarity
- [ ] Trail effects
- [ ] Impact effects
- [ ] Critical roll animations
- [ ] Sound effects

---

## Open Questions

1. **Set Inheritance in Crafting**: If player combines 2 different sets, which set does output inherit?
   - Option A: Require same set (more restrictive)
   - Option B: Player chooses (more flexible)
   - Option C: Random from inputs (simple)

2. **Die Deletion**: When selling dice assigned to rolls:
   - Option A: Block sale, require unassignment first
   - Option B: Auto-unassign on sale
   - Option C: Show warning, confirm

3. **Duplicate Display**: How to show multiples in inventory?
   - Option A: Stack with badge (1 card, shows "x3")
   - Option B: Individual cards (3 separate cards)
   - Option C: Hybrid (stack until tapped, expand to individuals)

4. **Default Dice**: When no assignment in saved roll:
   - Option A: Use theme default (current behavior)
   - Option B: Use lowest rarity owned dice of that type
   - Option C: Require assignment (no defaults)

5. **Stats Tracking**: Should stats be per-die or aggregated?
   - Currently: Per-die (supports "lucky die" narrative)
   - Alternative: Aggregate by set/type (less data)

---

## Next Steps

1. **Review this architecture** - Confirm design decisions
2. **Answer open questions** - Finalize ambiguous behaviors
3. **Create types** - Implement TypeScript types
4. **Build store** - Implement Zustand store with persistence
5. **Test data** - Create sample die sets for development

---

**References:**
- Drag-drop branch: `claude/drag-drop-dice-builder-01Fqx1VvQNQKYNG1fbu9bNrQ`
- Existing theme ownership: `src/contexts/ThemeContext.tsx`
- Existing saved rolls: `src/store/useSavedRollsStore.ts` (on drag-drop branch)
