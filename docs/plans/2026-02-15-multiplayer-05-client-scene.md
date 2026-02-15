# Multiplayer 05: Client Multiplayer Scene

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the multiplayer 3D scene — rendering dice from server state with smooth interpolation, no client-side physics.

**Architecture:** `MultiplayerScene` replaces the single-player `Scene` for multiplayer mode. It renders a R3F `<Canvas>` without `<Physics>`. Each die is a `<MultiplayerDie>` — a positioned mesh driven by server snapshots. A `useSnapshotInterpolation` hook lerps/slerps between 20Hz snapshots for smooth 60fps rendering.

**Tech Stack:** React Three Fiber, Three.js (Quaternion lerp/slerp), Zustand

**Depends on:** Plan 04 (Client Foundation)

---

## Task 1: MultiplayerDie Component

**Files:**
- Create: `src/components/multiplayer/MultiplayerDie.tsx`

**Step 1: Write the multiplayer die component**

This is a purely visual component — no physics, no RigidBody. It receives position and rotation from the server and renders a mesh.

Create `src/components/multiplayer/MultiplayerDie.tsx`:

```tsx
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { DiceShape } from '../../lib/geometries'
import { createDiceGeometry } from '../../lib/geometries'

interface MultiplayerDieProps {
  id: string
  diceType: DiceShape
  color: string
  // Server-driven state
  targetPosition: [number, number, number]
  targetRotation: [number, number, number, number] // quaternion [x, y, z, w]
  prevPosition: [number, number, number]
  prevRotation: [number, number, number, number]
  interpolationT: number // 0-1, how far between prev and target
  isRolling: boolean
  faceValue: number | null
}

export function MultiplayerDie({
  diceType,
  color,
  targetPosition,
  targetRotation,
  prevPosition,
  prevRotation,
  interpolationT,
}: MultiplayerDieProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  // Memoize geometry creation
  const geometry = useMemo(() => createDiceGeometry(diceType), [diceType])

  // Reusable quaternion objects (avoid allocation in render loop)
  const prevQuat = useMemo(() => new THREE.Quaternion(), [])
  const targetQuat = useMemo(() => new THREE.Quaternion(), [])
  const interpQuat = useMemo(() => new THREE.Quaternion(), [])
  const interpPos = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    if (!meshRef.current) return

    // Interpolate position (lerp)
    interpPos.set(prevPosition[0], prevPosition[1], prevPosition[2])
    interpPos.lerp(
      new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2]),
      interpolationT,
    )
    meshRef.current.position.copy(interpPos)

    // Interpolate rotation (slerp)
    prevQuat.set(prevRotation[0], prevRotation[1], prevRotation[2], prevRotation[3])
    targetQuat.set(targetRotation[0], targetRotation[1], targetRotation[2], targetRotation[3])
    interpQuat.slerpQuaternions(prevQuat, targetQuat, interpolationT)
    meshRef.current.quaternion.copy(interpQuat)
  })

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial color={color} />
    </mesh>
  )
}
```

**Note:** The `createDiceGeometry` function needs to exist. If the current codebase creates geometry inline in the Dice component, we may need to extract it. Check `src/lib/geometries.ts` during execution — if it already exports a geometry factory, use that. If not, extract the geometry creation from `Dice.tsx` into a shared utility.

**Step 2: Commit**

```bash
git add src/components/multiplayer/MultiplayerDie.tsx
git commit -m "feat(multiplayer): add MultiplayerDie component with interpolated rendering"
```

---

## Task 2: Snapshot Interpolation Hook

**Files:**
- Create: `src/hooks/useSnapshotInterpolation.ts`

**Step 1: Write interpolation hook with tests**

Create `src/hooks/useSnapshotInterpolation.ts`:

```typescript
import { useRef, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

/**
 * Manages interpolation timing between physics snapshots.
 *
 * Server sends snapshots at 20Hz (every 50ms).
 * Client renders at 60fps (every 16.7ms).
 * We interpolate between the two most recent snapshots for smooth motion.
 *
 * Returns `t` (0 to 1): how far between prev snapshot and target snapshot.
 * t=0 means render at prev position, t=1 means render at target position.
 */
export function useSnapshotInterpolation() {
  const lastSnapshotTime = useMultiplayerStore((s) => s.lastSnapshotTime)
  const snapshotInterval = useMultiplayerStore((s) => s.snapshotInterval)
  const tRef = useRef(0)

  useFrame(() => {
    const now = performance.now()
    const elapsed = now - lastSnapshotTime

    // Clamp t to [0, 1] — don't extrapolate beyond the target
    tRef.current = Math.min(elapsed / snapshotInterval, 1.0)
  })

  return tRef
}
```

**Step 2: Write test**

Create `src/hooks/useSnapshotInterpolation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('useSnapshotInterpolation', () => {
  it('should be importable', async () => {
    // This hook uses useFrame which requires R3F context
    // Just verify the module exports correctly
    const mod = await import('./useSnapshotInterpolation')
    expect(mod.useSnapshotInterpolation).toBeDefined()
  })
})
```

