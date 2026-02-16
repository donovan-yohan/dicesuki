# Changelog

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for recent updates and changes.

## 2025-11-17: Custom Dice Persistence Fixes
- **IndexedDB Transaction Timing Bug Fixed**
  - Root cause: `await fileData.arrayBuffer()` called AFTER opening transaction
  - IndexedDB transactions auto-commit when no pending work
  - Fix: Moved Blob-to-ArrayBuffer conversion BEFORE opening database transaction
  - Result: Custom dice GLB files now successfully save to IndexedDB

- **Blob URL Revocation Bug Fixed**
  - Issue: Multiple uploads with same filename broke previously uploaded dice
  - Root cause: `URL.revokeObjectURL()` invalidated blob URLs stored in inventory
  - Fix: Removed ALL blob URL revocation from ArtistTestingPanel
  - Rationale: Blob URLs regenerated from IndexedDB on page reload anyway
  - Trade-off: Acceptable memory usage for dev/test dice during session

- **Environment Lighting Restored**
  - Added back `<Environment preset="night" />` component to Scene.tsx
  - Works additively with existing ambient and directional lights
  - Provides subtle IBL (Image-Based Lighting) without overexposure

- **Artist Testing Panel UX**
  - Modal now closes when clicking backdrop (outside modal content)
  - Added `onClick` handler with `stopPropagation` on content div

## 2025-11-16: PR Review Fixes - Artist Testing Platform
- **Code Quality Improvements**: Addressed all 10 Copilot PR review comments
  - Fixed blob URL memory leaks in ArtistTestingPanel with proper ref-based cleanup
  - Improved useGLTF hook safety with data URI fallback for null assets
  - Added physics colliders (RigidBody + CuboidCollider) to preview scene floor and walls
  - Renamed `colliderConfig` to `colliderType` for clarity and accuracy
  - Enhanced type safety: `ThreeEvent<PointerEvent>` instead of `any` in CustomDice
  - Fixed validation logic: scale/mass conditions now match error messages (0.1 minimum)
  - Removed unused imports: DiceMetadata, ValidationResult, serializeMetadata
- **Build Verification**: All TypeScript checks passing, production build successful
  - No compilation errors, exit code 0
  - Vercel deployment ready with proper dist/ output
  - Only informational warnings (chunk size optimization suggestions)

## 2025-11-16: Inventory-Based Dice Limiting System
- **Core Feature**: Implemented inventory-based dice spawning limits
  - Players can only spawn dice they own from inventory
  - Each spawned die links to specific inventory die via `inventoryDieId`
  - Real-time availability tracking (owned - in use)
  - Prevents over-spawning beyond owned quantity

- **Starter Dice Configuration** (src/config/starterDice.ts)
  - Updated distribution: 6d4, 6d6, 4d8, 2d10, 2d12, 1d20 (21 total)
  - All starter dice locked (`isLocked: true`) to prevent deletion/crafting
  - Guarantees players always have minimum dice collection

- **DiceToolbar UI** (src/components/layout/DiceToolbar.tsx)
  - Shows available count badges (owned - in use)
  - Buttons disable when count reaches 0 (50% opacity, cursor: not-allowed)
  - No hover/tap animations when disabled
  - Tooltip updates: "No {TYPE} available" when disabled

- **DiceManagerStore** (src/store/useDiceManagerStore.ts)
  - Added `inventoryDieId` field to `DiceInstance` interface
  - Added `getInUseDiceIds()` function for tracking
  - Removed default hardcoded d6 on load
  - Table starts empty, populated from inventory

- **Scene Initialization** (src/components/Scene.tsx)
  - Auto-spawns 1 d20 from inventory on first load
  - Uses ref-based guard (`hasSpawnedInitialDie`) to prevent double-spawn
  - `handleAddDice` validates availability before spawning
  - Console warnings when attempting to spawn unavailable dice

## 2025-11-16: Saved Rolls Bonus System
- **Formula Display**: Fixed double-plus bug (`6d6 + +4` → `6d6 + 4`)
  - Updated `formatSavedRoll()` to properly handle positive/negative operators
- **Bonus Tracking**: Implemented persistent bonus display through roll lifecycle
  - Added `activeSavedRoll` state to `useDiceStore` with `expectedDiceCount` tracking
  - Bonuses now persist when clicking ROLL button
  - Bonuses auto-clear when dice count changes (add/remove/clear operations)
- **Result Display**: Enhanced to show grand total with bonuses
  - Large total at top: `diceSum + perDieBonuses + flatBonus`
  - Breakdown label: Shows `"19 + 4"` when flat bonus present
  - Per-die bonuses shown beneath individual dice values
  - Shows `?` while rolling (hides partial sum until complete)

## 2025-11-16: UI Enhancements & Theme Integration
- **DiceToolbar**: Integrated with theme system for dynamic colors
  - Dice buttons now use `currentTheme.tokens.colors.accent` and `currentTheme.tokens.colors.surface`
  - Hover effects use `currentTheme.tokens.colors.dice.highlight`
  - Implemented dual trash button functionality: click to clear all, drag to delete individual dice
- **Theme System**: All themes now owned by default for development/testing
  - Added one-time migration in ThemeProvider to grant access to all themes
- **Dungeon Theme**: Updated environment colors for authentic castle aesthetic
  - Floor: `#2a2a2a` (dark gray stone)
  - Walls: `#333333` (dark gray stone)
  - Lighting: Neutral gray ambient (`#999999`) with minimal directional light
