# Unified Single-Player / Multiplayer UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify single-player and multiplayer to share one Scene, one set of UI components, with only the physics backend swapped.

**Architecture:** Adapter pattern via `useDiceBackend()` hook + `DiceBackendContext`. Scene.tsx conditionally renders physics (local) or interpolated meshes (multiplayer) inside Canvas. All UI components outside Canvas are shared, reading from the backend hook. Server snapshot rate becomes configurable (default 60Hz).

**Tech Stack:** React 19, Zustand, React Three Fiber 9, @react-three/rapier 2, Rust/Axum server, WebSocket

---

## Task 1: Server — Configurable Snapshot Rate

**Files:**
- Modify: `server/src/room.rs:10-13` (constants) and `server/src/room.rs:232-253` (physics_tick)

**Step 1: Add snapshot divisor constant**

In `server/src/room.rs`, add a new constant after the existing ones at line 12:

```rust
pub const MAX_PLAYERS: usize = 8;
pub const MAX_DICE: usize = 30;
pub const IDLE_TIMEOUT_SECS: u64 = 1800;
pub const SNAPSHOT_DIVISOR: u64 = 1; // 1 = every tick (60Hz), 2 = 30Hz, 3 = 20Hz
```

**Step 2: Use the constant in physics_tick**

In `server/src/room.rs`, replace the hardcoded `3` at line 233:

```rust
// Before:
let snapshot = if self.tick_count % 3 == 0 {

// After:
let snapshot = if self.tick_count % SNAPSHOT_DIVISOR == 0 {
```

**Step 3: Update the test that checks snapshot timing**

In `server/src/room.rs`, the `test_physics_tick_produces_snapshots` test (line 581) currently expects a snapshot on the 3rd tick. Update it to work with SNAPSHOT_DIVISOR = 1:

```rust
#[test]
fn test_physics_tick_produces_snapshots() {
    let mut room = Room::new("test".to_string());
    let player = make_player("p1", "Gandalf");
    room.add_player(player).unwrap();
    room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
    room.roll_player_dice("p1");

    // With SNAPSHOT_DIVISOR=1, every tick should produce a snapshot
    let (snap1, _) = room.physics_tick();
    assert!(snap1.is_some(), "Every tick should produce a snapshot with divisor=1");
}
```

**Step 4: Run server tests**

Run: `~/.cargo/bin/cargo test --manifest-path server/Cargo.toml`
Expected: All 66 tests pass (48 unit + 18 integration)

**Step 5: Commit**

```bash
git add server/src/room.rs
git commit -m "feat(server): configurable snapshot rate, default 60Hz

- Extract SNAPSHOT_DIVISOR constant (was hardcoded % 3)
- Default to 1 (every tick = 60Hz) for smooth multiplayer animation
- Eliminates visible 'gliding' artifact from 20Hz snapshots
- Update snapshot test for new default rate"
```

---

## Task 2: Extend RollSnapshot With Player Attribution

**Files:**
- Modify: `src/store/useDiceStore.ts`
- Test: `src/store/useDiceStore.test.ts` (if exists, otherwise create)

**Step 1: Add player field to RollSnapshot interface**

In `src/store/useDiceStore.ts`, update the `RollSnapshot` interface:

```typescript
/**
 * Represents a snapshot of a completed roll cycle for history
 */
export interface RollSnapshot {
  dice: DieSettledState[]
  sum: number
  timestamp: number
  /** Multiplayer-only: who rolled. Null/undefined in local mode. */
  player?: {
    id: string
    displayName: string
    color: string
  }
}
```

This is a backwards-compatible additive change — existing local-mode snapshots simply won't have the `player` field, and the persist middleware's `rollHistory` serialization handles optional fields naturally.

**Step 2: Verify existing tests still pass**

Run: `npx vitest run`
Expected: 161 passing, 3 failing (pre-existing haptic), 16 skipped — no regressions

**Step 3: Commit**

