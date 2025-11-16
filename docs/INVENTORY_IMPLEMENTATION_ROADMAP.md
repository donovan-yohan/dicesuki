# Inventory System Implementation Roadmap

**Status**: Foundation Complete ✅
**Branch**: `claude/player-inventory-architecture-01Deozix3ZdqqJxGRVbpix1a`
**Last Updated**: 2025-11-16

---

## 📋 Current Status

### ✅ Completed (Phase 0: Foundation)

**Core Architecture** (commits: 7ad88fd, 0d06093)
- ✅ Type definitions (`src/types/inventory.ts`, `crafting.ts`, `gacha.ts`)
- ✅ Zustand store implementation (`src/store/useInventoryStore.ts`)
- ✅ Die sets configuration (`src/config/dieSets.ts`)
- ✅ Starter dice config (`src/config/starterDice.ts`)
- ✅ Crafting recipes config (`src/config/craftingRecipes.ts`)
- ✅ Comprehensive architecture documentation (`docs/INVENTORY_ARCHITECTURE.md`)

**Integration**
- ✅ Merged main branch (saved rolls feature from PR #4)
- ✅ TypeScript errors resolved
- ✅ Build passing cleanly
- ✅ Dev server running (port 3001)

**Store Capabilities**
- ✅ Dice CRUD operations (add, remove, update, lock/unlock)
- ✅ Currency management (coins, gems, tokens)
- ✅ Die assignment tracking (savedRollId:entryId:slotIndex -> dieId)
- ✅ Set completion tracking
- ✅ Die statistics (total rolls, rolls by result)
- ✅ Crafting system (canCraft, craft with validation)
- ✅ Gacha simulation (placeholder for future)
- ✅ Filtering and sorting utilities
- ✅ LocalStorage persistence

---

## 🚀 Phase 1: Basic UI Components

**Goal**: Create foundational UI for viewing and managing inventory

**Branch Strategy**: Create new branch from current
```bash
git checkout -b feature/inventory-ui-phase1
```

### 1.1 Inventory Panel Component

**File**: `src/components/panels/InventoryPanel.tsx`

**Features**:
- Grid view of owned dice
- Tab switching: All | By Set | By Rarity | Favorites
- Search/filter bar
- Sort options (name, rarity, set, acquisition date)
- Empty state for new players

**Dependencies**:
- `useInventoryStore` (already exists)
- `DiceCard` component (create next)

**Estimated Complexity**: Medium (2-3 hours)

**Acceptance Criteria**:
- [ ] Panel opens from new bottom nav button
- [ ] Grid displays all dice with proper spacing
- [ ] Tabs filter dice correctly
- [ ] Search filters by die name
- [ ] Sort dropdown works for all options
- [ ] Empty state shows for new users

---

### 1.2 Die Card Component

**File**: `src/components/inventory/DieCard.tsx`

**Features**:
- 3D die preview (mini version of Scene dice)
- Die name, type (d6, d8, etc.), rarity badge
- Set name and icon
- Locked indicator (🔒)
- Assignment indicator (# of rolls assigned to)
- Click to open detail modal

**Visual Design**:
```
┌─────────────────┐
│   [3D Preview]  │  ← Mini R3F canvas or static image
│                 │
│ Die Name    🔒  │  ← Lock icon if locked
│ d6 | Mythic     │  ← Type and rarity
│ Celestial Set   │  ← Set name
│ 📋 Assigned: 2  │  ← Assignment count
└─────────────────┘
```

**Estimated Complexity**: Medium-High (3-4 hours for 3D preview)

**Acceptance Criteria**:
- [ ] Card displays all metadata correctly
- [ ] 3D preview renders properly (or fallback image)
- [ ] Rarity colors match theme system
- [ ] Click opens detail modal
- [ ] Hover effects feel responsive

---

### 1.3 Die Detail Modal

**File**: `src/components/inventory/DieDetailModal.tsx`

**Features**:
- Large 3D die preview (interactive rotation)
- Full stats display:
  - Total rolls
  - Rolls by face value (bar chart or list)
  - Acquisition date
  - Set completion progress
- Actions:
  - Rename die (editable name field)
  - Toggle lock/unlock
  - View assignments (list of saved rolls)
  - Remove die (with confirmation)
- Close button

**Visual Design**:
```
┌───────────────────────────────────┐
│ ✕                    [Die Name]   │
│ ┌─────────────┐                   │
│ │             │  Type: d6         │
│ │ [3D Preview]│  Rarity: Mythic   │
│ │             │  Set: Celestial   │
│ └─────────────┘                   │
│                                   │
│ Stats:                            │
│  Total Rolls: 342                 │
│  ⚀ 1: 57  ⚁ 2: 54  ⚂ 3: 61      │
│  ⚃ 4: 48  ⚄ 5: 59  ⚅ 6: 63      │
│                                   │
│ Assigned to:                      │
│  • "Attack Roll" (Slot 1)         │
│  • "Damage" (Slot 2)              │
│                                   │
│ [Rename] [🔒 Lock] [🗑️ Remove]   │
└───────────────────────────────────┘
```

**Estimated Complexity**: Medium (2-3 hours)

**Acceptance Criteria**:
- [ ] Modal opens when clicking die card
- [ ] 3D preview is interactive (drag to rotate)
- [ ] Stats display correctly from die.stats
- [ ] Rename updates die name in store
- [ ] Lock/unlock toggles die.isLocked
- [ ] Remove shows confirmation before deleting
- [ ] Assignments list matches die.assignedToRolls

---

### 1.4 Integration with Bottom Nav

**Files**:
- `src/components/layout/BottomNav.tsx` (modify)
- `src/App.tsx` or `src/components/Scene.tsx` (modify)

**Changes**:
- Add new button to BottomNav for Inventory (💎 or 🎒 icon)
- Wire up open/close state for InventoryPanel
- Add InventoryPanel to Scene or App layout

**Estimated Complexity**: Low (30 min - 1 hour)

**Acceptance Criteria**:
- [ ] New inventory button added to BottomNav
- [ ] Button opens InventoryPanel
- [ ] Panel has proper z-index layering
- [ ] Panel can be closed (X button or outside click)

---

## 📊 Phase 1 Summary

**Total Estimated Time**: 8-11 hours
**Key Deliverables**:
1. Working inventory panel with grid view
2. Die cards with 3D previews
3. Detail modal with stats and actions
4. Basic filtering, sorting, search

**Dependencies**:
- ✅ Inventory store (already implemented)
- ✅ Theme system (for colors, styling)
- ⚠️ 3D rendering library (@react-three/fiber already in use)

**Testing Checklist**:
- [ ] Add dice via store (test with STARTER_DICE)
- [ ] All CRUD operations work from UI
- [ ] Lock/unlock persists across page refresh
- [ ] Rename updates immediately
- [ ] Stats track rolls correctly
- [ ] Search, filter, sort all functional
- [ ] Modal closes properly
- [ ] No memory leaks from 3D canvases

---

## 🛠️ Phase 2: Crafting UI

**Goal**: Implement crafting interface for combining dice

**Branch Strategy**: Branch from Phase 1 completion
```bash
git checkout -b feature/inventory-crafting-ui
```

### 2.1 Crafting Panel

**File**: `src/components/panels/CraftingPanel.tsx`

**Features**:
- Recipe browser (all recipes displayed)
- Recipe filtering (by output type, rarity)
- Ingredient selection (drag dice from inventory or click)
- Craft button (disabled if requirements not met)
- Currency cost display
- Success/failure feedback

**Visual Design**:
```
┌─────────────────────────────────────┐
│ Crafting Recipes                    │
│ ┌─────────────────────────────────┐ │
│ │ Filter: [All Types ▼] [All ▼]  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─ Recipe: 2x d6 → 1x d8 ─────┐   │
│ │ Input:  [d6] + [d6]          │   │
│ │ Output: [d8] (Rare)          │   │
│ │ Cost:   100 coins            │   │
│ │ [Select Dice] [Craft]        │   │
│ └──────────────────────────────┘   │
│                                     │
│ ┌─ Recipe: 3x d8 → 1x d10 ────┐   │
│ │ ...                          │   │
│ └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Estimated Complexity**: Medium-High (4-5 hours)

**Acceptance Criteria**:
- [ ] All recipes from config displayed
- [ ] Filter by type and rarity works
- [ ] Dice selection validates against recipe
- [ ] Craft button disabled if insufficient resources
- [ ] Crafting consumes inputs and creates output
- [ ] Success animation/notification
- [ ] Newly crafted die appears in inventory

---

### 2.2 Recipe Card Component

**File**: `src/components/crafting/RecipeCard.tsx`

**Features**:
- Input dice display (with type + rarity)
- Arrow indicator (→)
- Output die display
- Currency cost badge
- Can craft indicator (checkmark or disabled state)

**Estimated Complexity**: Low-Medium (1-2 hours)

**Acceptance Criteria**:
- [ ] All recipe details displayed clearly
- [ ] Visual distinction between available/unavailable
- [ ] Hover shows tooltip with requirements

---

### 2.3 Dice Selector Modal

**File**: `src/components/crafting/DiceSelectorModal.tsx`

**Features**:
- Grid of eligible dice (matching recipe requirements)
- Multi-select for recipes needing multiple dice
- Selected count indicator
- Confirm button

**Estimated Complexity**: Medium (2-3 hours)

**Acceptance Criteria**:
- [ ] Only shows dice matching recipe requirements
- [ ] Multi-select works correctly
- [ ] Selected dice highlighted
- [ ] Locked dice excluded
- [ ] Assigned dice show warning before use

---

## 📊 Phase 2 Summary

**Total Estimated Time**: 7-10 hours
**Key Deliverables**:
1. Crafting panel with recipe browser
2. Recipe cards with validation
3. Dice selector for crafting inputs
4. Working craft flow (consume inputs → create output)

**Testing Checklist**:
- [ ] All recipes validate correctly
- [ ] Crafting with insufficient resources fails gracefully
- [ ] Crafting consumes correct dice
- [ ] Currency deducted properly
- [ ] New die has correct stats and appearance
- [ ] Locked dice cannot be used in crafting
- [ ] Set inheritance works ("inherit" setId)

---

## 🔗 Phase 3: Saved Rolls Integration

**Goal**: Connect inventory dice to saved rolls system

**Branch Strategy**: Branch from Phase 2 or merge with `claude/drag-drop-dice-builder`
```bash
# Option 1: Branch from Phase 2
git checkout -b feature/inventory-saved-rolls-integration

# Option 2: Merge with drag-drop branch
git checkout claude/drag-drop-dice-builder-01Fqx1VvQNQKYNG1fbu9bNrQ
git merge feature/inventory-crafting-ui
```

### 3.1 Modify SavedRollBuilder

**File**: `src/components/panels/saved-rolls/RollBuilder.tsx`

**Changes**:
- Add "Assign Die" button to each dice entry slot
- Open DieAssignmentModal when clicked
- Display assigned die name/icon in slot
- Support "unassign" action

**Visual Design**:
```
Entry: Attack Roll
┌────────────────────────────┐
│ d20  [Celestial d20] 🗑️   │ ← Assigned die shown
│ d6   [Assign Die ▼]        │ ← Not assigned
│ d6   [Assign Die ▼]        │
│ +5                         │
└────────────────────────────┘
```

**Estimated Complexity**: Medium (2-3 hours)

**Acceptance Criteria**:
- [ ] Assign button opens DieAssignmentModal
- [ ] Assigned die displays correctly
- [ ] Unassign removes assignment (reverts to random)
- [ ] Assignment persists across sessions

---

### 3.2 Die Assignment Modal

**File**: `src/components/inventory/DieAssignmentModal.tsx`

**Features**:
- List of owned dice matching the slot type (d6, d20, etc.)
- Filter by set, rarity
- Search by name
- "Use Random" option (unassign)
- Preview of selected die

**Estimated Complexity**: Medium (2-3 hours)

**Acceptance Criteria**:
- [ ] Only shows dice of correct type
- [ ] Filter and search work
- [ ] Selecting die updates assignment
- [ ] "Use Random" clears assignment
- [ ] Assignment updates in both stores (inventory + savedRolls)

---

### 3.3 Roll Execution Integration

**File**: `src/lib/rollEngine.ts` (modify)

**Changes**:
- Check if entry has assigned die (via `useInventoryStore.assignments`)
- If assigned, use that die's ID for tracking
- Update die.stats when rolling with assigned die

**Estimated Complexity**: Medium (2-3 hours)

**Acceptance Criteria**:
- [ ] Roll engine checks for assignments
- [ ] Assigned die stats update on each roll
- [ ] Unassigned slots still use random dice
- [ ] Roll results match assigned die appearance

---

### 3.4 Visual Indicators

**Files**: Various (DiceCard, SavedRollCard, RollBuilder)

**Changes**:
- Show "📋 Assigned" badge on die cards
- List assigned rolls in DieDetailModal
- Show die icon in SavedRollCard for assigned dice

**Estimated Complexity**: Low-Medium (1-2 hours)

**Acceptance Criteria**:
- [ ] Die cards show assignment count
- [ ] Detail modal lists all assignments
- [ ] Saved roll cards show assigned dice
- [ ] Visual consistency across components

---

## 📊 Phase 3 Summary

**Total Estimated Time**: 7-10 hours
**Key Deliverables**:
1. Die assignment to saved roll slots
2. Assignment modal with filtering
3. Roll engine integration (stats tracking)
4. Visual indicators throughout UI

**Testing Checklist**:
- [ ] Assign die to saved roll slot
- [ ] Roll executes with assigned die
- [ ] Stats update correctly
- [ ] Unassign reverts to random
- [ ] Assignment persists across sessions
- [ ] Locked dice cannot be assigned (or show warning)
- [ ] Multiple rolls can use same die
- [ ] Removing die clears all assignments

---

## 🎰 Phase 4: Gacha System (Future)

**Goal**: Implement gacha/banner system for acquiring dice

**Status**: Design complete, implementation deferred

**Key Components** (from INVENTORY_ARCHITECTURE.md):
- Banner configuration (rateup dice, pity thresholds)
- Pull mechanics (single, 10-pull)
- Pity system (soft pity at 70, hard pity at 90)
- Pull history tracking
- Gacha UI (banner display, pull animation, results)

**Estimated Time**: 15-20 hours (large feature)

**Priority**: Low (not needed for MVP)

---

## 🧪 Testing Strategy

### Unit Tests
- [ ] `useInventoryStore` all methods
- [ ] Crafting validation logic
- [ ] Assignment tracking (assign, unassign, remove die)
- [ ] Currency operations
- [ ] Stats tracking

### Integration Tests
- [ ] Full craft flow (select dice → craft → verify output)
- [ ] Full assignment flow (assign → roll → stats update)
- [ ] Set completion tracking
- [ ] Persistence (localStorage save/restore)

### E2E Tests (Playwright)
- [ ] Open inventory panel
- [ ] Click die card → detail modal opens
- [ ] Rename die → persists
- [ ] Craft recipe → new die appears
- [ ] Assign die to saved roll → roll executes

---

## 📝 Notes & Considerations

### Performance
- 3D previews in die cards may be expensive
  - **Solution**: Use static images for grid, 3D only in detail modal
  - **Alternative**: Render 3D once, cache as texture
- Large inventories (500+ dice) may slow grid rendering
  - **Solution**: Virtualized scrolling (react-window or similar)

### UX Decisions
- **Die Removal**: Should require confirmation (especially for assigned dice)
- **Crafting Failures**: Rare, but should have graceful error messages
- **Assignment Conflicts**: What if die is locked after being assigned?
  - **Proposal**: Show warning in SavedRollBuilder, allow roll but prevent locking removal

### Future Enhancements (Post-MVP)
- Bulk operations (select multiple dice, bulk craft)
- Die trading (multiplayer feature)
- Die customization (rename presets, custom colors)
- Achievement system (collect all in set, roll 1000 times, etc.)
- Analytics dashboard (most rolled die, luckiest die, etc.)

---

## 🚢 Deployment Checklist

Before merging to main:
- [ ] All TypeScript errors resolved
- [ ] All tests passing (unit + integration)
- [ ] No console errors in dev/prod builds
- [ ] Performance profiling (no frame drops in 3D previews)
- [ ] Accessibility audit (keyboard navigation, screen readers)
- [ ] Mobile testing (touch interactions, responsive layout)
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] Documentation updated (CLAUDE.md, README.md)
- [ ] Migration strategy (initialize new users with starter dice)

---

## 📚 Related Documentation

- Architecture: `docs/INVENTORY_ARCHITECTURE.md`
- Type Definitions: `src/types/inventory.ts`, `crafting.ts`, `gacha.ts`
- Store Implementation: `src/store/useInventoryStore.ts`
- Configuration: `src/config/dieSets.ts`, `starterDice.ts`, `craftingRecipes.ts`

---

**Last Updated**: 2025-11-16
**Status**: Foundation complete, ready for Phase 1 UI implementation
