# Physics Context (500-800 tokens)

## Physics Engine
- **Rapier** via `@react-three/rapier`
- Deterministic simulation
- 60 FPS physics loop
- Rust-based for performance

## Key Hooks

### useFaceDetection
**Purpose**: Detects which dice face is pointing up when at rest

**Logic**:
- Checks velocity < `VELOCITY_THRESHOLD` (0.01 m/s)
- Maintains rest state for `REST_DURATION_MS` (1000ms)
- Raycasts downward to find normal vector
- Compares normal to face normals via dot product
- Returns face value (1-20 depending on dice type)

**Usage**:
```typescript
const { faceValue, isAtRest } = useFaceDetection(rigidBodyRef, diceType)
```

### useHapticFeedback
**Purpose**: Triggers vibration on dice collisions

**Multi-Filter Approach**:
1. Speed filter: dice moving > `HAPTIC_MIN_SPEED` (0.5 m/s)
2. Direction filter: force opposes velocity (dot < -0.3)
3. Velocity change: deceleration > `HAPTIC_MIN_VELOCITY_CHANGE` (0.5)
4. Force magnitude: maps to vibration intensity

**Patterns**:
- Light: 10ms (force 5-20)
- Medium: 30ms (force 20-50)
- Strong: 50ms (force >50)

**Throttling**: Max 1 vibration per 50ms

## Config Constants
**All in**: `src/config/physicsConfig.ts`

### Collision Thresholds
```typescript
HAPTIC_MIN_SPEED = 0.5                    // m/s
HAPTIC_MIN_VELOCITY_CHANGE = 0.5          // m/s
HAPTIC_FORCE_DIRECTION_THRESHOLD = -0.3   // dot product
HAPTIC_MIN_FORCE = 5
HAPTIC_LIGHT_THRESHOLD = 20
HAPTIC_MEDIUM_THRESHOLD = 50
```

### Rest Detection
```typescript
VELOCITY_THRESHOLD = 0.01        // m/s for "at rest"
REST_DURATION_MS = 1000          // Settling time
```

### Dice Properties
```typescript
DICE_MASS = 0.015               // kg (standard die)
DICE_RESTITUTION = 0.3          // Bounciness
DICE_FRICTION = 0.4             // Surface friction
```

## Physics Components

### RigidBody
- Wraps dice mesh for physics simulation
- Props: `mass`, `restitution`, `friction`, `linearDamping`, `angularDamping`
- Ref provides imperative handle for `applyImpulse()`

### Colliders
- `CuboidCollider`: Box-shaped collision (d6, d8, d10, d12)
- `BallCollider`: Sphere collision (d20)
- `ConvexHullCollider`: Custom shapes (from GLB vertices)

### Contact Force Callbacks
```typescript
<RigidBody onContactForce={(payload) => {
  const { totalForce } = payload
  // Trigger haptic feedback based on force
}}>
```

## Integration Points
- **Frontend**: `Dice.tsx` uses RigidBody + colliders
- **State**: Roll triggers `applyImpulse()` on all dice
- **Hooks**: `useFaceDetection` reads RigidBody transform
