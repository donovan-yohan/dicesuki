# ADR 002 - Zustand for Global State Management

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

The application requires global state management for several distinct domains: dice physics state, dice manager (spawning/removal), UI preferences, player inventory, multiplayer networking, saved rolls, room history, and drag interactions. State updates range from high-frequency physics loop reads to user-initiated UI changes. Some state must persist across sessions (inventory, roll history, preferences), while other state is ephemeral (multiplayer connection, drag position).

React Context alone is insufficient because:
- High-frequency updates (physics loop) would cause unnecessary re-renders across the component tree
- Multiple independent state domains need isolation
- Some stores need `persist` middleware for localStorage
- Stores must be accessible outside React components (e.g., from physics callbacks, WebSocket handlers)

## Decision

All global state MUST be managed through **Zustand** (v4) stores. Each logical domain MUST have its own dedicated store.

### Current Store Inventory

| Store | File | Persistence | Purpose |
|-------|------|-------------|---------|
| `useDiceStore` | `src/store/useDiceStore.ts` | Partial (rollHistory only) | Roll state, settled dice, active saved roll bonuses |
| `useDiceManagerStore` | `src/store/useDiceManagerStore.ts` | No | Spawned dice instances, add/remove/clear |
| `useUIStore` | `src/store/useUIStore.ts` | Partial | UI preferences (haptic enabled, panel state) |
| `useInventoryStore` | `src/store/useInventoryStore.ts` | Yes (versioned) | Dice collection, currency, crafting, assignments |
| `useMultiplayerStore` | `src/store/useMultiplayerStore.ts` | No | WebSocket connection, room state, remote dice |
| `useSavedRollsStore` | `src/store/useSavedRollsStore.ts` | Yes | Saved roll configurations with bonuses |
| `useRoomHistoryStore` | `src/store/useRoomHistoryStore.ts` | No | Multiplayer room roll history |
| `useDragStore` | `src/store/useDragStore.ts` | No | Active drag state for dice interaction |

### Store Design Rules

1. **Map and Set reactivity:** Zustand uses shallow equality for change detection. State updates involving `Map` or `Set` MUST create new instances (e.g., `new Map(existing)`) rather than mutating in place.

2. **Persistence with `partialize`:** Stores using `persist` middleware SHOULD use `partialize` to exclude non-serializable or ephemeral state. Maps and Sets MUST NOT be persisted directly; convert to serializable formats if persistence is needed.

3. **Schema versioning:** Persisted stores MUST include a `version` number and a `migrate` function. When the stored schema changes, increment the version and handle migration from all prior versions.

4. **External access:** Stores MAY be accessed outside React components via `useStore.getState()` for WebSocket handlers, physics callbacks, and other non-React code paths.

5. **Store granularity:** Each store SHOULD represent a single bounded domain. New features SHOULD NOT add state to an existing store unless the state is tightly coupled to that store's domain.

### React Context Usage

React Context SHOULD be reserved for provider-pattern concerns that wrap subtrees:
- `ThemeProvider` (theme tokens and switching)
- `DeviceMotionProvider` (accelerometer/gyroscope data)

React Context MUST NOT be used for high-frequency state that changes on every frame.

## Alternatives Considered

**Redux Toolkit:** More structured with actions/reducers/selectors, but adds boilerplate. Zustand's simpler API and direct mutation-style updates (via Immer-like patterns) are a better fit for the team size and iteration speed. Redux DevTools integration is available via Zustand middleware if needed.

**Jotai:** Atomic state management would work well for isolated values but makes it harder to reason about store-level operations like `reset()`, `initializeStarterDice()`, and cross-field consistency within a domain.

**React Context + useReducer:** Sufficient for low-frequency state but causes re-renders in all consumers on any state change. Physics-loop reads and multiplayer snapshot processing would create severe performance issues.

**Valtio:** Proxy-based reactivity is elegant but less explicit about when state changes propagate. Zustand's selector-based subscriptions give finer control over re-render boundaries.

## Consequences

### Positive

- Minimal boilerplate: stores are plain functions with `create()`, no providers needed
- Fine-grained subscriptions via selectors prevent unnecessary re-renders
- `persist` middleware handles localStorage with migration support out of the box
- Stores are accessible outside React (WebSocket handlers, physics callbacks) via `getState()`
- TypeScript-first API with strong type inference

### Negative / Considerations

- No built-in devtools (requires optional middleware for Redux DevTools)
- Shallow equality for Maps/Sets requires discipline to create new instances on every update
- No enforced patterns for async operations (each store handles its own async logic)
- Schema migration logic in `persist` must be maintained manually as the app evolves
- Eight stores is a moderate count; naming conventions and documentation in CLAUDE.md are essential to keep the store landscape navigable