**Step 3: Run tests**

```bash
npm test -- useSnapshotInterpolation.test.ts
```

**Step 4: Commit**

```bash
git add src/hooks/useSnapshotInterpolation.ts src/hooks/useSnapshotInterpolation.test.ts
git commit -m "feat(multiplayer): add snapshot interpolation hook for smooth 60fps rendering"
```

---

## Task 3: MultiplayerScene Component

**Files:**
- Create: `src/components/multiplayer/MultiplayerScene.tsx`

**Step 1: Write the multiplayer scene**

Create `src/components/multiplayer/MultiplayerScene.tsx`:

```tsx
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { MultiplayerDie } from './MultiplayerDie'
import { useSnapshotInterpolation } from '../../hooks/useSnapshotInterpolation'

/** Visual-only ground plane (no physics) */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
      <planeGeometry args={[20, 12]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

/** Renders all dice from multiplayer store with interpolation */
function DiceRenderer() {
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
            id={die.id}
            diceType={die.diceType}
            color={color}
            targetPosition={die.targetPosition}
            targetRotation={die.targetRotation}
            prevPosition={die.prevPosition}
            prevRotation={die.prevRotation}
            interpolationT={tRef.current}
            isRolling={die.isRolling}
            faceValue={die.faceValue}
          />
        )
      })}
    </>
  )
}

export function MultiplayerScene() {
  return (
    <Canvas
      shadows
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
      camera={{
        position: [0, 15, 0],
        fov: 40,
        near: 0.1,
        far: 100,
      }}
      style={{
        touchAction: 'none',
        width: '100%',
        height: '100%',
        display: 'block',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    >
      {/* Lighting — matches single-player setup */}
      <ambientLight intensity={0.6} color="#999999" />
      <directionalLight
        position={[5, 10, 5]}
        intensity={0.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <Environment preset="night" />

      {/* Visual ground (no physics) */}
      <Ground />

      {/* Dice driven by server state */}
      <DiceRenderer />
    </Canvas>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/multiplayer/MultiplayerScene.tsx
git commit -m "feat(multiplayer): add MultiplayerScene with server-driven dice rendering"
```

---

## Task 4: Integrate Scene into MultiplayerRoom

**Files:**
- Modify: `src/components/multiplayer/MultiplayerRoom.tsx`

**Step 1: Update MultiplayerRoom to use the scene**

Replace the placeholder content in `MultiplayerRoom.tsx`:

```tsx
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { MultiplayerScene } from './MultiplayerScene'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)
  const players = useMultiplayerStore((s) => s.players)

  // Join flow state (will be replaced by RoomJoinFlow component in Plan 06)
  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState('#8B5CF6')
  const [hasJoined, setHasJoined] = useState(false)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
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

  // Connected — show the multiplayer scene
  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative' }}>
      <MultiplayerScene />

      {/* Temporary debug overlay — will be replaced by proper UI in Plan 06 */}
      <div style={{
        position: 'absolute',
        top: '1rem',
        left: '1rem',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        background: 'rgba(0,0,0,0.5)',
        padding: '0.5rem',
        borderRadius: '8px',
      }}>
        <div>Room: {roomId}</div>
        <div>Players: {players.size}</div>
        <div>Status: {connectionStatus}</div>
      </div>
    </div>
  )
}
```

**Step 2: Verify it renders**

```bash
npm run dev
# Open http://localhost:3000/room/test123
# Should see join form, then 3D scene after entering name
# (Won't connect to server yet — that's Plan 07)
```

**Step 3: Commit**

```bash
git add src/components/multiplayer/MultiplayerRoom.tsx
git commit -m "feat(multiplayer): integrate MultiplayerScene with join flow into room component"
```

---

## Notes

### Geometry Extraction

The `MultiplayerDie` component needs a `createDiceGeometry(diceType)` function. During execution, check if this already exists in `src/lib/geometries.ts`. If geometry creation is currently inline in `Dice.tsx`, extract it into a shared function:

```typescript
// src/lib/geometries.ts — add if not present
export function createDiceGeometry(shape: DiceShape, size: number = 1): THREE.BufferGeometry {
  switch (shape) {
    case 'd4': return new THREE.TetrahedronGeometry(size)
    case 'd6': return new THREE.BoxGeometry(size, size, size)
    case 'd8': return new THREE.OctahedronGeometry(size)
    case 'd10': return createD10Geometry(size)
    case 'd12': return new THREE.DodecahedronGeometry(size)
    case 'd20': return new THREE.IcosahedronGeometry(size)
  }
}
```

### Camera Matching

The multiplayer scene camera settings MUST match single-player:
- Position: `[0, 15, 0]` (top-down)
- FOV: `40`
- Looking down at the table

This ensures the server's physics world bounds (set in Plan 02) align with what clients see.

### Performance

Since MultiplayerDie has no physics overhead (no RigidBody, no collision detection), it should be significantly lighter than the single-player Dice component. The main cost is the `useFrame` callback for interpolation — with 30 dice this is ~30 lerp+slerp operations per frame, which is trivial.