```bash
git add src/store/useDiceStore.ts
git commit -m "feat(store): add optional player field to RollSnapshot

- Supports multiplayer attribution in roll history
- Backwards-compatible: local mode snapshots omit the field
- No behavior change for existing single-player flow"
```

---

## Task 3: Create DiceBackendContext and Types

**Files:**
- Create: `src/contexts/DiceBackendContext.tsx`

**Step 1: Create the context with types and provider**

Create `src/contexts/DiceBackendContext.tsx`:

```typescript
import { createContext, useContext, type ReactNode } from 'react'
import type { DiceShape } from '../lib/geometries'
import type { RollSnapshot } from '../store/useDiceStore'

export type DiceBackendMode = 'local' | 'multiplayer'

export interface PlayerInfo {
  id: string
  displayName: string
  color: string
}

export interface DiceBackendState {
  /** Which mode is active */
  mode: DiceBackendMode

  /** Roll actions */
  roll: () => void
  addDie: (type: DiceShape, inventoryDieId?: string) => void
  removeDie: (id: string) => void
  clearAll: () => void

  /** Roll history */
  rollHistory: RollSnapshot[]
  clearHistory: () => void

  /** Multiplayer-only context (null in local mode) */
  multiplayer: {
    players: Map<string, PlayerInfo>
    localPlayerId: string
    roomId: string
    connectionStatus: 'disconnected' | 'connecting' | 'connected'
  } | null
}

const DiceBackendContext = createContext<DiceBackendState | null>(null)

export function useDiceBackend(): DiceBackendState {
  const ctx = useContext(DiceBackendContext)
  if (!ctx) {
    throw new Error('useDiceBackend must be used within a DiceBackendProvider')
  }
  return ctx
}

interface DiceBackendProviderProps {
  value: DiceBackendState
  children: ReactNode
}

export function DiceBackendProvider({ value, children }: DiceBackendProviderProps) {
  return (
    <DiceBackendContext.Provider value={value}>
      {children}
    </DiceBackendContext.Provider>
  )
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No new type errors

**Step 3: Commit**

```bash
git add src/contexts/DiceBackendContext.tsx
git commit -m "feat(context): add DiceBackendContext with types

- DiceBackendState interface for unified backend abstraction
- DiceBackendProvider component and useDiceBackend hook
- Supports local and multiplayer modes"
```

---

## Task 4: Create useLocalDiceBackend Hook

**Files:**
- Create: `src/hooks/useLocalDiceBackend.ts`

This hook wraps the existing single-player stores and logic into the `DiceBackendState` interface. It does NOT change any existing behavior — it just provides a facade.

**Step 1: Create the hook**

Create `src/hooks/useLocalDiceBackend.ts`:

```typescript
import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import type { DiceShape } from '../lib/geometries'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useTheme } from '../contexts/ThemeContext'
import { spawnDiceFromToolbar, spawnSpecificDie } from '../lib/diceSpawner'

/**
 * Local (single-player) implementation of the dice backend.
 *
 * The roll() action is a no-op here — Scene.tsx still handles
 * the actual physics impulse via diceRefs. This hook just provides
 * the unified interface for UI components.
 *
 * @param onRoll - callback that Scene.tsx provides to trigger physics roll
 */
