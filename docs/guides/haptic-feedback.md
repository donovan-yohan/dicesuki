# Haptic Feedback System

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed haptic feedback guidance.

## Overview
The dice simulator includes haptic feedback (vibration) on mobile devices when dice collide with walls or other dice. The system uses the Web Vibration API with intelligent impact detection to provide realistic tactile feedback. **State is managed via Zustand global store (`useUIStore`) for consistent behavior across all dice components.**

## Architecture

### Core Components
1. **`src/lib/haptics.ts`**: Core utility with Web Vibration API wrapper
2. **`src/hooks/useHapticFeedback.ts`**: React hook for vibration triggering (reads from global store)
3. **`src/store/useUIStore.ts`**: Zustand store managing `hapticEnabled` state globally
4. **`src/components/dice/Dice.tsx`**: Collision detection and haptic triggering
5. **`src/config/physicsConfig.ts`**: Centralized configuration for all thresholds

### Haptic Patterns
```typescript
// From physicsConfig.ts - configurable durations (in milliseconds)
HAPTIC_LIGHT_DURATION = 10   // Gentle tap for light collisions
HAPTIC_MEDIUM_DURATION = 30  // Moderate bump for normal collisions
HAPTIC_STRONG_DURATION = 50  // Strong impact for hard collisions
```

## Collision Detection Algorithm

The system uses a multi-filter approach to detect actual impacts vs. sliding/continuous contact:

### 1. Speed Filter
```typescript
if (speed < HAPTIC_MIN_SPEED) return  // 0.5 m/s default
```
Only process if dice is moving with significant velocity.

### 2. Force Direction Filter
```typescript
const dot = velocityDir.dot(forceDir.normalize())
if (dot > HAPTIC_FORCE_DIRECTION_THRESHOLD) return  // -0.3 default
```
Uses dot product to ensure force opposes velocity (actual impact).
- `dot < -0.3`: Force opposes motion → Impact (vibrate)
- `dot > -0.3`: Force same/perpendicular → Sliding (no vibration)

### 3. Velocity Change Filter
```typescript
const deltaSpeed = currentVelocity.sub(lastVelocity).length()
if (deltaSpeed < HAPTIC_MIN_VELOCITY_CHANGE) return  // 0.5 default
```
Measures deceleration to confirm impact occurred.

### 4. Force Magnitude Mapping
```typescript
if (forceMagnitude < HAPTIC_MIN_FORCE) return         // < 5: No vibration
else if (forceMagnitude < HAPTIC_LIGHT_THRESHOLD)     // 5-20: Light
else if (forceMagnitude < HAPTIC_MEDIUM_THRESHOLD)    // 20-50: Medium
else vibrateOnCollision('strong')                     // > 50: Strong
```

## Configuration

All haptic thresholds are centralized in `src/config/physicsConfig.ts`:

```typescript
// Speed and velocity thresholds
HAPTIC_MIN_SPEED = 0.5                    // Minimum dice speed (m/s)
HAPTIC_MIN_VELOCITY_CHANGE = 0.5          // Minimum delta-v for impact (m/s)

// Force direction threshold
HAPTIC_FORCE_DIRECTION_THRESHOLD = -0.3   // Dot product threshold (must oppose motion)

// Force magnitude thresholds
HAPTIC_MIN_FORCE = 5                      // Minimum force to trigger any vibration
HAPTIC_LIGHT_THRESHOLD = 20               // Light → Medium boundary
HAPTIC_MEDIUM_THRESHOLD = 50              // Medium → Strong boundary

// Vibration durations
HAPTIC_LIGHT_DURATION = 10                // Light tap duration (ms)
HAPTIC_MEDIUM_DURATION = 30               // Medium bump duration (ms)
HAPTIC_STRONG_DURATION = 50               // Strong impact duration (ms)

// Throttling
HAPTIC_THROTTLE_MS = 50                   // Min time between vibrations (ms)
```

## User Preferences

- **Toggle**: Settings panel includes haptic on/off toggle
- **Persistence**: Preference stored in `localStorage` with key `'hapticFeedbackEnabled'`
- **Default**: Enabled by default if device supports vibration
- **Visibility**: Toggle only shown if `navigator.vibrate` is supported

## Testing Strategy

### Mocking Web Vibration API
```typescript
// In test files
const vibrateMock = vi.fn()
vi.mock('../lib/haptics', () => ({
  isHapticsSupported: () => true,
  vibrate: (pattern: number | number[]) => vibrateMock(pattern),
  HAPTIC_PATTERNS: { light: 10, medium: 30, strong: 50 }
}))
```

### Key Test Cases
1. **Feature Detection**: `isHapticsSupported()` checks for `navigator.vibrate`
2. **Pattern Triggering**: Correct vibration duration for each intensity
3. **Throttling**: No more than 1 vibration per `HAPTIC_THROTTLE_MS` (50ms)
4. **User Preference**: Respects enabled/disabled state
5. **localStorage**: Persists and restores user preference

### Test Coverage
- `src/lib/haptics.test.ts`: 11 tests (utility functions)
- `src/hooks/useHapticFeedback.test.ts`: 13 tests (hook behavior)
- Total: 24 haptic-specific tests, 100% pass rate

## Common Issues

### Issue: Constant Vibration
**Symptom**: Vibrates continuously even when dice is stationary
**Root Cause**: `onContactForce` fires continuously during contact
**Solution**: Multi-filter approach (speed + direction + velocity change)

### Issue: No Vibration on Impacts
**Symptom**: No vibration despite visible collisions
**Diagnosis**:
- Check device support: `navigator.vibrate` available?
- Check user preference: Enabled in settings?
- Check thresholds: Force magnitude > `HAPTIC_MIN_FORCE`?
- Check velocity: Dice speed > `HAPTIC_MIN_SPEED`?

## Performance Considerations

1. **Throttling**: 50ms minimum between vibrations prevents overwhelming feedback
2. **Early Returns**: Filters ordered from cheapest to most expensive checks
3. **Ref Storage**: `lastVelocityVectorRef` avoids state updates in physics loop
4. **Memoization**: `handleContactForce` callback memoized with `useCallback`

## Browser Compatibility

The Web Vibration API is supported on:
- Chrome/Edge (mobile + desktop)
- Firefox (mobile + desktop)
- Safari (iOS 16.4+)
- Safari (macOS) - hardware limitation, no vibration motor

Graceful degradation: Feature detection with `isHapticsSupported()` prevents errors on unsupported platforms.
