## Daisu Physics Server

Authoritative physics server for multiplayer dice simulation using Rapier physics engine and Socket.io for real-time communication.

---

## Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure:

```bash
# Server
NODE_ENV=development
PORT=3001

# Supabase (from ../supabase/README.md setup)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Physics (defaults are good for most cases)
PHYSICS_TICK_RATE=60
BROADCAST_TICK_RATE=20

# Room Configuration
MAX_PLAYERS_PER_ROOM=8
MAX_DICE_PER_ROOM=32
```

### 3. Run Development Server

```bash
npm run dev
```

Server will start on http://localhost:3001

### 4. Verify Server is Running

```bash
curl http://localhost:3001/health
```

You should see:
```json
{
  "status": "ok",
  "timestamp": "2025-11-16T...",
  "uptime": 1.234
}
```

---

## Production Build

### Build TypeScript

```bash
npm run build
```

### Run Production Server

```bash
npm start
```

---

## Architecture

### Directory Structure

```
server/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Configuration loading
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   ├── physics/
│   │   ├── PhysicsWorld.ts   # Rapier world manager
│   │   └── DiceSimulator.ts  # Individual dice physics
│   ├── room/
│   │   └── RoomManager.ts    # Room management and lifecycle
│   └── network/
│       ├── SocketServer.ts   # Socket.io server setup
│       └── EventHandlers.ts  # Client event handlers
├── package.json
├── tsconfig.json
└── .env                      # Environment variables (not committed)
```

### Key Components

#### 1. **PhysicsWorld**
- Manages Rapier physics simulation
- Creates boundaries (floor and walls)
- Handles dice lifecycle (add/remove)
- Steps simulation at 60 FPS

#### 2. **DiceSimulator**
- Individual dice physics and state
- Rest detection and face value calculation
- Drag interaction support
- Velocity clamping

#### 3. **RoomManager**
- Creates and manages game rooms
- Integrates with Supabase for persistence
- Handles player joining/leaving
- Room cleanup (idle timeout)

#### 4. **SocketServer**
- WebSocket connection management
- Room-based broadcasting
- Physics state synchronization (20 Hz)
- Player session tracking

#### 5. **EventHandlers**
- Validates client input
- Processes room and dice events
- Enforces ownership rules
- Error handling

---

## Client-Server Communication

### Client → Server Events

```typescript
// Create a room
socket.emit('room:create', {
  playerName: 'Alice',
  playerColor: '#3b82f6',
  password: 'secret123',  // Optional
  maxPlayers: 8
}, (response) => {
  console.log(response.roomCode) // "ABC123"
})

// Join a room
socket.emit('room:join', {
  roomCode: 'ABC123',
  playerName: 'Bob',
  playerColor: '#ec4899',
  password: 'secret123'  // If required
}, (response) => {
  // Joined successfully
})

// Add a dice
socket.emit('dice:add', {
  type: 'd20',
  position: [0, 5, 0],
  rotation: [0, 0, 0, 1]
})

// Apply impulse (roll)
socket.emit('dice:impulse', {
  diceId: 'dice-123',
  impulse: [2, 5, -1],
  torque: [1, -1, 0.5]
})

// Remove a dice
socket.emit('dice:remove', 'dice-123')
```

### Server → Client Events

```typescript
// Room joined confirmation
socket.on('room:joined', (data) => {
  console.log(data.roomCode)     // "ABC123"
  console.log(data.players)      // Array of players
  console.log(data.dice)         // Current dice state
  console.log(data.yourPlayerId) // Your player UUID
})

// Player joined notification
socket.on('room:player_joined', (player) => {
  console.log(`${player.name} joined`)
})

// Player left notification
socket.on('room:player_left', (playerId) => {
  console.log(`Player ${playerId} left`)
})

// Physics state snapshot (20 Hz)
socket.on('physics:snapshot', (snapshot) => {
  console.log(snapshot.tick)      // Server tick number
  console.log(snapshot.timestamp) // Server timestamp
  console.log(snapshot.dice)      // Array of dice states

  snapshot.dice.forEach(dice => {
    console.log(dice.position)        // [x, y, z]
    console.log(dice.rotation)        // [x, y, z, w] quaternion
    console.log(dice.linearVelocity)  // [x, y, z]
    console.log(dice.isAtRest)        // boolean
    console.log(dice.faceValue)       // number | null
  })
})

// Dice added
socket.on('dice:added', (dice) => {
  console.log(`Dice ${dice.id} added by ${dice.ownerId}`)
})

// Dice removed
socket.on('dice:removed', (diceId) => {
  console.log(`Dice ${diceId} removed`)
})

// Error
socket.on('error', (error) => {
  console.error(error.code, error.message)
})
```

---

## Configuration Reference

### Physics Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PHYSICS_TICK_RATE` | `60` | Server simulation rate (FPS) |
| `BROADCAST_TICK_RATE` | `20` | Client update rate (Hz) |