export function useLocalDiceBackend(onRoll: () => void): DiceBackendState {
  const rollHistory = useDiceStore((s) => s.rollHistory)
  const { currentTheme } = useTheme()

  const addDie = useCallback((type: DiceShape, inventoryDieId?: string) => {
    useDiceStore.getState().clearActiveSavedRoll()

    if (inventoryDieId) {
      const result = spawnSpecificDie(inventoryDieId, type, currentTheme.id)
      if (!result.success) {
        console.warn(`[useLocalDiceBackend] Failed to spawn die: ${result.error}`)
      }
    } else {
      const result = spawnDiceFromToolbar(type, currentTheme.id)
      if (!result.success) {
        console.warn(`[useLocalDiceBackend] Failed to spawn die: ${result.error}`)
      }
    }
  }, [currentTheme.id])

  const removeDie = useCallback((id: string) => {
    const store = useDiceStore.getState()
    store.removeDieState(id)
    store.clearActiveSavedRoll()
    useDiceManagerStore.getState().removeDice(id)
  }, [])

  const clearAll = useCallback(() => {
    const store = useDiceStore.getState()
    store.clearAllDieStates()
    store.clearActiveSavedRoll()
    useDiceManagerStore.getState().removeAllDice()
  }, [])

  const clearHistory = useCallback(() => {
    useDiceStore.getState().clearHistory()
  }, [])

  return {
    mode: 'local',
    roll: onRoll,
    addDie,
    removeDie,
    clearAll,
    rollHistory,
    clearHistory,
    multiplayer: null,
  }
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No new type errors

**Step 3: Commit**

```bash
git add src/hooks/useLocalDiceBackend.ts
git commit -m "feat(hooks): add useLocalDiceBackend

- Wraps existing single-player stores into DiceBackendState
- Facade only — no behavior changes to existing flow
- Scene.tsx still owns the physics roll via onRoll callback"
```

---

## Task 5: Create useMultiplayerDiceBackend Hook

**Files:**
- Create: `src/hooks/useMultiplayerDiceBackend.ts`
- Modify: `src/store/useMultiplayerStore.ts` (wire die_settled/roll_complete into useDiceStore)

**Step 1: Wire multiplayer messages into useDiceStore**

In `src/store/useMultiplayerStore.ts`, add an import at the top:

```typescript
import { useDiceStore } from './useDiceStore'
```

In the `handleServerMessage` switch, update the `roll_started` case to also mark dice rolling in useDiceStore:

```typescript
case 'roll_started': {
  const { dice } = get()
  const newDice = new Map(dice)
  for (const id of msg.diceIds) {
    const die = newDice.get(id)
    if (die) {
      newDice.set(id, { ...die, isRolling: true, faceValue: null })
    }
  }
  set({ dice: newDice })

  // Also mark in unified dice store
  useDiceStore.getState().markDiceRolling(msg.diceIds)
  break
}
```

Update the `die_settled` case to also record in useDiceStore:

```typescript
case 'die_settled': {
  const { dice } = get()
  const newDice = new Map(dice)
  const die = newDice.get(msg.diceId)
  if (die) {
    newDice.set(msg.diceId, {
      ...die,
      isRolling: false,
      faceValue: msg.faceValue,
      position: msg.position,
      rotation: msg.rotation,
      targetPosition: msg.position,
      targetRotation: msg.rotation,
      prevPosition: msg.position,
      prevRotation: msg.rotation,
    })
  }
  set({ dice: newDice })

  // Also record in unified dice store
  if (die) {
    useDiceStore.getState().recordDieSettled(
      msg.diceId,
      msg.faceValue,
      die.diceType,
    )
  }
  break
}
```

Update the `roll_complete` case to write to useDiceStore.rollHistory instead of useRoomHistoryStore:

```typescript
case 'roll_complete': {
  const { players } = get()
  const player = players.get(msg.playerId)
  if (player) {
    // Write to unified dice store history (replaces useRoomHistoryStore)
    const diceEntries = msg.results.map((r) => ({
      diceId: r.diceId || r.dice_id || '',
      value: r.faceValue || r.face_value || 0,
      type: (r.diceType || r.dice_type || 'unknown').toString(),
      settledAt: Date.now(),
    }))
    const sum = diceEntries.reduce((acc, d) => acc + d.value, 0)

    const { rollHistory } = useDiceStore.getState()
    useDiceStore.setState({
      rollHistory: [...rollHistory, {
        dice: diceEntries,
        sum,
        timestamp: Date.now(),
        player: {
          id: msg.playerId,
          displayName: player.displayName,
          color: player.color,
        },
      }],
    })
  }
  break
}
```

**Step 2: Remove the useRoomHistoryStore import from useMultiplayerStore**

Remove this line from the top of `src/store/useMultiplayerStore.ts`:
```typescript
// REMOVE:
import { useRoomHistoryStore } from './useRoomHistoryStore'
```

**Step 3: Create the multiplayer backend hook**

Create `src/hooks/useMultiplayerDiceBackend.ts`:

```typescript
import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import type { DiceShape } from '../lib/geometries'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'

/**
 * Multiplayer implementation of the dice backend.
 * Actions send WebSocket messages; state comes from server via useMultiplayerStore.
 */
export function useMultiplayerDiceBackend(): DiceBackendState {
  const mpSpawnDice = useMultiplayerStore((s) => s.spawnDice)
  const mpRemoveDice = useMultiplayerStore((s) => s.removeDice)
  const mpRoll = useMultiplayerStore((s) => s.roll)
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const roomId = useMultiplayerStore((s) => s.roomId)
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const dice = useMultiplayerStore((s) => s.dice)

  // Read from unified store (populated by useMultiplayerStore message handlers)
  const rollHistory = useDiceStore((s) => s.rollHistory)

  const addDie = useCallback((type: DiceShape) => {
    mpSpawnDice(type)
  }, [mpSpawnDice])

  const removeDie = useCallback((id: string) => {
    mpRemoveDice([id])
  }, [mpRemoveDice])

  const clearAll = useCallback(() => {
    const myDiceIds = Array.from(dice.values())
      .filter((d) => d.ownerId === localPlayerId)
      .map((d) => d.id)
    if (myDiceIds.length > 0) {
      mpRemoveDice(myDiceIds)
    }
  }, [dice, localPlayerId, mpRemoveDice])

  const clearHistory = useCallback(() => {
    useDiceStore.getState().clearHistory()
  }, [])

  return {
    mode: 'multiplayer',
    roll: mpRoll,
    addDie,
    removeDie,
    clearAll,
    rollHistory,
    clearHistory,
    multiplayer: localPlayerId && roomId ? {
      players,
      localPlayerId,
      roomId,
      connectionStatus,
    } : null,
  }
}
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No new type errors

**Step 5: Commit**

```bash
git add src/hooks/useMultiplayerDiceBackend.ts src/store/useMultiplayerStore.ts
git commit -m "feat(hooks): add useMultiplayerDiceBackend

- Wire die_settled/roll_complete into useDiceStore for unified state
- Remove useRoomHistoryStore dependency from useMultiplayerStore
- Multiplayer backend sends WebSocket messages for all actions"
```

---

## Task 6: Wire DiceBackendProvider Into Scene.tsx

This is the biggest task. Scene.tsx currently has inline handler functions that directly use stores. We refactor it to:
1. Create the local backend via `useLocalDiceBackend()`
2. Wrap itself in `DiceBackendProvider`
3. Use `useDiceBackend()` in sub-components

**Files:**
- Modify: `src/components/Scene.tsx`

**Step 1: Add imports and create the backend**

At the top of Scene.tsx, add:

```typescript
import { DiceBackendProvider } from '../contexts/DiceBackendContext'
import { useLocalDiceBackend } from '../hooks/useLocalDiceBackend'
```

**Step 2: In the Scene function, create the local backend**

Near the top of `function Scene()`, after the existing `handleRollClick` callback, add:

```typescript
const localBackend = useLocalDiceBackend(handleRollClick)
```

**Step 3: Replace direct store calls in UI components**

Update `DiceToolbar`'s `onAddDice` prop to use the backend:

```typescript
// Before:
onAddDice={handleAddDice}

// After (handleAddDice is kept for now — it wraps localBackend.addDie plus inventory logic):
onAddDice={handleAddDice}
```

Note: For this task, we keep the existing handler functions in Scene.tsx. The backend is created and provided but the UI components continue using their existing props. Task 8 (multiplayer Scene rendering) will use the backend directly.

**Step 4: Wrap the return JSX in DiceBackendProvider**

Wrap the entire return block:

```typescript
return (
  <DiceBackendProvider value={localBackend}>
    <>
      <Canvas ...>
        {/* ... existing Canvas contents ... */}
      </Canvas>
      {/* ... existing UI overlays ... */}
    </>
  </DiceBackendProvider>
)
```

**Step 5: Verify build and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Build passes, no test regressions

**Step 6: Commit**

```bash
git add src/components/Scene.tsx
git commit -m "feat(scene): wire DiceBackendProvider into Scene

- Create local backend via useLocalDiceBackend
- Wrap Scene in DiceBackendProvider
- No behavior changes — existing handlers still used
- Foundation for multiplayer to share the same Scene"
```

---

## Task 7: Add Multiplayer Rendering Path to Scene.tsx

Add the conditional Canvas rendering: physics mode (local) vs interpolated mode (multiplayer).

**Files:**
- Modify: `src/components/Scene.tsx`

**Step 1: Add multiplayer imports**

```typescript
import { useDiceBackend } from '../contexts/DiceBackendContext'
import { MultiplayerDie } from './multiplayer/MultiplayerDie'
import { useSnapshotInterpolation } from '../hooks/useSnapshotInterpolation'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
```

**Step 2: Create a MultiplayerDiceRenderer component**

Add this inside Scene.tsx (before the Scene function):

```typescript
/**
 * Renders multiplayer dice with interpolation (no physics).
 * Used inside Canvas when mode === 'multiplayer'.
 */
function MultiplayerDiceRenderer() {
  const dice = useMultiplayerStore((s) => s.dice)
  const players = useMultiplayerStore((s) => s.players)
  const tRef = useSnapshotInterpolation()

  const diceArray = Array.from(dice.values())

  return (
    <>
      {diceArray.map((die) => {
        const player = players.get(die.ownerId)
        const color = player?.color || '#ffffff'

        return (
          <MultiplayerDie
            key={die.id}
            diceType={die.diceType}
            color={color}
            targetPosition={die.targetPosition}
            targetRotation={die.targetRotation}
            prevPosition={die.prevPosition}
            prevRotation={die.prevRotation}
            interpolationT={tRef.current}
          />
        )
      })}
    </>
  )
}
```

**Step 3: Create a VisualGround component**

Add a themed visual-only ground (no physics):

```typescript
/**
 * Visual-only ground plane for multiplayer (no physics).
 * Uses theme environment colors.
 */
function VisualGround() {
  const { currentTheme } = useTheme()
  const env = currentTheme.environment

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
      <planeGeometry args={[30, 30]} />
      <meshStandardMaterial
        color={env.floor.color}
        roughness={env.floor.material.roughness}
        metalness={env.floor.material.metalness}
      />
    </mesh>
  )
}
```

**Step 4: Conditional rendering inside Canvas**

In the Scene function, read the mode from context:

```typescript
const backend = useDiceBackend()
const isMultiplayer = backend.mode === 'multiplayer'
```

Replace the `<Physics>` block inside the Canvas with conditional rendering:

```typescript
{isMultiplayer ? (
  <>
    <VisualGround />
    <MultiplayerDiceRenderer />
  </>
) : (
  <Physics gravity={[0, GRAVITY, 0]} timeStep="vary">
    <PhysicsController gravityRef={gravityRef} />
    <ViewportBoundaries />
    {dice.map((die) => {
      // ... existing dice rendering logic (unchanged) ...
    })}
  </Physics>
)}
```

**Step 5: Conditionally hide local-only UI in multiplayer**

Device motion toggle and inventory are local-only for now. Add guards:

```typescript
{/* Motion toggle — local only */}
{!isMultiplayer && (
  <BottomNav
    ...
    onToggleMotion={handleToggleMotion}
    ...
  />
)}
```

For the initial pass, keep BottomNav visible in both modes but disable motion toggle in multiplayer.

**Step 6: Add multiplayer overlays**

Add conditional RoomHeader when in multiplayer mode:

```typescript
import { RoomHeader } from './multiplayer/RoomHeader'
import { PlayerList } from './multiplayer/PlayerList'

