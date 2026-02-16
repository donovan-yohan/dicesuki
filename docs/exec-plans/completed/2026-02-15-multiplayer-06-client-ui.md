# Multiplayer 06: Client UI

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the multiplayer UI components — room header, player list, dice toolbar, roll button, result display, and roll history.

**Architecture:** Multiplayer UI lives in `src/components/multiplayer/`. Components read from `useMultiplayerStore` and `useRoomHistoryStore`. Actions dispatch messages to the server via `sendMessage()`. The UI layout mirrors single-player but with multiplayer-specific additions (player list, room-wide roll history).

**Tech Stack:** React 19, Zustand, framer-motion (for animations)

**Depends on:** Plan 04 (Client Foundation), Plan 05 (Client Scene)

---

## Task 1: Room Header & Player List

**Files:**
- Create: `src/components/multiplayer/RoomHeader.tsx`
- Create: `src/components/multiplayer/PlayerList.tsx`

**Step 1: Write RoomHeader component**

Create `src/components/multiplayer/RoomHeader.tsx`:

```tsx
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { PlayerList } from './PlayerList'

export function RoomHeader() {
  const roomId = useMultiplayerStore((s) => s.roomId)
  const players = useMultiplayerStore((s) => s.players)

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.75rem 1rem',
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(8px)',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>Room</span>
        <code style={{
          background: 'rgba(255,255,255,0.1)',
          padding: '0.25rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.85rem',
          letterSpacing: '0.05em',
        }}>
          {roomId}
        </code>
      </div>

      <PlayerList players={Array.from(players.values())} />

      <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>
        {players.size}/8
      </div>
    </div>
  )
}
```

**Step 2: Write PlayerList component**

Create `src/components/multiplayer/PlayerList.tsx`:

```tsx
import type { PlayerInfo } from '../../lib/multiplayerMessages'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

interface PlayerListProps {
  players: PlayerInfo[]
}

export function PlayerList({ players }: PlayerListProps) {
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)

  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      alignItems: 'center',
    }}>
      {players.map((player) => (
        <div
          key={player.id}
          title={player.displayName}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: player.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            color: 'white',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            border: player.id === localPlayerId
              ? '2px solid white'
              : '2px solid transparent',
          }}
        >
          {player.displayName.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add src/components/multiplayer/RoomHeader.tsx src/components/multiplayer/PlayerList.tsx
git commit -m "feat(multiplayer): add RoomHeader and PlayerList components"
```

---

## Task 2: Multiplayer Dice Toolbar

**Files:**
- Create: `src/components/multiplayer/MultiplayerToolbar.tsx`

**Step 1: Write toolbar component**

Create `src/components/multiplayer/MultiplayerToolbar.tsx`:

```tsx
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import type { DiceShape } from '../../lib/geometries'

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

export function MultiplayerToolbar() {
  const spawnDice = useMultiplayerStore((s) => s.spawnDice)
  const removeDice = useMultiplayerStore((s) => s.removeDice)
  const roll = useMultiplayerStore((s) => s.roll)
  const dice = useMultiplayerStore((s) => s.dice)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)

  // Count this player's dice on the table
  const myDiceCount = Array.from(dice.values())
    .filter((d) => d.ownerId === localPlayerId).length

  // Total dice on table
  const totalDiceCount = dice.size

  // Check if any of my dice are rolling
  const isRolling = Array.from(dice.values())
    .some((d) => d.ownerId === localPlayerId && d.isRolling)

  const handleClearMyDice = () => {
    const myDiceIds = Array.from(dice.values())
      .filter((d) => d.ownerId === localPlayerId)
      .map((d) => d.id)
    if (myDiceIds.length > 0) {
      removeDice(myDiceIds)
    }
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.75rem',
      padding: '1rem',
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(8px)',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Dice type buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {DICE_TYPES.map((type) => {
          const disabled = totalDiceCount >= 30
          return (
            <button
              key={type}
              onClick={() => spawnDice(type)}
              disabled={disabled}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                color: disabled ? 'rgba(255,255,255,0.3)' : 'white',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                fontWeight: 'bold',
                textTransform: 'uppercase',
              }}
            >
              {type}
            </button>
          )
        })}
      </div>

      {/* Roll + Clear buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          onClick={handleClearMyDice}
          disabled={myDiceCount === 0}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)',
            color: myDiceCount === 0 ? 'rgba(255,255,255,0.3)' : 'white',
            cursor: myDiceCount === 0 ? 'not-allowed' : 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Clear ({myDiceCount})
        </button>

        <button
          onClick={roll}
          disabled={myDiceCount === 0 || isRolling}
          style={{
            padding: '0.75rem 2.5rem',
            borderRadius: '12px',
            border: 'none',
            background: myDiceCount === 0 || isRolling
              ? 'rgba(139, 92, 246, 0.3)'
              : '#8B5CF6',
            color: 'white',
            cursor: myDiceCount === 0 || isRolling ? 'not-allowed' : 'pointer',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            letterSpacing: '0.1em',
          }}
        >
          {isRolling ? 'ROLLING...' : 'ROLL'}
        </button>

        <div style={{
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.5)',
          minWidth: '80px',
          textAlign: 'center',
        }}>
          {totalDiceCount}/30 dice
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/multiplayer/MultiplayerToolbar.tsx
git commit -m "feat(multiplayer): add MultiplayerToolbar with spawn/roll/clear actions"
```

