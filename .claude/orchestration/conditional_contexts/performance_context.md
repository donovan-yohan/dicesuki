# Performance Context (500-800 tokens)

## Performance Philosophy
- **Measure First**: Profile before optimizing
- **Target**: 60 FPS on mobile devices
- **Constraints**: Physics simulation + 3D rendering = CPU intensive

## React Optimization Patterns

### 1. Memoization
**When to Use**: Expensive computations, complex objects, callbacks

```typescript
// Geometry memoization (THREE.js objects)
const geometry = useMemo(() => new BoxGeometry(size, size, size), [size])

// Callback memoization (event handlers)
const handleClick = useCallback(() => {
  setState(newValue)
}, [dependencies])

// Component memoization (prevent re-renders)
export const Dice = memo(DiceImpl)
```

**Key Files**:
- `src/components/dice/Dice.tsx`: Geometry + callbacks memoized
- `src/components/dice/CustomDice.tsx`: GLB model caching

### 2. Refs for Non-Render State
**Pattern**: Store values that don't need re-renders in refs

```typescript
// Physics state (read in physics loop, no re-render needed)
const lastVelocityRef = useRef<Vector3>(new Vector3())
const isSettledRef = useRef(false)

// Update without triggering render
lastVelocityRef.current = currentVelocity
```

**Use Cases**:
- Physics loop state (velocities, forces)
- Animation frame IDs
- Timers and intervals
- Previous values for comparison

### 3. Deferred State Updates
**Pattern**: Update React state AFTER physics loop completes

```typescript
useEffect(() => {
  if (isAtRest) {
    // Defer state update to next frame
    requestAnimationFrame(() => {
      setFaceValue(detectedValue)
    })
  }
}, [isAtRest])
```

**Why**: Prevents state updates during 60 FPS physics loop

## React Three Fiber Optimizations

### 1. Geometry Reuse
**Problem**: Creating geometry every render is expensive

```typescript
// ❌ Bad: New geometry every render
<mesh geometry={new BoxGeometry(1, 1, 1)} />

// ✅ Good: Memoized geometry
const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
<mesh geometry={geometry} />
```

### 2. Material Reuse
**Pattern**: Share materials across dice

```typescript
// Create material once per dice type
const d6Material = useMemo(() =>
  new MeshStandardMaterial({ color: '#ff0000' }),
  []
)
```

### 3. Dispose Pattern
**Pattern**: Clean up Three.js resources to prevent memory leaks

```typescript
useEffect(() => {
  return () => {
    geometry.dispose()
    material.dispose()
  }
}, [])
```

## Physics Performance

### 1. Conservative Thresholds
**Principle**: Tighter thresholds = fewer calculations

```typescript
// Velocity threshold for "at rest" detection
VELOCITY_THRESHOLD = 0.01  // Strict (fewer checks)

// Haptic throttle
HAPTIC_THROTTLE_MS = 50    // Max 20 vibrations/sec
```

### 2. Early Exit Patterns
**Pattern**: Filter cheapest checks first

```typescript
// Haptic collision detection (ordered by cost)
if (speed < MIN_SPEED) return              // Cheap: 1 value
if (forceMag < MIN_FORCE) return           // Cheap: 1 value
if (velocityDir.dot(forceDir) > -0.3) return  // Medium: dot product
const deltaSpeed = current.sub(last).length()  // Expensive: vector math
if (deltaSpeed < MIN_CHANGE) return
```

### 3. Batch Operations
**Pattern**: Group physics updates together

```typescript
// ❌ Bad: Apply impulse in separate loops
dice.forEach(die => die.applyImpulse(...))

// ✅ Good: Batch in single frame
dice.forEach((die, i) => {
  die.applyImpulse(impulses[i])
})
```

## Rendering Optimizations

### 1. Level of Detail (LOD)
**Future Enhancement**: Reduce geometry complexity at distance

```typescript
// Potential pattern:
const detailLevel = distance > 10 ? 'low' : 'high'
const segments = detailLevel === 'low' ? 6 : 16
```

### 2. Frustum Culling
**Built-in**: Three.js automatically culls off-screen objects
**Ensure**: Keep dice within camera frustum

### 3. Shadow Optimization
**Current**: Ambient + directional light (no shadows)
**Why**: Shadow maps expensive on mobile
**Alternative**: Baked lighting or simple ambient occlusion

## Profiling Tools

### Browser DevTools
```javascript
// FPS monitoring (press Ctrl+Shift+P in dev)
// Three.js Stats component
```

### React DevTools Profiler
- Identify expensive re-renders
- Track component render times
- Find unnecessary updates

### Performance Metrics
```typescript
// Measure physics loop time
const start = performance.now()
// ... physics calculations ...
const duration = performance.now() - start
if (duration > 16.67) console.warn('Physics loop too slow!')
```

## Performance Budgets

### Target Metrics (Mobile)
- **FPS**: 60 (16.67ms per frame)
- **Physics loop**: <8ms
- **React updates**: <4ms
- **Render time**: <4ms

### Dice Limits
- **Current**: No hard limit (inventory-based)
- **Recommended**: <10 dice on screen for 60 FPS
- **Fallback**: Reduce quality if FPS drops

## Common Performance Issues

### 1. Dice "Popping" After Result
**Symptom**: Slight movement when result displayed
**Cause**: React state update during physics loop
**Fix**: Defer callback with `requestAnimationFrame`

### 2. Constant Re-renders
**Symptom**: Component renders on every frame
**Cause**: New object/function created each render
**Fix**: `useMemo` for objects, `useCallback` for functions

### 3. Memory Leaks
**Symptom**: Performance degrades over time
**Cause**: Three.js resources not disposed
**Fix**: Cleanup in `useEffect` return function

## Integration Points
- **Frontend**: Apply memo/callback patterns to components
- **Physics**: Monitor physics loop timing, adjust thresholds
- **State**: Minimize store subscriptions, use selectors
