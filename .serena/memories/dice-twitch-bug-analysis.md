# Dice Twitch Bug - Root Cause Analysis

## Problem
After dice lands and result is saved to history, the dice receives extra motion and twitches. This occurs when UI updates (history/result display) trigger React re-renders.

## Root Cause
**React reconciliation affecting physics world:**

1. Dice lands → `onDiceRest` callback fires
2. Callback updates React state: `setLastResult()` + `setRollHistory()`
3. Scene component re-renders due to state changes
4. React reconciles entire Canvas fiber tree
5. Physics context briefly interacts with RigidBody objects
6. Physics perturbation causes visible twitch

## Why Existing Safeguards Failed
- `memo(D6)`: Only prevents D6 re-render if props change, not parent re-renders
- `useMemo(geometry)`: Only prevents geometry recreation
- `requestAnimationFrame`: Only defers callback timing
- Double-check verification: Only prevents premature notifications

**None prevent Scene component from re-rendering, which is the actual issue.**

## Solution Architecture
**Move UI state outside React render cycle using Zustand**

### Implementation
1. Create Zustand store for `lastResult` and `rollHistory`
2. Keep physics state in `useDiceRoll` (canRoll, isRolling, impulse)
3. Scene subscribes to store for UI, never re-renders Canvas
4. Physics callbacks update store directly

### Benefits
- Complete physics-UI isolation
- Canvas never re-renders after mount
- Physics world remains stable
- UI still updates reactively

## Quick Fix Alternative
Wrap Canvas in useMemo with empty dependencies:
```typescript
const canvas = useMemo(() => <Canvas>...</Canvas>, [])
```
This is a 2-line fix for immediate relief while implementing proper solution.

## Verification
Fix successful if:
- Scene only renders once (check console logs)
- Dice remains perfectly still after landing
- UI updates correctly with results
- All 60 tests still pass