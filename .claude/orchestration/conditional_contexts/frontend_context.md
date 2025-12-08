# Frontend Context (500-800 tokens)

## Component Patterns
- `memo` + `forwardRef` for performance-critical components
- `useCallback` for event handlers to prevent re-renders
- `useMemo` for expensive computations
- Custom hooks for shared logic

## Key Components

### Dice Components
- `Dice.tsx`: Generic dice component
  - Props: `diceType`, `inventoryDieId`, `position`, `customAsset`
  - Uses `useFaceDetection` hook for result tracking
  - Integrates haptic feedback via `useHapticFeedback`
- `CustomDice.tsx`: Custom GLB model support
  - Loads models via `useCustomDiceLoader` hook
  - Auto-detects collider type (cuboid/ball/convex)

### Layout Components
- `Scene.tsx`: Main 3D scene with Rapier physics
  - Manages dice spawning/despawning
  - Displays roll results with bonuses
  - Handles saved roll execution
- `DiceToolbar.tsx`: Dice type selector
  - Shows availability badges (owned - in use)
  - Disables buttons when count reaches 0
- `BottomNav.tsx`: Main navigation (Roll, Panels)

### Panel Components
- `InventoryPanel.tsx`: Owned dice collection
  - Displays dice with quantities
  - Remove dev dice functionality
- `SavedRollsPanel.tsx`: Saved roll configurations
  - Execute saved rolls with bonuses
  - Formula display: `6d6 + 4`
- `SettingsPanel.tsx`: User preferences
  - Haptic toggle
  - Theme selector
- `ArtistTestingPanel.tsx`: Custom dice upload
  - GLB file upload
  - Metadata input (collider type, scale, mass)

## Styling Rules
- Inline styles with theme tokens (no CSS files)
- Theme-aware colors via `useTheme()` hook
- Access colors: `currentTheme.tokens.colors.accent`
- No Tailwind/Bootstrap

## State Integration
- **useDiceManagerStore**: Active dice on table
  - `handleAddDice(diceType, inventoryDieId)`
  - `handleRemoveDice(diceId)`
  - `handleRollAll()`
- **useInventoryStore**: Owned dice collection
  - `getAvailableCount(diceType)` for toolbar badges
- **useUIStore**: UI preferences
  - `hapticEnabled` for settings toggle
  - `theme` for active theme

## Dependencies
- Interfaces: `src/types/inventory.ts`, `src/types/dice.ts`
- Hooks: `useFaceDetection`, `useHapticFeedback`, `useTheme`
- Stores: `useDiceManagerStore`, `useInventoryStore`, `useUIStore`