// ... inside the return, after Canvas:
{isMultiplayer && backend.multiplayer && (
  <RoomHeader />
)}
```

**Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 8: Commit**

```bash
git add src/components/Scene.tsx
git commit -m "feat(scene): add multiplayer rendering path

- Conditional physics (local) vs interpolated (multiplayer) in Canvas
- VisualGround with themed materials for multiplayer
- MultiplayerDiceRenderer with interpolation
- RoomHeader overlay in multiplayer mode"
```

---

## Task 8: Simplify MultiplayerRoom.tsx

MultiplayerRoom no longer renders its own scene/toolbar/result display. It handles the join flow, then renders Scene with the multiplayer backend.

**Files:**
- Modify: `src/components/multiplayer/MultiplayerRoom.tsx`

**Step 1: Rewrite MultiplayerRoom**

```typescript
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { DiceBackendProvider } from '../../contexts/DiceBackendContext'
import { useDiceStore } from '../../store/useDiceStore'
import Scene from '../Scene'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)

  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState('#8B5CF6')
  const [hasJoined, setHasJoined] = useState(false)

  const multiplayerBackend = useMultiplayerDiceBackend()

  // Clear local dice state when entering multiplayer
  useEffect(() => {
    useDiceStore.getState().reset()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
      useDiceStore.getState().reset()
    }
  }, [disconnect])

  const handleJoin = () => {
    if (!roomId || !displayName.trim()) return
    connect(roomId, displayName.trim(), color)
    setHasJoined(true)
  }

  // Show join form if not connected
  if (!hasJoined || connectionStatus === 'disconnected') {
    return (
      <div style={{
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1rem',
        fontFamily: 'system-ui, sans-serif',
        color: 'white',
        background: '#1a1a2e',
      }}>
        <h1>Join Room</h1>
        <p style={{ opacity: 0.7 }}>Room: {roomId}</p>
        <input
          type="text"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={20}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #444',
            background: '#2a2a3e',
            color: 'white',
            fontSize: '1rem',
            width: '250px',
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ opacity: 0.7 }}>Color:</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: '40px', height: '40px', border: 'none', borderRadius: '8px' }}
          />
        </div>
        <button
          onClick={handleJoin}
          disabled={!displayName.trim()}
          style={{
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            border: 'none',
            background: displayName.trim() ? '#8B5CF6' : '#444',
            color: 'white',
            fontSize: '1rem',
            cursor: displayName.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Join
        </button>
      </div>
    )
  }

  // Show connecting state
  if (connectionStatus === 'connecting') {
    return (
      <div style={{
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        background: '#1a1a2e',
        fontFamily: 'system-ui, sans-serif',
      }}>
        Connecting to room {roomId}...
      </div>
    )
  }

  // Connected — render the unified Scene with multiplayer backend
  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <DiceBackendProvider value={multiplayerBackend}>
        <Scene />
      </DiceBackendProvider>
    </div>
  )
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/multiplayer/MultiplayerRoom.tsx
git commit -m "refactor(multiplayer): simplify MultiplayerRoom to use unified Scene