**Tuning:**
- Higher tick rate = more accurate physics, more CPU usage
- Lower broadcast rate = less bandwidth, more client interpolation needed
- Recommended: 60 FPS sim, 20 Hz broadcast

### Room Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PLAYERS_PER_ROOM` | `8` | Maximum players allowed |
| `MAX_DICE_PER_ROOM` | `32` | Total dice limit per room |
| `ROOM_IDLE_TIMEOUT` | `300000` | Idle timeout in ms (5 min) |
| `ROOM_CLEANUP_INTERVAL` | `60000` | Cleanup check interval (1 min) |

### Security Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BCRYPT_ROUNDS` | `10` | Password hashing rounds |
| `MAX_ROOMS_PER_IP` | `3` | Prevent spam (not yet implemented) |

---

## Testing Locally

### Test with Socket.io Client

Create a simple test client:

```javascript
// test-client.js
import { io } from 'socket.io-client'

const socket = io('http://localhost:3001')

socket.on('connect', () => {
  console.log('Connected!')

  // Create a room
  socket.emit('room:create', {
    playerName: 'Test Player',
    playerColor: '#3b82f6'
  }, (response) => {
    console.log('Room created:', response.roomCode)
  })
})

socket.on('room:joined', (data) => {
  console.log('Joined room:', data)

  // Add a dice
  socket.emit('dice:add', { type: 'd20' })
})

socket.on('physics:snapshot', (snapshot) => {
  console.log('Snapshot:', snapshot.tick, 'dice:', snapshot.dice.length)
})

socket.on('dice:added', (dice) => {
  console.log('Dice added:', dice.id)
})
```

Run:
```bash
node test-client.js
```

---

## Deployment

See [../deployment/README.md](../deployment/README.md) for Oracle Cloud deployment instructions.

### Environment Checklist

- [ ] `NODE_ENV=production`
- [ ] `SUPABASE_URL` configured
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configured (keep secret!)
- [ ] `PORT` configured (default: 3001)
- [ ] Firewall allows port `3001` (or your configured port)

### Process Manager (PM2)

Install PM2:
```bash
npm install -g pm2
```

Start server:
```bash
pm2 start dist/index.js --name daisu-physics
pm2 startup  # Auto-restart on reboot
pm2 save
```

Monitor:
```bash
pm2 status
pm2 logs daisu-physics
pm2 monit
```

---

## Performance Monitoring

### Metrics to Watch

1. **Physics Tick Rate**: Should stay at 60 FPS
   - Log with `LOG_PHYSICS_STATS=true`
   - If dropping below 60, reduce `MAX_DICE_PER_ROOM`

2. **Memory Usage**: Should stay under 200MB per room
   - Monitor with `pm2 monit`
   - Each dice: ~1-2 MB

3. **CPU Usage**: Should stay under 50% per core
   - Oracle Cloud Free Tier: 2 ARM cores
   - Target: <25% per core at max capacity

4. **Bandwidth**: ~880 KB/s per room
   - Oracle Free Tier: 10 TB/month (plenty)

### Capacity Planning

With Oracle Cloud Free Tier (2 cores, 12GB RAM):

- **Per Room**: ~80-100 MB RAM, ~20% CPU (1 core)
- **Max Concurrent Rooms**: 10-15 rooms
- **Max Players**: 80-120 players (across all rooms)

---

## Troubleshooting

### Server Won't Start

**Error: "SUPABASE_URL is required"**
- Solution: Configure `.env` file with Supabase credentials

**Error: "Port 3001 already in use"**
- Solution: Change `PORT` in `.env` or kill existing process

### Physics Simulation Issues

**Dice falling through floor**
- Check: `PHYSICS_TICK_RATE` too low (increase to 60)
- Check: `maxDiceVelocity` not exceeded

**Dice not settling**
- Check: `REST_DURATION_MS` in config (default 500ms)
- Check: Velocity thresholds in DiceSimulator

### Connection Issues

**Clients can't connect**
- Check: Server running (`curl http://localhost:3001/health`)
- Check: Firewall allows port 3001
- Check: CORS settings in SocketServer.ts

**High latency**
- Check: `BROADCAST_TICK_RATE` (lower = less bandwidth, more lag)
- Check: Network conditions (ping to server)

---

## Development

### Run Tests

```bash
npm test
```

### Lint Code

```bash
npm run lint
```

### Clean Build

```bash
npm run clean
npm run build
```

---

## Next Steps

After setting up the server:

1. ✅ Server running locally
2. ✅ Supabase connected
3. ⬜ Client-side multiplayer stores (see `../src/store/`)
4. ⬜ Deploy to Oracle Cloud (see `../deployment/`)

---

## Support

For issues or questions:
- Check logs: `pm2 logs daisu-physics`
- Health check: `curl http://localhost:3001/health`
- Review server console output for errors
