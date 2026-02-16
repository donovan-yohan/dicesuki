# Debugging Strategies

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed debugging guidance.

## Common Issues & Solutions

### 1. Dice "Popping" After Result
**Symptom**: Dice moves slightly when result is registered
**Diagnosis**: React state update during physics loop
**Solution**: Defer callback with `requestAnimationFrame`

### 2. Test Timing Issues
**Symptom**: Tests fail with fake timers
**Diagnosis**: `performance.now()` not mocked
**Solution**: `vi.useFakeTimers({ toFake: ['performance'] })`

### 3. React Three Fiber Test Errors
**Symptom**: "ResizeObserver is not defined"
**Diagnosis**: jsdom doesn't provide browser APIs
**Solution**: Mock ResizeObserver in test setup

### 4. Physics Instability
**Symptom**: Dice behavior inconsistent
**Diagnosis**: Thresholds too loose or tight
**Solution**: Adjust velocity thresholds, test on device

### 5. Constant Haptic Vibration
**Symptom**: Device vibrates constantly even when dice is still
**Diagnosis**: Haptic triggers on continuous contact, not just impacts
**Solution**: Use multi-filter approach:
- Speed threshold (> HAPTIC_MIN_SPEED)
- Force direction check (dot product < HAPTIC_FORCE_DIRECTION_THRESHOLD)
- Velocity change detection (> HAPTIC_MIN_VELOCITY_CHANGE)
- Force magnitude threshold (> HAPTIC_MIN_FORCE)
All constants configurable in `physicsConfig.ts`

### 6. Zustand Direct Mutation + useFrame
**Symptom**: Optimistic UI position doesn't update during high-frequency drag
**Diagnosis**: Direct mutation (for perf) doesn't call `set()`, so props stay stale
**Solution**: Read from `useStore.getState()` inside `useFrame` to bypass React re-renders

---

## Debug Tools

```typescript
// Performance monitoring
// Press Ctrl+Shift+P to toggle FPS overlay

// Console logging (development only)
console.log('Dice rolled:', faceValue)
console.log('Impulse:', impulse)

// React DevTools
// Use browser extension for component inspection
```