- Join flow unchanged
- Connected state renders Scene with multiplayer DiceBackendProvider
- No more separate MultiplayerScene/Toolbar/ResultDisplay/History
- Clear useDiceStore on enter/exit multiplayer"
```

---

## Task 9: Update App.tsx Routing

Wrap the multiplayer route in ThemeProvider and DeviceMotionProvider (currently missing).

**Files:**
- Modify: `src/App.tsx`

**Step 1: Update the multiplayer route**

In `src/App.tsx`, the multiplayer route currently renders `<MultiplayerRoom />` without providers. Update it:

```typescript
<Route path="/room/:roomId" element={
  <ThemeProvider>
    <DeviceMotionProvider>
      <MultiplayerRoom />
    </DeviceMotionProvider>
  </ThemeProvider>
} />
```

**Step 2: Update Scene.tsx to handle being inside or outside DiceBackendProvider**

Scene.tsx needs to handle the case where it's rendered standalone (local mode, no provider above it) vs inside a provider (multiplayer mode). Update the Scene function to check:

```typescript
// At the top of Scene function, try to read context
import { useContext } from 'react'

// ... inside Scene():
// Check if we're already inside a DiceBackendProvider (multiplayer)
const existingBackend = useContext(DiceBackendContext)
const localBackend = useLocalDiceBackend(handleRollClick)
const activeBackend = existingBackend || localBackend

