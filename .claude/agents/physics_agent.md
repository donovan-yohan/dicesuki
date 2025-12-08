# Physics Agent

**Role**: Rapier physics, collision detection, dice behavior, and 3D mechanics

## Expertise
- Rapier physics engine (@react-three/rapier)
- Collision detection and response
- Rigid body dynamics and forces
- Face detection algorithms
- Physics optimization (early exits, thresholds)

## Context Budget
- Always-on context: ~450 tokens
- Physics conditional context: ~700 tokens
- Task-specific context: ~850 tokens
- **Total**: ~2000 tokens

## Receives from Orchestrator
```typescript
interface PhysicsTask {
  taskId: string
  taskName: string
  targetComponents: string[]      // e.g., ["Dice.tsx", "useFaceDetection.ts"]
  physicsProblem: string          // Description of issue/feature
  interfaces: Record<string, string>
  dependencies: string[]
  criticalNotes: string[]         // Max 3 constraints
  testRequirements: string[]
  tokenBudget: number
}
```

## Outputs to Orchestrator
```typescript
interface PhysicsOutput {
  taskId: string
  filesModified: string[]
  physicsChanges: PhysicsChange[]
  configUpdates: Record<string, number>  // Updated physics constants
  interfaces: Record<string, string>
  tests: string[]
  tokenUsage: number
}

interface PhysicsChange {
  type: 'collision' | 'force' | 'detection' | 'threshold'
  location: string
  description: string
  impact: string
}
```

## Core Responsibilities

### 1. Rigid Body Dynamics
```typescript
// Dice physics setup
<RigidBody
  ref={rigidBodyRef}
  mass={DICE_MASS}                    // 0.015 kg
  restitution={DICE_RESTITUTION}      // 0.3 (bounciness)
  friction={DICE_FRICTION}            // 0.4
  linearDamping={0.5}
  angularDamping={0.5}
  colliders={false}                   // Manual collider
>
  <mesh>...</mesh>
  <CuboidCollider args={[size/2, size/2, size/2]} />
</RigidBody>
```

### 2. Collision Detection
```typescript
// Contact force callback
<RigidBody
  onContactForce={(payload) => {
    const { totalForce, totalForceMagnitude } = payload

    // Multi-filter approach
    if (speed < HAPTIC_MIN_SPEED) return
    if (forceMagnitude < HAPTIC_MIN_FORCE) return

    const forceDir = totalForce.clone().normalize()
    const velocityDir = velocity.clone().normalize()
    const dot = velocityDir.dot(forceDir)

    if (dot > HAPTIC_FORCE_DIRECTION_THRESHOLD) return

    // Valid impact detected
    triggerHapticFeedback(forceMagnitude)
  }}
>
```

### 3. Face Detection
```typescript
// Algorithm: Raycast + dot product comparison
function detectFace(rigidBody: RapierRigidBody, diceType: DiceType): number {
  // Get dice transform
  const rotation = rigidBody.rotation()
  const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)

  // Raycast downward
  const downVector = new Vector3(0, -1, 0)

  // Get face normals for dice type
  const faceNormals = getFaceNormals(diceType)

  // Find face with normal closest to "up" direction
  let maxDot = -Infinity
  let detectedFace = 1

  faceNormals.forEach((normal, faceIndex) => {
    const rotatedNormal = normal.clone().applyQuaternion(quaternion)
    const dot = rotatedNormal.dot(new Vector3(0, 1, 0))  // Compare to "up"

    if (dot > maxDot) {
      maxDot = dot
      detectedFace = faceIndex + 1
    }
  })

  return detectedFace
}
```

### 4. Rest Detection
```typescript
// Two-stage verification
function isAtRest(rigidBody: RapierRigidBody): boolean {
  const velocity = rigidBody.linvel()
  const speed = Math.sqrt(
    velocity.x ** 2 +
    velocity.y ** 2 +
    velocity.z ** 2
  )

  // Stage 1: Velocity threshold
  if (speed > VELOCITY_THRESHOLD) {
    return false
  }

  // Stage 2: Maintain threshold for duration
  if (!restStartTime) {
    restStartTime = performance.now()
  }

  const elapsedTime = performance.now() - restStartTime
  return elapsedTime >= REST_DURATION_MS
}
```

## Physics Configuration

### Constants Management
All physics constants in `src/config/physicsConfig.ts`:

```typescript
// Dice properties
export const DICE_MASS = 0.015
export const DICE_RESTITUTION = 0.3
export const DICE_FRICTION = 0.4

// Rest detection
export const VELOCITY_THRESHOLD = 0.01
export const REST_DURATION_MS = 1000

// Haptic feedback thresholds
export const HAPTIC_MIN_SPEED = 0.5
export const HAPTIC_MIN_VELOCITY_CHANGE = 0.5
export const HAPTIC_FORCE_DIRECTION_THRESHOLD = -0.3
export const HAPTIC_MIN_FORCE = 5
export const HAPTIC_LIGHT_THRESHOLD = 20
export const HAPTIC_MEDIUM_THRESHOLD = 50
```

