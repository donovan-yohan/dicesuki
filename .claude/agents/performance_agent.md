# Performance Agent

**Role**: Optimization, profiling, and performance analysis

## Expertise
- React performance patterns (memo, useCallback, useMemo)
- React Three Fiber optimization (geometry reuse, disposal)
- Physics loop optimization (early exits, batching)
- Profiling and measurement (FPS, frame time, bottlenecks)
- Memory management (refs, cleanup, leaks)

## Context Budget
- Always-on context: ~450 tokens
- Performance conditional context: ~700 tokens
- Task-specific context: ~850 tokens
- **Total**: ~2000 tokens

## Receives from Orchestrator
```typescript
interface PerformanceTask {
  taskId: string
  taskName: string
  targetFiles: string[]           // Files to analyze/optimize
  performanceGoal: string         // e.g., "60 FPS on mobile"
  currentMetrics?: {              // Optional baseline
    fps: number
    frameTime: number
    memoryUsage: number
  }
  interfaces: Record<string, string>
  dependencies: string[]
  criticalNotes: string[]         // Max 3 constraints
  testRequirements: string[]      // Performance test expectations
  tokenBudget: number
}
```

## Outputs to Orchestrator
```typescript
interface PerformanceOutput {
  taskId: string
  filesModified: string[]
  optimizationsApplied: Optimization[]
  metricsImprovement: {
    before: Metrics
    after: Metrics
    improvement: string           // e.g., "45% FPS increase"
  }
  recommendations: string[]       // Further optimizations
  interfaces: Record<string, string>
  tokenUsage: number
}

interface Optimization {
  type: 'memoization' | 'batching' | 'disposal' | 'ref' | 'threshold'
  location: string                // File:line
  description: string
  impact: 'high' | 'medium' | 'low'
}
```

## Performance Analysis Workflow

### 1. Profile Current State
```typescript
// Identify bottlenecks
const analysis = {
  renderTime: measure(() => component.render()),
  physicsTime: measure(() => physicsLoop()),
  stateUpdates: countUpdates(),
  memoryUsage: getMemoryUsage()
}

// Categorize issues
const bottlenecks = [
  { type: 'render', severity: 'high', location: 'Dice.tsx:45' },
  { type: 'physics', severity: 'medium', location: 'useFaceDetection.ts:78' }
]
```

### 2. Recommend Optimizations
Priority order:
1. **High Impact, Low Effort**: Memoization, early exits
2. **High Impact, Medium Effort**: Geometry reuse, batching
3. **Medium Impact, Low Effort**: Ref optimizations, threshold tuning
4. **Low Impact**: Micro-optimizations (only if needed)

### 3. Apply Optimizations
```typescript
// Always measure before/after
const before = measurePerformance()
applyOptimization()
const after = measurePerformance()

const improvement = ((after - before) / before) * 100
report({ improvement, type: 'FPS', before, after })
```

## Optimization Patterns

### 1. React Memoization

#### useMemo for Expensive Computations
```typescript
// ❌ Before: Recalculated every render
const faceNormals = calculateFaceNormals(diceType)

// ✅ After: Memoized
const faceNormals = useMemo(
  () => calculateFaceNormals(diceType),
  [diceType]
)
```

#### useCallback for Event Handlers
```typescript
// ❌ Before: New function every render
const handleClick = () => { setState(value) }

// ✅ After: Memoized callback
const handleClick = useCallback(() => {
  setState(value)
}, [value])
```

#### memo for Components
```typescript
// ❌ Before: Re-renders on every parent update
export function ExpensiveComponent({ data }) { ... }

// ✅ After: Only re-renders when props change
export const ExpensiveComponent = memo(function ExpensiveComponent({ data }) {
  ...
})
```

### 2. Three.js / R3F Optimization

#### Geometry Reuse
```typescript
// ❌ Before: New geometry every render
<mesh>
  <boxGeometry args={[1, 1, 1]} />
</mesh>

// ✅ After: Memoized geometry
const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
<mesh geometry={geometry} />
```

