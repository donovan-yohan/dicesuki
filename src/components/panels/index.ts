/**
 * Panel Components
 *
 * Central export for all panel-related components.
 */

export { FlyoutPanel } from './FlyoutPanel'
export { BottomSheet } from './BottomSheet'
export { DiceManagerPanel } from './DiceManagerPanel'
export { HistoryPanel } from './HistoryPanel'
export { SettingsPanel } from './SettingsPanel'
export { SavedRollsPanel } from './SavedRollsPanel'
export { InventoryPanel } from './InventoryPanel'
// ShopPanel is deliberately NOT re-exported. It is the root of the economy
// subtree and is `lazy()`-loaded behind `useEconomyAccess()` in Scene.tsx; a
// static re-export here gives Rollup a static edge to it, which silently
// collapses that dynamic import back into the main chunk (no warning, no test
// failure, just a 79 kB storefront shipped to every un-flagged player).
// Import it from './panels/ShopPanel' directly if you ever need it eagerly.
export { HeroDieInspector } from './HeroDieInspector'