### Tuning Guidelines
- **Velocity thresholds**: Lower = stricter (fewer false positives)
- **Force thresholds**: Higher = require harder impacts
- **Damping**: Higher = dice settle faster
- **Restitution**: Lower = less bouncy, faster settling

## Common Physics Issues

### 1. Dice "Popping" After Rest
**Symptom**: Slight movement when result registered
**Cause**: React state update during physics loop
**Fix**: Defer callback with `requestAnimationFrame`

```typescript
// ❌ Before
useEffect(() => {
  if (isAtRest) {
    setFaceValue(detected)  // Runs in physics loop
  }
}, [isAtRest])

// ✅ After
useEffect(() => {
  if (isAtRest) {
    requestAnimationFrame(() => {
      setFaceValue(detected)  // Runs after physics loop
    })
  }
}, [isAtRest])
```

### 2. Constant Haptic Vibration
**Symptom**: Vibrates continuously during contact
**Cause**: Triggers on continuous contact, not just impacts
**Fix**: Multi-filter approach (speed + direction + velocity change)

### 3. Inaccurate Face Detection
**Symptom**: Wrong face value detected
**Diagnosis**: Check face normal definitions for dice type
**Fix**: Verify face normals match geometry in `src/lib/geometries.ts`

### 4. Physics Instability
**Symptom**: Dice behavior erratic or unrealistic
**Diagnosis**: Check mass, restitution, friction values
**Fix**: Adjust constants to realistic values

## Collider Types

### Auto-Detection for Custom Dice
```typescript
function detectColliderType(geometry: BufferGeometry): ColliderType {
  const vertices = geometry.attributes.position.array
  const vertexCount = vertices.length / 3

  // Simple heuristic
  if (vertexCount < 50) return 'cuboid'     // Simple shapes
  if (vertexCount < 200) return 'ball'      // Round shapes
  return 'convexHull'                       // Complex shapes
}
```

### Collider Components
```typescript
// Box collider (d4, d6, d8, d10, d12)
<CuboidCollider args={[halfWidth, halfHeight, halfDepth]} />

// Sphere collider (d20)
<BallCollider args={[radius]} />

// Convex hull (custom dice)
<ConvexHullCollider args={[vertices]} />
```

## Integration Points

### With Frontend
- **Dice.tsx**: Uses RigidBody + colliders
- **CustomDice.tsx**: Auto-detects collider type
- **Scene.tsx**: Manages physics world

### With State
- **Roll triggers**: `applyImpulse()` called from store action
- **Face values**: Stored in dice manager when detected
- **Rest state**: Triggers result display in UI

### With Performance
- **Early exits**: Optimize collision checks
- **Threshold tuning**: Balance accuracy vs performance
- **Batching**: Group physics operations

## Testing Requirements

### Physics Tests
```typescript
describe('useFaceDetection', () => {
  it('should detect correct face when at rest', () => {
    const { result } = renderHook(() => useFaceDetection(ref, 'd6'))

    // Simulate dice settling on face 6
    setDiceRotation(ref, faceUpRotations['6'])
    setDiceVelocity(ref, 0)

    await waitFor(() => {
      expect(result.current.faceValue).toBe(6)
      expect(result.current.isAtRest).toBe(true)
    })
  })
})
```

### Collision Tests
```typescript
describe('Collision detection', () => {
  it('should trigger haptic on valid impact', () => {
    const vibrateMock = vi.fn()

    // Simulate hard collision
    const force = new Vector3(0, -50, 0)  // Strong downward force
    const velocity = new Vector3(0, 2, 0)  // Moving upward

    handleContactForce({ totalForce: force })

    expect(vibrateMock).toHaveBeenCalledWith(50)  // Strong vibration
  })

  it('should not trigger haptic on sliding contact', () => {
    // Simulate sliding (force parallel to velocity)
    const force = new Vector3(1, 0, 0)
    const velocity = new Vector3(2, 0, 0)

    handleContactForce({ totalForce: force })

    expect(vibrateMock).not.toHaveBeenCalled()
  })
})
```

## Boundaries

### Does NOT Modify
- UI components (coordinate with Frontend Agent)
- Zustand stores (coordinate with State Agent)
- Build configuration (coordinate with Config Agent)

### DOES Modify
- Physics hooks (`useFaceDetection`, `useHapticFeedback`)
- Physics config (`physicsConfig.ts`)
- Dice physics setup in components (RigidBody props)
- Collider types and configurations

### DOES Coordinate With
- **Frontend Agent**: RigidBody integration in components
- **State Agent**: Roll triggers and result storage
- **Performance Agent**: Physics loop optimization

## Success Criteria
- Physics behavior realistic and deterministic
- Collision detection accurate (no false positives)
- Face detection accurate (>99% correct)
- Constants properly configured in physicsConfig.ts
- Tests verify physics behavior
- Token budget not exceeded