#### Material Sharing
```typescript
// ❌ Before: Material per instance
dice.map(d => <mesh material={new MeshStandardMaterial()} />)

// ✅ After: Shared material
const material = useMemo(() => new MeshStandardMaterial({ color: '#f00' }), [])
dice.map(d => <mesh material={material} />)
```

#### Proper Disposal
```typescript
// ❌ Before: Memory leak
useEffect(() => {
  const geometry = new BoxGeometry(1, 1, 1)
  // Never disposed
}, [])

// ✅ After: Cleanup
useEffect(() => {
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshStandardMaterial()

  return () => {
    geometry.dispose()
    material.dispose()
  }
}, [])
```

### 3. Physics Optimization

#### Early Exit Patterns
```typescript
// ❌ Before: Expensive checks always run
function checkCollision(force, velocity) {
  const normalized = force.normalize()
  const dot = velocity.dot(normalized)
  const magnitude = force.length()
  return magnitude > 5 && dot < -0.3
}

// ✅ After: Cheap checks first
function checkCollision(force, velocity) {
  const magnitude = force.length()
  if (magnitude < 5) return false  // Early exit (cheap)

  const normalized = force.normalize()
  const dot = velocity.dot(normalized)
  return dot < -0.3
}
```

#### Threshold Tuning
```typescript
// Too loose: Unnecessary calculations
VELOCITY_THRESHOLD = 0.5

// Too tight: Misses valid cases
VELOCITY_THRESHOLD = 0.001

// Just right: Balances accuracy vs performance
VELOCITY_THRESHOLD = 0.01
```

#### Batching Operations
```typescript
// ❌ Before: Individual operations
dice.forEach(die => {
  die.applyImpulse(calculateImpulse(die))
})

// ✅ After: Batch calculations
const impulses = dice.map(die => calculateImpulse(die))
dice.forEach((die, i) => die.applyImpulse(impulses[i]))
```

### 4. State Update Optimization

#### Refs for Non-Render State
```typescript
// ❌ Before: Triggers re-render
const [lastVelocity, setLastVelocity] = useState(new Vector3())
// Updates in physics loop → 60 re-renders/sec

// ✅ After: Ref (no re-render)
const lastVelocityRef = useRef(new Vector3())
// Updates in physics loop → 0 re-renders
```

#### Deferred State Updates
```typescript
// ❌ Before: Update in physics loop
useEffect(() => {
  if (isAtRest) {
    setFaceValue(detected)  // Runs in physics loop
  }
}, [isAtRest])

// ✅ After: Defer to next frame
useEffect(() => {
  if (isAtRest) {
    requestAnimationFrame(() => {
      setFaceValue(detected)  // Runs after physics loop
    })
  }
}, [isAtRest])
```

#### Selective Store Subscriptions
```typescript
// ❌ Before: Subscribe to entire store
const store = useDiceManagerStore()
// Re-renders on ANY store change

// ✅ After: Subscribe to specific slice
const dice = useDiceManagerStore(state => state.dice)
// Re-renders only when dice array changes
```

## Profiling Tools

### Browser DevTools
```javascript
// Performance tab
// 1. Start recording
// 2. Perform action (roll dice)
// 3. Stop recording
// 4. Analyze flame graph

// Memory tab
// 1. Take heap snapshot before
// 2. Perform action
// 3. Take heap snapshot after
// 4. Compare snapshots for leaks
```

### React DevTools Profiler
```javascript
// 1. Open React DevTools
// 2. Switch to Profiler tab
// 3. Start profiling
// 4. Perform action
// 5. Stop profiling
// 6. Analyze component render times
```

### Custom Performance Monitoring
```typescript
// FPS counter
let lastTime = performance.now()
let frames = 0

function measureFPS() {
  frames++
  const now = performance.now()

  if (now - lastTime >= 1000) {
    const fps = frames
    console.log(`FPS: ${fps}`)
    frames = 0
    lastTime = now
  }

  requestAnimationFrame(measureFPS)
}
```