---

## Task 3: Room Roll History

**Files:**
- Create: `src/components/multiplayer/RoomRollHistory.tsx`

**Step 1: Write roll history component**

Create `src/components/multiplayer/RoomRollHistory.tsx`:

```tsx
import { useRoomHistoryStore, type RoomRollEntry } from '../../store/useRoomHistoryStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

function RollEntry({ entry }: { entry: RoomRollEntry }) {
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const isLocal = entry.playerId === localPlayerId

  const diceStr = entry.results
    .map((r) => `${r.faceValue}`)
    .join(' + ')

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.4rem 0',
      fontSize: '0.8rem',
      opacity: isLocal ? 1 : 0.8,
    }}>
      {/* Player color dot */}
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: entry.color,
        flexShrink: 0,
      }} />

      {/* Player name */}
      <span style={{
        fontWeight: isLocal ? 'bold' : 'normal',
        color: entry.color,
        minWidth: '60px',
      }}>
        {entry.displayName}
      </span>

      {/* Dice results */}
      <span style={{ color: 'rgba(255,255,255,0.6)' }}>
        {diceStr}
      </span>

      {/* Total */}
      <span style={{
        fontWeight: 'bold',
        color: 'white',
        marginLeft: 'auto',
      }}>
        = {entry.total}
      </span>
    </div>
  )
}

export function RoomRollHistory() {
  const rolls = useRoomHistoryStore((s) => s.rolls)

  if (rolls.length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      right: '1rem',
      top: '60px', // Below room header
      bottom: '120px', // Above toolbar
      width: '250px',
      overflowY: 'auto',
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(4px)',
      borderRadius: '8px',
      padding: '0.75rem',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
    }}>
      <div style={{
        fontSize: '0.7rem',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        opacity: 0.5,
        marginBottom: '0.5rem',
      }}>
        Roll History
      </div>
      {rolls.map((entry) => (
        <RollEntry key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
```

**Step 2: Wire roll_complete to history store**

In `src/store/useMultiplayerStore.ts`, update the `roll_complete` handler to add to history:

```typescript
// In handleServerMessage, case 'roll_complete':
case 'roll_complete': {
  const { players } = get()
  const player = players.get(msg.playerId)
  if (player) {
    useRoomHistoryStore.getState().addRoll({
      id: `roll-${Date.now()}-${msg.playerId}`,
      playerId: msg.playerId,
      displayName: player.displayName,
      color: player.color,
      results: msg.results,
      total: msg.total,
      timestamp: Date.now(),
    })
  }
  break
}
```

Add import at top of useMultiplayerStore:
```typescript
import { useRoomHistoryStore } from './useRoomHistoryStore'
```

**Step 3: Commit**

```bash
git add src/components/multiplayer/RoomRollHistory.tsx src/store/useMultiplayerStore.ts
git commit -m "feat(multiplayer): add RoomRollHistory component with roll_complete integration"
```

---

## Task 4: Multiplayer Result Display

**Files:**
- Create: `src/components/multiplayer/MultiplayerResultDisplay.tsx`

**Step 1: Write result display**

This shows the current roll results for the local player prominently, and smaller results for other players who are currently rolling.

Create `src/components/multiplayer/MultiplayerResultDisplay.tsx`:

```tsx
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

export function MultiplayerResultDisplay() {
  const dice = useMultiplayerStore((s) => s.dice)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const players = useMultiplayerStore((s) => s.players)

  // Group dice by owner
  const diceByOwner = new Map<string, typeof diceArray>()
  const diceArray = Array.from(dice.values())
  for (const die of diceArray) {
    const existing = diceByOwner.get(die.ownerId) || []
    existing.push(die)
    diceByOwner.set(die.ownerId, existing)
  }

  // Get local player results
  const myDice = diceByOwner.get(localPlayerId || '') || []
  const mySettled = myDice.filter((d) => d.faceValue !== null)
  const myRolling = myDice.some((d) => d.isRolling)
  const myTotal = mySettled.reduce((sum, d) => sum + (d.faceValue || 0), 0)

  if (myDice.length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      left: '1rem',
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
    }}>
      {/* Local player result */}
      {myDice.length > 0 && (
        <div style={{
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(8px)',
          borderRadius: '12px',
          padding: '1rem',
          textAlign: 'center',
          minWidth: '80px',
        }}>
          <div style={{
            fontSize: '2.5rem',
            fontWeight: 'bold',
            lineHeight: 1,
          }}>
            {myRolling ? '?' : myTotal}
          </div>
          {!myRolling && mySettled.length > 1 && (
            <div style={{
              fontSize: '0.8rem',
              opacity: 0.6,
              marginTop: '0.25rem',
            }}>
              {mySettled.map((d) => d.faceValue).join(' + ')}
            </div>
          )}
          {myRolling && (
            <div style={{
              fontSize: '0.7rem',
              opacity: 0.5,
              marginTop: '0.25rem',
            }}>
              Rolling...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/multiplayer/MultiplayerResultDisplay.tsx
git commit -m "feat(multiplayer): add MultiplayerResultDisplay for local player roll results"
```

---

## Task 5: Assemble Full Multiplayer UI

**Files:**
- Modify: `src/components/multiplayer/MultiplayerRoom.tsx`

**Step 1: Integrate all UI components into MultiplayerRoom**

Update the "Connected" section of `MultiplayerRoom.tsx` to include all components:

```tsx
// Add imports
import { RoomHeader } from './RoomHeader'
import { MultiplayerToolbar } from './MultiplayerToolbar'
import { RoomRollHistory } from './RoomRollHistory'
import { MultiplayerResultDisplay } from './MultiplayerResultDisplay'

// Replace the connected return block with:
return (
  <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
    {/* 3D Scene */}
    <MultiplayerScene />

    {/* UI Overlay */}
    <RoomHeader />
    <MultiplayerResultDisplay />
    <RoomRollHistory />
    <MultiplayerToolbar />
  </div>
)
```

**Step 2: Verify layout**

```bash
npm run dev
# Open http://localhost:3000/room/test123
# Enter name → should see:
# - Room header at top with room ID and player avatar
# - 3D scene in center
# - Roll history panel on right
# - Dice toolbar and roll button at bottom
```

**Step 3: Commit**

```bash
git add src/components/multiplayer/MultiplayerRoom.tsx
git commit -m "feat(multiplayer): assemble full multiplayer UI with header, toolbar, history, and results"
```

---

## Task 6: Room Creation Flow (Home Screen)

**Files:**
- Create: `src/components/multiplayer/CreateRoomButton.tsx`

**Step 1: Write room creation component**

This button will be added to the home screen (single-player mode). It calls the server API to create a room, then navigates to it.

Create `src/components/multiplayer/CreateRoomButton.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SERVER_URL = import.meta.env.VITE_MULTIPLAYER_SERVER_URL?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://localhost:8080'

export function CreateRoomButton() {
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)

  const handleCreateRoom = async () => {
    setIsCreating(true)
    try {
      const response = await fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error('Failed to create room')
      }
      const data = await response.json()
      navigate(`/room/${data.roomId}`)
    } catch (error) {
      console.error('Failed to create room:', error)
      alert('Failed to create multiplayer room. Is the server running?')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <button
      onClick={handleCreateRoom}
      disabled={isCreating}
      style={{
        padding: '0.75rem 1.5rem',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(139, 92, 246, 0.2)',
        color: 'white',
        cursor: isCreating ? 'wait' : 'pointer',
        fontSize: '0.9rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {isCreating ? 'Creating...' : 'Create Multiplayer Room'}
    </button>
  )
}
```

**Step 2: Add to single-player UI**

The exact placement depends on the existing UI layout. During execution, find an appropriate location (e.g., settings panel, bottom nav, or a new menu). For MVP, adding it to the settings panel or as a floating button is sufficient.

**Step 3: Commit**

```bash
git add src/components/multiplayer/CreateRoomButton.tsx
git commit -m "feat(multiplayer): add CreateRoomButton for room creation from home screen"
```
