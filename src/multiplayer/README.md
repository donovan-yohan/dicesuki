# Client-Side Multiplayer

This directory contains the client-side multiplayer infrastructure for connecting to the physics server.

---

## Quick Setup

### 1. Install Dependencies

```bash
npm install
```

This will install `@supabase/supabase-js` and `socket.io-client` which were added to `package.json`.

### 2. Configure Environment

Create `.env.local` in the **root** of the project:

```bash
# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...

# Physics Server
VITE_PHYSICS_SERVER_URL=http://localhost:3001
```

**Important:**
- `VITE_` prefix is required for Vite to expose these to the client
- In production, `VITE_PHYSICS_SERVER_URL` should point to your deployed server

### 3. Usage in Components

```typescript
import { useMultiplayer } from '../multiplayer/useMultiplayer'

function MyComponent() {
  const {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    createRoom,
    joinRoom,
  } = useMultiplayer()

  const handleCreateRoom = async () => {
    // Connect to server
    connect()

    // Create room
    const roomCode = await createRoom(
      'Alice',           // Player name
      '#3b82f6',        // Player color
      'password123',    // Optional password
      8                 // Max players
    )

    console.log('Room code:', roomCode) // "ABC123"
  }

  const handleJoinRoom = async () => {
    // Connect to server
    connect()

    // Join room
    const success = await joinRoom(
      'ABC123',         // Room code
      'Bob',            // Player name
      '#ec4899',        // Player color
      'password123'     // Password (if required)
    )

    if (success) {
      console.log('Joined successfully!')
    }
  }

  return (
    <div>
      <button onClick={handleCreateRoom}>Create Room</button>
      <button onClick={handleJoinRoom}>Join Room</button>
      <button onClick={disconnect}>Leave Room</button>

      <p>Status: {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}</p>
    </div>
  )
}
```

---

## Architecture

### Files

- **`SocketManager.ts`**: Singleton class managing Socket.io connection
- **`useMultiplayer.ts`**: React hook wrapping SocketManager with Zustand state
- **`../store/useMultiplayerStore.ts`**: Zustand store for multiplayer state
- **`../lib/supabase.ts`**: Supabase client setup

### Data Flow

```
┌─────────────┐          ┌──────────────┐          ┌─────────────┐
│  Component  │ ────────>│ useMultiplayer│────────>│SocketManager│
│             │          │    (hook)     │          │  (singleton)│
└─────────────┘          └──────────────┘          └─────────────┘
      │                         │                         │
      │                         v                         v
      │                  ┌──────────────┐          ┌─────────────┐
      └─────────────────>│ Multiplayer  │          │   Physics   │
                         │    Store     │          │   Server    │
                         └──────────────┘          └─────────────┘
```

---

## Multiplayer Store

### State

```typescript
{
  // Connection
  isConnected: boolean
  isConnecting: boolean
  connectionError: string | null

  // Room
  roomCode: string | null  // "ABC123"
  roomId: string | null    // UUID
  room: RoomState | null

  // Player
  playerId: string | null
  playerName: string | null
  playerColor: string | null

  // Mode
  isMultiplayer: boolean
}
```

### Usage

```typescript
import { useMultiplayerStore } from '../store/useMultiplayerStore'

function Component() {
  const isMultiplayer = useMultiplayerStore(state => state.isMultiplayer)
  const room = useMultiplayerStore(state => state.room)
  const players = room?.players || []

  return (
    <div>
      {isMultiplayer && (
        <div>
          <p>Room: {room?.code}</p>
          <p>Players: {players.length}/{room?.maxPlayers}</p>
          <ul>
            {players.map(p => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

---

## Socket Events

### Outgoing (Client → Server)

```typescript
// Room management
socket.emit('room:create', { playerName, playerColor, password, maxPlayers }, callback)
socket.emit('room:join', { roomCode, playerName, playerColor, password }, callback)
socket.emit('room:leave')

// Dice actions
socket.emit('dice:add', { type: 'd20', position, rotation })
socket.emit('dice:remove', diceId)
socket.emit('dice:impulse', { diceId, impulse, torque })
socket.emit('dice:drag', { diceId, targetPosition })
```

### Incoming (Server → Client)

```typescript
// Room events
socket.on('room:joined', (data) => { /* Joined room successfully */ })
socket.on('room:player_joined', (player) => { /* New player joined */ })
socket.on('room:player_left', (playerId) => { /* Player left */ })
socket.on('room:closed', (reason) => { /* Room closed */ })