// Only wrap in provider if not already wrapped
const content = (
  <>
    <Canvas>...</Canvas>
    {/* UI overlays */}
  </>
)

return existingBackend
  ? content
  : <DiceBackendProvider value={localBackend}>{content}</DiceBackendProvider>
```

Note: This requires exporting `DiceBackendContext` from the context file (for the `useContext` check). Add this export to `src/contexts/DiceBackendContext.tsx`:

```typescript
export { DiceBackendContext }
```

**Step 3: Verify build and manual test**

Run: `npx tsc --noEmit`
Expected: No type errors

Manual test:
- Navigate to `/` → single-player mode works as before
- Navigate to `/room/test-room` → join form appears, themed correctly

**Step 4: Commit**

```bash
git add src/App.tsx src/components/Scene.tsx src/contexts/DiceBackendContext.tsx
git commit -m "feat(routing): wrap multiplayer route in ThemeProvider/DeviceMotionProvider

- Multiplayer now gets themed colors instead of hardcoded values
- Scene detects existing DiceBackendProvider for multiplayer mode
- Local mode auto-wraps itself in local backend provider"
```

---

## Task 10: Update HistoryPanel for Player Attribution

**Files:**
- Modify: `src/components/panels/HistoryPanel.tsx`

**Step 1: Show player info in RollHistoryItem when present**

In the `RollHistoryItem` component, add player display between the header and dice breakdown:

```typescript
function RollHistoryItem({ roll, rollNumber }: RollHistoryItemProps) {
  // ... existing formatTimestamp ...

  return (
    <div
      className="p-4 rounded-lg"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid rgba(251, 146, 60, 0.2)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          {/* Show player name if multiplayer roll */}
          {roll.player ? (
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: roll.player.color }}
              />
              <h4
                className="font-semibold"
                style={{ color: roll.player.color }}
              >
                {roll.player.displayName}
              </h4>
            </div>
          ) : (
            <h4
              className="font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Roll #{rollNumber}
            </h4>
          )}
          <p
            className="text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {formatTimestamp(roll.timestamp)}
          </p>
        </div>
        <div
          className="text-2xl font-bold px-3 py-1 rounded-lg"
          style={{
            backgroundColor: 'rgba(251, 146, 60, 0.2)',
            color: 'var(--color-accent)',
          }}
        >
          {roll.sum}
        </div>
      </div>

      {/* Dice breakdown — unchanged */}
      <div className="space-y-1.5">
        {roll.dice.map((die, idx) => (
          <div
            key={`${die.diceId}-${idx}`}
            className="flex items-center justify-between p-2 rounded"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
          >
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {die.type.toUpperCase()}
            </span>
            <span
              className="text-sm font-bold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {die.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/panels/HistoryPanel.tsx
git commit -m "feat(history): show player attribution for multiplayer rolls

- Display player color dot and name for rolls with player field
- Falls back to 'Roll #N' for local mode rolls
- Same panel used in both modes"
```

---

## Task 11: Delete Dead Multiplayer Files

**Files:**
- Delete: `src/components/multiplayer/MultiplayerScene.tsx`
- Delete: `src/components/multiplayer/MultiplayerResultDisplay.tsx`
- Delete: `src/components/multiplayer/MultiplayerToolbar.tsx`
- Delete: `src/components/multiplayer/RoomRollHistory.tsx`
- Delete: `src/store/useRoomHistoryStore.ts`

**Step 1: Verify no remaining imports**

Search for any remaining references to the files being deleted:

Run: `grep -r "MultiplayerScene\|MultiplayerResultDisplay\|MultiplayerToolbar\|RoomRollHistory\|useRoomHistoryStore" src/ --include="*.ts" --include="*.tsx" -l`

Expected: Only the files being deleted should show up. If any other files reference them, update those imports first.

**Step 2: Delete the files**

```bash
rm src/components/multiplayer/MultiplayerScene.tsx
rm src/components/multiplayer/MultiplayerResultDisplay.tsx
rm src/components/multiplayer/MultiplayerToolbar.tsx
rm src/components/multiplayer/RoomRollHistory.tsx
rm src/store/useRoomHistoryStore.ts
```

**Step 3: Verify build**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Build passes, tests pass (no test files for deleted components)

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove dead multiplayer UI components

- Delete MultiplayerScene (replaced by conditional Scene.tsx)
- Delete MultiplayerResultDisplay (replaced by existing ResultDisplay)
- Delete MultiplayerToolbar (replaced by existing DiceToolbar)
- Delete RoomRollHistory (replaced by existing HistoryPanel)
- Delete useRoomHistoryStore (replaced by useDiceStore.rollHistory)"
```

---

## Task 12: Integration Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: 161+ passing, 3 failing (pre-existing haptic), 16 skipped

**Step 2: Run server tests**

Run: `~/.cargo/bin/cargo test --manifest-path server/Cargo.toml`
Expected: All 66 tests pass

**Step 3: Build check**

Run: `npm run build`
Expected: Clean build, exit code 0

**Step 4: Manual testing checklist**

- [ ] Navigate to `/` — single-player works exactly as before
- [ ] Roll dice, check ResultDisplay shows correctly
- [ ] Open History panel, verify rolls appear
- [ ] Navigate to `/room/test-room` — join form appears with themed styling
- [ ] Join room — Scene renders with themed environment (not hardcoded gray)
- [ ] Spawn dice via toolbar — dice appear in 3D scene
- [ ] Roll dice — dice animate smoothly at 60fps (not 20Hz gliding)
- [ ] Results show in the single-player-style ResultDisplay
- [ ] History panel shows rolls with player names and color dots
- [ ] RoomHeader shows room ID and player list

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for unified UI"
```

---

## Task Summary

| Task | Description | Estimated Steps |
|------|-------------|-----------------|
| 1 | Server snapshot rate | 5 |
| 2 | RollSnapshot player field | 3 |
| 3 | DiceBackendContext + types | 3 |
| 4 | useLocalDiceBackend hook | 3 |
| 5 | useMultiplayerDiceBackend + store wiring | 5 |
| 6 | Wire DiceBackendProvider into Scene | 6 |
| 7 | Multiplayer rendering path in Scene | 8 |
| 8 | Simplify MultiplayerRoom | 3 |
| 9 | App.tsx routing + provider detection | 4 |
| 10 | HistoryPanel player attribution | 3 |
| 11 | Delete dead files | 4 |
| 12 | Integration verification | 5 |

**Total: 12 tasks, ~52 steps**

## Dependencies

```
Task 1 (server) — independent, can be done in parallel with client work
Task 2 → Task 3 → Task 4 → Task 6
Task 3 → Task 5
Task 6 → Task 7 → Task 8 → Task 9
Task 2 → Task 10
Task 9 → Task 11 → Task 12
```

**Critical path:** 3 → 5 → 7 → 8 → 9 → 11 → 12