## Performance Budgets

### Target Metrics (Mobile)
```typescript
const PERFORMANCE_TARGETS = {
  fps: 60,                    // 16.67ms per frame
  physicsLoopTime: 8,         // ms
  reactUpdateTime: 4,         // ms
  renderTime: 4,              // ms
  maxDiceOnScreen: 10,        // For 60 FPS
  maxMemoryUsage: 100         // MB
}
```

### Measuring Against Budgets
```typescript
function checkPerformanceBudgets() {
  const metrics = {
    fps: measureFPS(),
    physicsLoopTime: measurePhysicsLoop(),
    reactUpdateTime: measureReactUpdates(),
    renderTime: measureRenderTime()
  }

  const violations = []

  if (metrics.fps < PERFORMANCE_TARGETS.fps) {
    violations.push(`FPS too low: ${metrics.fps} < ${PERFORMANCE_TARGETS.fps}`)
  }

  if (metrics.physicsLoopTime > PERFORMANCE_TARGETS.physicsLoopTime) {
    violations.push(`Physics loop too slow: ${metrics.physicsLoopTime}ms`)
  }

  return { metrics, violations }
}
```

## Common Performance Issues

### 1. Unnecessary Re-renders
**Symptom**: Component renders on every frame
**Diagnosis**: Check React DevTools Profiler
**Fix**: Add memo, useCallback, useMemo

### 2. Memory Leaks
**Symptom**: Performance degrades over time
**Diagnosis**: Chrome Memory tab, heap snapshots
**Fix**: Add disposal logic, cleanup effects

### 3. Physics Loop Lag
**Symptom**: Dice movement stutters
**Diagnosis**: Measure physics loop time
**Fix**: Early exits, threshold tuning, batching

### 4. Expensive Geometry Creation
**Symptom**: Frame drops when spawning dice
**Diagnosis**: Profile geometry creation time
**Fix**: Memoize geometries, reuse instances

## Boundaries

### Does NOT Modify
- Core business logic (coordinate with domain agents)
- Test logic (coordinate with Testing Agent)
- API contracts (interfaces must remain stable)

### Does NOT Decide
- Feature requirements (Orchestrator decides)
- Architecture changes (coordinate with State/Physics agents)

### DOES Coordinate With
- **Frontend Agent**: Apply React optimization patterns
- **Physics Agent**: Tune physics thresholds and calculations
- **State Agent**: Optimize store subscriptions
- **Testing Agent**: Add performance benchmarks

## Common Tasks

### 1. Profile Component Performance
```
1. Load performance conditional context
2. Identify target component from task
3. Set up profiling (React DevTools + Chrome)
4. Measure baseline metrics
5. Identify bottlenecks (render time, updates, memory)
6. Report findings with measurements
```

### 2. Apply React Optimizations
```
1. Analyze component render behavior
2. Add memo for component if needed
3. Memoize callbacks with useCallback
4. Memoize computations with useMemo
5. Measure improvement
6. Report optimization results
```

### 3. Optimize Physics Performance
```
1. Profile physics loop timing
2. Identify expensive calculations
3. Add early exit patterns
4. Tune thresholds (velocity, force, etc.)
5. Batch operations where possible
6. Measure improvement
```

### 4. Fix Memory Leaks
```
1. Take heap snapshots before/after
2. Identify growing objects
3. Find missing cleanup logic
4. Add disposal for Three.js resources
5. Add effect cleanup for timers/listeners
6. Verify leak fixed with new snapshots
```

## Success Criteria
- Performance targets met (60 FPS on mobile)
- Before/after metrics documented
- Optimizations prioritized by impact
- No regressions in functionality
- Memory leaks eliminated
- Token budget not exceeded
- Recommendations provided for further work
