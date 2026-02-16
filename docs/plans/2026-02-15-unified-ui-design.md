# Unified Single-Player / Multiplayer UI — Design Document

**Date:** 2026-02-15

## Problem

The multiplayer room uses entirely separate components (scene, dice, result display, toolbar, history) from single-player mode. This means:
1. UI looks/feels different between modes
2. Features built for single-player must be rebuilt for multiplayer
3. The 20Hz server snapshot rate creates visible "gliding" despite interpolation

## Design: Adapter Pattern

A `useDiceBackend()` hook provides a uniform interface. Scene.tsx and all UI components consume this hook — they don't know or care which mode they're in.

- **Local backend**: wraps Rapier WASM physics (current single-player behavior)
- **Multiplayer backend**: wraps WebSocket connection, receives server snapshots
- **DiceBackendProvider**: React context that sets the mode

### Rendering

Inside the Canvas, rendering is conditional:
- Local mode: `<Physics>` provider wraps `<Dice>` components with full physics
- Multiplayer mode: No `<Physics>`, render `<MultiplayerDie>` with interpolation

Everything outside the Canvas (ResultDisplay, DiceToolbar, HistoryPanel, BottomNav) is shared.

### Store Unification

- `useDiceStore` becomes the unified roll-state store for both modes
- Multiplayer `die_settled`/`roll_complete` messages write into `useDiceStore`
- `useRoomHistoryStore` is removed; history goes through `useDiceStore.rollHistory`
- `RollSnapshot` gains an optional `player` field for multiplayer attribution

### Snapshot Rate

Server snapshot divisor extracted to configurable constant, defaulting to 1 (60Hz) to eliminate the gliding artifact.

### Future Extensibility

`UnifiedDie` interface has room for optional `appearance` field for paid cosmetics (dice skins, table themes). Unified rendering pipeline means cosmetics only need to be built once.

## Files Changed

**New:** `useDiceBackend.ts`, `DiceBackendContext.tsx`
**Modified:** `Scene.tsx`, `MultiplayerRoom.tsx`, `App.tsx`, `useDiceStore.ts`, `useMultiplayerStore.ts`, `HistoryPanel.tsx`, `server/src/room.rs`
**Deleted:** `MultiplayerScene.tsx`, `MultiplayerResultDisplay.tsx`, `MultiplayerToolbar.tsx`, `RoomRollHistory.tsx`, `useRoomHistoryStore.ts`