// Physics events
socket.on('physics:snapshot', (snapshot) => {
  // Update all dice positions (20 Hz)
  snapshot.dice.forEach(dice => {
    // dice.position, dice.rotation, dice.velocity, etc.
  })
})

socket.on('dice:added', (dice) => { /* Dice added to room */ })
socket.on('dice:removed', (diceId) => { /* Dice removed */ })

// Errors
socket.on('error', (error) => {
  console.error(error.code, error.message)
})
```

---

## Integration with Dice Manager

### Current Behavior (Single Player)

```typescript
// src/store/useDiceManagerStore.ts
const addDice = (type: DiceShape) => {
  const dice = {
    id: `dice-${Date.now()}`,
    type,
    position: getRandomPosition(),
    rotation: getRandomRotation(),
    color: getColorForType(type),
  }

  set(state => ({ dice: [...state.dice, dice] }))
}
```

### Future Behavior (Multiplayer)

```typescript
const addDice = (type: DiceShape) => {
  const isMultiplayer = useMultiplayerStore.getState().isMultiplayer

  if (isMultiplayer) {
    // Send to server (server creates dice)
    SocketManager.addDice(type)
  } else {
    // Local only (current behavior)
    const dice = { /* ... */ }
    set(state => ({ dice: [...state.dice, dice] }))
  }
}
```

Listen for server dice:

```typescript
socket.on('dice:added', (serverDice) => {
  // Add to local dice manager
  useDiceManagerStore.getState().dice.push({
    id: serverDice.id,
    type: serverDice.type,
    position: serverDice.position,
    rotation: serverDice.rotation,
    color: serverDice.color,
  })
})
```

---

## Next Steps (TODO)

### Phase 1: Basic Multiplayer (MVP)
- [ ] Create room UI (modal/panel)
- [ ] Join room UI (code input)
- [ ] Player list display
- [ ] Integrate with DiceManager (sync dice add/remove)
- [ ] Disable device motion in multiplayer mode

### Phase 2: Physics Sync
- [ ] Client-side prediction for local dice
- [ ] Interpolation for remote dice
- [ ] Reconciliation (correct prediction errors)
- [ ] Handle dice ownership (only roll your own dice)

### Phase 3: UI Polish
- [ ] Room code sharing (copy to clipboard)
- [ ] Password protection UI
- [ ] Connection status indicator
- [ ] Error toasts/notifications
- [ ] Loading states

### Phase 4: Advanced Features
- [ ] Reconnection logic (rejoin room after disconnect)
- [ ] Spectator mode
- [ ] Chat system (using Supabase Realtime)
- [ ] Room settings (max dice per player, etc.)

---

## Testing

### Local Testing (2 Browser Windows)

1. Start physics server:
   ```bash
   cd server
   npm run dev
   ```

2. Start client:
   ```bash
   npm run dev
   ```

3. Open two browser windows:
   - Window 1: Create room
   - Window 2: Join room with code
   - Add dice in each window
   - Verify they appear in both windows

### Network Testing

Use Chrome DevTools Network Throttling:
- **Good 3G**: Simulates mobile connection
- **Slow 3G**: Simulates poor connection
- **Offline**: Test disconnection handling

---

## Troubleshooting

### "Cannot connect to server"

- Check: Is physics server running? (`curl http://localhost:3001/health`)
- Check: Is `VITE_PHYSICS_SERVER_URL` correct in `.env.local`?
- Check: CORS enabled on server? (SocketServer.ts)

### "Dice positions not syncing"

- Check: Are physics snapshots being received? (Console log in `physics:snapshot` handler)
- Check: Is `updateDicePosition` being called?
- Check: Server tick rate (should be 60 FPS, broadcast 20 Hz)

### "Room code not found"

- Check: Room created successfully? (Check server logs)
- Check: Room expired? (24-hour TTL)
- Check: Supabase connection? (Check `rooms` table)

---

## Production Checklist

Before deploying multiplayer:

- [ ] Set `VITE_PHYSICS_SERVER_URL` to production server URL
- [ ] Set `VITE_SUPABASE_URL` to production Supabase project
- [ ] Update Socket.io CORS to only allow your domain
- [ ] Enable SSL/TLS for WebSocket connections (wss://)
- [ ] Test with high latency (200-500ms)
- [ ] Load test with 8 players, 32 dice
- [ ] Monitor bandwidth usage

---

## Resources

- [Socket.io Client Docs](https://socket.io/docs/v4/client-api/)
- [Supabase JS Client](https://supabase.com/docs/reference/javascript/introduction)
- [Zustand Docs](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [Server Documentation](../../server/README.md)
