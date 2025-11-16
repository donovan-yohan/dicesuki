# Claude Development Guide - Daisu Project

This document outlines the development practices, workflows, and guidelines for the Daisu dice simulator project.

---

## Development Philosophy

### Core Principles
1. **Test-Driven Development (TDD)**: Write tests before implementation
2. **Incremental Commits**: Small, focused commits with clear messages
3. **Quality Over Speed**: Ensure code works correctly before moving on
4. **Documentation**: Keep spec.md and CLAUDE.md up to date

---

## Test-Driven Development (TDD)

### The TDD Cycle

```
1. RED    → Write a failing test
2. GREEN  → Write minimum code to pass the test
3. REFACTOR → Improve code while keeping tests green
4. REPEAT → Move to next feature
```

### TDD Benefits Observed
- Caught rotation axis bug in face detection early
- Identified timing issues with async state updates
- Ensured proper mocking for React Three Fiber components
- Prevented regressions during refactoring

### Writing Tests

#### Test File Naming
- Component tests: `ComponentName.test.tsx`
- Hook tests: `useHookName.test.ts`
- Utility tests: `utilityName.test.ts`

#### Test Structure
```typescript
describe('Component/Feature Name', () => {
  describe('specific functionality', () => {
    it('should do something specific', () => {
      // Arrange
      const { result } = renderHook(() => useMyHook())

      // Act
      act(() => {
        result.current.doSomething()
      })

      // Assert
      expect(result.current.state).toBe(expected)
    })
  })
})
```

#### React Three Fiber Testing Setup
```typescript
// Always include in test setup (src/test/setup.ts)
// 1. Mock ResizeObserver (required for R3F Canvas)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock as any

// 2. Mock WebGL context (required for Three.js)
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId) => {
  if (contextId === 'webgl' || contextId === 'webgl2') {
    return {
      canvas: document.createElement('canvas'),
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      getExtension: () => null,
      getParameter: () => null,
      getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 })
    }
  }
  return null
})
```

#### Testing Async State Updates
```typescript
// Use waitFor for async state changes
await waitFor(() => {
  expect(result.current.isAtRest).toBe(true)
})

// Use fake timers for time-dependent logic
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] })
})

afterEach(() => {
  vi.restoreAllMocks()
})
```

### Test Coverage Goals
- **Unit Tests**: All hooks, utilities, core logic
- **Component Tests**: UI components, rendering, interaction
- **Integration Tests**: Component + hook integration
- **Target**: >80% code coverage
- **Current**: 97 tests passing, 3 failing (haptic throttle tests), 16 skipped
  - Test files: 7 passing, 1 failing (useHapticFeedback.test.ts)
  - Note: Haptic throttle tests need investigation and fixing

---

## Git Workflow

### Initial Setup
```bash
# Initialize repository
git init

# Add .gitignore
# (Already present - covers node_modules, dist, .env, etc.)

# Initial commit
git add .
git commit -m "Initial commit: Project setup with Vite + React + TypeScript"
```

### Commit Strategy

#### Commit Types
- `feat:` New feature
- `fix:` Bug fix
- `test:` Add or update tests
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `docs:` Documentation updates
- `chore:` Maintenance tasks
- `style:` Code style/formatting

#### Commit Message Format
```
type(scope): short description

- Detailed change 1
- Detailed change 2
- Why this change was needed

Refs: #issue-number (if applicable)
```

#### Examples
```bash
# Feature commit
git commit -m "feat(dice): Add D6 component with physics integration

- Created D6.tsx with RigidBody and mesh
- Implemented imperative handle for applyImpulse
- Added memoization for geometry and callbacks
- Integrated with useFaceDetection hook

Tests: 6 tests passing for D6 component"

# Bug fix commit
git commit -m "fix(physics): Prevent dice 'pop' after result registration

- Deferred onRest callback with requestAnimationFrame
- Added double-check verification before notification
- Separated physics loop from React state updates

Issue: Dice would move slightly when result was displayed"

# Test commit
git commit -m "test(hooks): Add tests for useDiceRoll hook

- 22 tests covering roll mechanics
- Roll state management tests
- Impulse generation tests
- Roll history tracking tests"
```

### Branching Strategy

#### For Solo Development
```bash
# Work directly on main for small features
git checkout -b feature/device-motion
# ... make changes ...
git commit -m "feat(input): Add device motion support"
git checkout main
git merge feature/device-motion
git branch -d feature/device-motion
```

#### For Larger Features
```bash
# Create feature branch
git checkout -b feature/multiple-dice

# Make incremental commits
git commit -m "feat(dice): Add d8 geometry"
git commit -m "test(dice): Add tests for d8 face detection"
git commit -m "feat(dice): Integrate d8 into DiceManager"

# Merge when complete
git checkout main
git merge feature/multiple-dice
```

### Commit Frequency

#### When to Commit
- ✅ After completing a test + implementation cycle
- ✅ After fixing a bug with verification
- ✅ After completing a sub-feature
- ✅ Before attempting risky refactoring
- ✅ At natural stopping points (end of session)

#### Commit Checklist
Before committing, ensure:
- [ ] All tests pass (`npm test`)
- [ ] No linting errors (`npm run lint` if configured)
- [ ] Code builds successfully (`npm run build`)
- [ ] No console errors in dev environment
- [ ] Related documentation updated (if needed)
- [ ] **CLAUDE.md reviewed and updated** (on feature completion or when asked to commit)

---

## Development Workflow

### Starting a New Feature

1. **Read spec.md** - Understand requirements and current phase
2. **Plan approach** - Break down into testable units
3. **Write tests first** (TDD Red phase)
4. **Implement minimum code** (TDD Green phase)
5. **Refactor & optimize** (TDD Refactor phase)
6. **Update spec.md** - Mark tasks complete
7. **Commit** - Clear message with context

### Example: Adding a New Hook

```bash
# 1. Create test file
touch src/hooks/useNewFeature.test.ts

# 2. Write failing tests
# ... edit useNewFeature.test.ts ...

# 3. Run tests (should fail)
npm test -- useNewFeature.test.ts

# 4. Create implementation file
touch src/hooks/useNewFeature.ts

# 5. Implement minimum code to pass tests
# ... edit useNewFeature.ts ...

# 6. Run tests (should pass)
npm test

# 7. Refactor if needed
# ... improve code ...

# 8. Verify all tests still pass
npm test

# 9. Commit
git add src/hooks/useNewFeature.ts src/hooks/useNewFeature.test.ts
git commit -m "feat(hooks): Add useNewFeature hook

- Created useNewFeature with X functionality
- 15 tests passing for state management
- Handles edge cases: A, B, C

Refs: spec.md Phase X, Task Y"
```

### Daily Development Routine

```bash
# Morning - Start work
git status                  # Check current state
git pull                    # Get latest changes (if collaborative)
npm test                    # Verify all tests pass
npm run dev                 # Start dev server

# During development
# ... TDD cycle: test → implement → refactor ...
npm test                    # Run frequently
git add <files>             # Stage changes
git commit -m "..."         # Commit incrementally

# Evening - End session
npm test                    # Final test run
npm run build               # Verify production build
git status                  # Check for uncommitted work
git push                    # Push if using remote
# Update spec.md progress
```

---

## Code Quality Guidelines

### Performance Considerations

#### React Three Fiber Optimizations
```typescript
// 1. Memoize geometry
const geometry = useMemo(() => createGeometry(), [dependencies])

// 2. Memoize callbacks
const handleEvent = useCallback(() => {
  // handler logic
}, [dependencies])

// 3. Memoize components
export const Component = memo(ComponentImpl)

// 4. Use refs for non-render state
const stateRef = useRef(initialValue)
```

#### Physics Optimizations
```typescript
// 1. Defer state updates from physics loop
useEffect(() => {
  if (condition) {
    requestAnimationFrame(() => {
      // Update React state AFTER physics loop
      setState(newValue)
    })
  }
}, [dependencies])

// 2. Use conservative thresholds
const VELOCITY_THRESHOLD = 0.01  // Strict threshold
const REST_DURATION_MS = 1000    // Adequate settling time
```

### Common Patterns

#### Hooks
```typescript
// Custom hook pattern
export function useFeature(): FeatureState {
  const [state, setState] = useState(initial)

  const action = useCallback(() => {
    // action logic
  }, [dependencies])

  return { state, action }
}
```

#### Components with Physics
```typescript
// Component with physics and memoization
const ComponentImpl = forwardRef<Handle, Props>(({
  prop1,
  prop2
}, ref) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const geometry = useMemo(() => createGeometry(), [size])

  useImperativeHandle(ref, () => ({
    method: () => {
      // imperative method
    }
  }))

  return (
    <RigidBody ref={rigidBodyRef}>
      <mesh geometry={geometry} />
    </RigidBody>
  )
})

export const Component = memo(ComponentImpl)
```

### Code Review Checklist

Before considering a feature complete:
- [ ] All tests passing
- [ ] No console warnings/errors
- [ ] Performance tested (FPS check)
- [ ] Mobile tested (if applicable)
- [ ] Accessibility considered
- [ ] Code documented (complex logic)
- [ ] spec.md updated
- [ ] Git commit with clear message

---

## Debugging Strategies

### Common Issues & Solutions

#### 1. Dice "Popping" After Result
**Symptom**: Dice moves slightly when result is registered
**Diagnosis**: React state update during physics loop
**Solution**: Defer callback with `requestAnimationFrame`

#### 2. Test Timing Issues
**Symptom**: Tests fail with fake timers
**Diagnosis**: `performance.now()` not mocked
**Solution**: `vi.useFakeTimers({ toFake: ['performance'] })`

#### 3. React Three Fiber Test Errors
**Symptom**: "ResizeObserver is not defined"
**Diagnosis**: jsdom doesn't provide browser APIs
**Solution**: Mock ResizeObserver in test setup

#### 4. Physics Instability
**Symptom**: Dice behavior inconsistent
**Diagnosis**: Thresholds too loose or tight
**Solution**: Adjust velocity thresholds, test on device

#### 5. Constant Haptic Vibration
**Symptom**: Device vibrates constantly even when dice is still
**Diagnosis**: Haptic triggers on continuous contact, not just impacts
**Solution**: Use multi-filter approach:
- Speed threshold (> HAPTIC_MIN_SPEED)
- Force direction check (dot product < HAPTIC_FORCE_DIRECTION_THRESHOLD)
- Velocity change detection (> HAPTIC_MIN_VELOCITY_CHANGE)
- Force magnitude threshold (> HAPTIC_MIN_FORCE)
All constants configurable in `physicsConfig.ts`

### Debug Tools

```typescript
// Performance monitoring
// Press Ctrl+Shift+P to toggle FPS overlay

// Console logging (development only)
console.log('Dice rolled:', faceValue)
console.log('Impulse:', impulse)

// React DevTools
// Use browser extension for component inspection
```

---

## Haptic Feedback System

### Overview
The dice simulator includes haptic feedback (vibration) on mobile devices when dice collide with walls or other dice. The system uses the Web Vibration API with intelligent impact detection to provide realistic tactile feedback. **State is managed via Zustand global store (`useUIStore`) for consistent behavior across all dice components.**

### Architecture

#### Core Components
1. **`src/lib/haptics.ts`**: Core utility with Web Vibration API wrapper
2. **`src/hooks/useHapticFeedback.ts`**: React hook for vibration triggering (reads from global store)
3. **`src/store/useUIStore.ts`**: Zustand store managing `hapticEnabled` state globally
4. **`src/components/dice/Dice.tsx`**: Collision detection and haptic triggering
5. **`src/config/physicsConfig.ts`**: Centralized configuration for all thresholds

#### Haptic Patterns
```typescript
// From physicsConfig.ts - configurable durations (in milliseconds)
HAPTIC_LIGHT_DURATION = 10   // Gentle tap for light collisions
HAPTIC_MEDIUM_DURATION = 30  // Moderate bump for normal collisions
HAPTIC_STRONG_DURATION = 50  // Strong impact for hard collisions
```

### Collision Detection Algorithm

The system uses a multi-filter approach to detect actual impacts vs. sliding/continuous contact:

#### 1. Speed Filter
```typescript
if (speed < HAPTIC_MIN_SPEED) return  // 0.5 m/s default
```
Only process if dice is moving with significant velocity.

#### 2. Force Direction Filter
```typescript
const dot = velocityDir.dot(forceDir.normalize())
if (dot > HAPTIC_FORCE_DIRECTION_THRESHOLD) return  // -0.3 default
```
Uses dot product to ensure force opposes velocity (actual impact).
- `dot < -0.3`: Force opposes motion → Impact (vibrate)
- `dot > -0.3`: Force same/perpendicular → Sliding (no vibration)

#### 3. Velocity Change Filter
```typescript
const deltaSpeed = currentVelocity.sub(lastVelocity).length()
if (deltaSpeed < HAPTIC_MIN_VELOCITY_CHANGE) return  // 0.5 default
```
Measures deceleration to confirm impact occurred.

#### 4. Force Magnitude Mapping
```typescript
if (forceMagnitude < HAPTIC_MIN_FORCE) return         // < 5: No vibration
else if (forceMagnitude < HAPTIC_LIGHT_THRESHOLD)     // 5-20: Light
else if (forceMagnitude < HAPTIC_MEDIUM_THRESHOLD)    // 20-50: Medium
else vibrateOnCollision('strong')                     // > 50: Strong
```

### Configuration

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

### User Preferences

- **Toggle**: Settings panel includes haptic on/off toggle
- **Persistence**: Preference stored in `localStorage` with key `'hapticFeedbackEnabled'`
- **Default**: Enabled by default if device supports vibration
- **Visibility**: Toggle only shown if `navigator.vibrate` is supported

### Testing Strategy

#### Mocking Web Vibration API
```typescript
// In test files
const vibrateMock = vi.fn()
vi.mock('../lib/haptics', () => ({
  isHapticsSupported: () => true,
  vibrate: (pattern: number | number[]) => vibrateMock(pattern),
  HAPTIC_PATTERNS: { light: 10, medium: 30, strong: 50 }
}))
```

#### Key Test Cases
1. **Feature Detection**: `isHapticsSupported()` checks for `navigator.vibrate`
2. **Pattern Triggering**: Correct vibration duration for each intensity
3. **Throttling**: No more than 1 vibration per `HAPTIC_THROTTLE_MS` (50ms)
4. **User Preference**: Respects enabled/disabled state
5. **localStorage**: Persists and restores user preference

#### Test Coverage
- `src/lib/haptics.test.ts`: 11 tests (utility functions)
- `src/hooks/useHapticFeedback.test.ts`: 13 tests (hook behavior)
- Total: 24 haptic-specific tests, 100% pass rate

### Common Issues

#### Issue: Constant Vibration
**Symptom**: Vibrates continuously even when dice is stationary
**Root Cause**: `onContactForce` fires continuously during contact
**Solution**: Multi-filter approach (speed + direction + velocity change)

#### Issue: No Vibration on Impacts
**Symptom**: No vibration despite visible collisions
**Diagnosis**:
- Check device support: `navigator.vibrate` available?
- Check user preference: Enabled in settings?
- Check thresholds: Force magnitude > `HAPTIC_MIN_FORCE`?
- Check velocity: Dice speed > `HAPTIC_MIN_SPEED`?

### Performance Considerations

1. **Throttling**: 50ms minimum between vibrations prevents overwhelming feedback
2. **Early Returns**: Filters ordered from cheapest to most expensive checks
3. **Ref Storage**: `lastVelocityVectorRef` avoids state updates in physics loop
4. **Memoization**: `handleContactForce` callback memoized with `useCallback`

### Browser Compatibility

The Web Vibration API is supported on:
- ✅ Chrome/Edge (mobile + desktop)
- ✅ Firefox (mobile + desktop)
- ✅ Safari (iOS 16.4+)
- ❌ Safari (macOS) - hardware limitation, no vibration motor

Graceful degradation: Feature detection with `isHapticsSupported()` prevents errors on unsupported platforms.

---

## Technology Stack

### React 19 Upgrade (2025-11-16)
The project has been upgraded to React 19 and the latest React Three Fiber ecosystem:

**Core Dependencies:**
- React 19.2.0 (upgraded from 18.3.1)
- @react-three/fiber 9.4.0 (upgraded from 8.x)
- @react-three/drei 10.7.7
- @react-three/rapier 2.2.0
- @react-three/postprocessing 3.0.4 (installed for future effects)

**Benefits:**
- Improved rendering performance
- Better concurrent features
- Latest R3F APIs and patterns
- Access to modern postprocessing effects

---

## Project-Specific Guidelines

### File Organization
```
src/
├── components/        # React components
│   ├── dice/         # Dice-specific components
│   ├── icons/        # Icon components (DiceIcon, DiceIconWithNumber)
│   ├── layout/       # Layout components (BottomNav, DiceToolbar, etc.)
│   ├── panels/       # UI panels (Settings, ThemeSelector, etc.)
│   └── *.tsx         # UI components
├── config/           # Configuration files
│   └── physicsConfig.ts  # All physics constants
├── contexts/         # React contexts
│   └── ThemeContext.tsx  # Theme management and provider
├── hooks/            # Custom React hooks
│   ├── useHapticFeedback.ts  # Haptic feedback hook
│   └── *.ts          # Other hooks
├── lib/              # Utilities and helpers
│   ├── geometries.ts # Dice geometries
│   ├── haptics.ts    # Haptic utilities
│   └── *.ts          # Other utilities
├── store/            # Zustand stores
│   ├── useDiceManagerStore.ts  # Dice state management
│   └── useUIStore.ts           # UI preferences (haptics, etc.)
├── themes/           # Theme system
│   ├── tokens.ts     # Theme definitions (5 themes)
│   └── registry.ts   # Theme registry and utilities
└── test/             # Test setup and helpers
```

### Naming Conventions
- **Components**: PascalCase (e.g., `RollButton.tsx`)
- **Hooks**: camelCase with "use" prefix (e.g., `useDiceRoll.ts`)
- **Utilities**: camelCase (e.g., `deviceDetection.ts`)
- **Tests**: Match source file with `.test` (e.g., `D6.test.tsx`)
- **Types**: PascalCase (e.g., `DiceRollState`)

### Import Organization
```typescript
// 1. External libraries
import { useState } from 'react'
import * as THREE from 'three'

// 2. Internal utilities
import { getDiceFaceValue } from '../lib/geometries'

// 3. Internal hooks
import { useFaceDetection } from '../hooks/useFaceDetection'

// 4. Internal components
import { RollButton } from './RollButton'

// 5. Types
import type { D6Props, D6Handle } from './types'
```

---

## Resources

### Documentation
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [Rapier Physics](https://rapier.rs/docs/)
- [Vitest](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)

### Key Learnings
- See `spec.md` "Key Technical Decisions & Learnings" section
- Review commit history for problem-solving patterns
- Check resolved issues in spec.md for debugging patterns

### Getting Help
- Check spec.md for architecture overview
- Review existing tests for patterns
- Search commit history: `git log --grep="keyword"`
- Review this file for development practices

---

## Future Considerations

### As Project Grows
- Consider adding ESLint for code consistency
- Add pre-commit hooks with Husky
- Implement code coverage reporting
- Add CI/CD pipeline (GitHub Actions)
- Consider Prettier for auto-formatting

### When Adding Team Members
- Onboarding: Read spec.md → CLAUDE.md → Run tests
- Pair program on first feature
- Review commit history for patterns
- Emphasize TDD workflow

---

## Documentation Maintenance

### IMPORTANT: Review CLAUDE.md on Every Feature Completion

**This file must be reviewed and updated whenever you:**
1. Complete a feature or significant change
2. Are asked to commit code
3. Add new patterns, utilities, or components
4. Encounter and solve new issues
5. Update project structure or workflow

**What to update:**
- Test coverage numbers
- File organization structure
- Common issues & solutions
- New patterns or conventions
- New dependencies or tools
- Version numbers and dates

**How to audit:**
1. Read through each section
2. Verify accuracy against current codebase
3. Update outdated information
4. Add new patterns discovered
5. Remove obsolete information
6. Update "Last Updated" date

---

## Saved Rolls Bonus System

### Overview
The saved rolls feature allows users to save dice roll configurations with bonuses (flat bonuses and per-die bonuses). The system intelligently manages bonus state to ensure bonuses only apply when appropriate.

### Architecture

#### Core Components
1. **`useDiceStore.ts`**: Manages `activeSavedRoll` state with bonus tracking
2. **`SavedRollsPanel.tsx`**: Spawns dice and sets active saved roll
3. **`Scene.tsx`**: Displays results with bonuses and manages lifecycle
4. **`diceHelpers.ts`**: Formats saved roll formulas

#### Bonus State Structure
```typescript
activeSavedRoll: {
  flatBonus: number              // Flat bonus added to total (e.g., +4)
  perDieBonuses: Map<string, number>  // Per-die bonuses (dice ID → bonus)
  expectedDiceCount: number      // Total dice expected in this roll
} | null
```

### Bonus Lifecycle

#### 1. Execute Saved Roll
When user executes a saved roll (e.g., "6d6 + 4"):
- Spawns dice matching the saved roll configuration
- Sets `activeSavedRoll` with `flatBonus=4`, `perDieBonuses`, and `expectedDiceCount=6`
- Closes panel, ready for rolling

#### 2. Roll Button Click
When user clicks ROLL button:
- **Checks dice count**: If current dice count ≠ `expectedDiceCount`, clears `activeSavedRoll`
- **Preserves bonuses**: If count matches, keeps `activeSavedRoll` for result display
- Applies physics impulse to all dice

#### 3. Result Display
Shows total with bonuses:
- **Grand Total**: `diceSum + perDieBonusesTotal + flatBonus`
- **Breakdown Label**: Shows `"19 + 4"` beneath total (only if `flatBonus ≠ 0`)
- **Individual Dice**: Shows per-die bonuses beneath each die value

#### 4. Clear Bonuses
`activeSavedRoll` is automatically cleared when:
- User manually adds dice (`handleAddDice`)
- User removes dice (`handleRemoveDice`)
- User clears all dice (`handleClearAll`)
- Dice count doesn't match expected count during roll

### Formula Formatting

The `formatSavedRoll()` function properly handles operators:
- **Positive bonus**: `6d6 + 4` (not `6d6 + +4`)
- **Negative bonus**: `6d6 - 4` (not `6d6 + -4`)

### Common Issues

#### Issue: Bonuses Not Displaying
**Symptom**: Roll shows dice sum only, no flat bonus
**Diagnosis**: `activeSavedRoll` is null or cleared
**Check**:
- Did user manually add/remove dice? (clears bonuses)
- Does dice count match `expectedDiceCount`? (mismatch clears bonuses)

#### Issue: Bonuses Persist After Manual Changes
**Symptom**: Bonuses still showing after adding/removing dice
**Solution**: Ensure `clearActiveSavedRoll()` is called in all manual dice operations

### Testing Considerations

When testing saved rolls:
1. Verify bonuses display correctly on first roll
2. Test that bonuses persist when re-rolling same dice set
3. Test that bonuses clear when dice count changes
4. Test manual add/remove dice clears bonuses
5. Test formula formatting with positive and negative bonuses

---

## Recent Updates

### 2025-11-16: Inventory-Based Dice Limiting System
- **Core Feature**: Implemented inventory-based dice spawning limits
  - Players can only spawn dice they own from inventory
  - Each spawned die links to specific inventory die via `inventoryDieId`
  - Real-time availability tracking (owned - in use)
  - Prevents over-spawning beyond owned quantity

- **Starter Dice Configuration** (src/config/starterDice.ts)
  - Updated distribution: 6d4, 6d6, 4d8, 2d10, 2d12, 1d20 (21 total)
  - All starter dice locked (`isLocked: true`) to prevent deletion/crafting
  - Guarantees players always have minimum dice collection

- **DiceToolbar UI** (src/components/layout/DiceToolbar.tsx)
  - Shows available count badges (owned - in use)
  - Buttons disable when count reaches 0 (50% opacity, cursor: not-allowed)
  - No hover/tap animations when disabled
  - Tooltip updates: "No {TYPE} available" when disabled

- **DiceManagerStore** (src/store/useDiceManagerStore.ts)
  - Added `inventoryDieId` field to `DiceInstance` interface
  - Added `getInUseDiceIds()` function for tracking
  - Removed default hardcoded d6 on load
  - Table starts empty, populated from inventory

- **Scene Initialization** (src/components/Scene.tsx)
  - Auto-spawns 1 d20 from inventory on first load
  - Uses ref-based guard (`hasSpawnedInitialDie`) to prevent double-spawn
  - `handleAddDice` validates availability before spawning
  - Console warnings when attempting to spawn unavailable dice

### 2025-11-16: Saved Rolls Bonus System
- **Formula Display**: Fixed double-plus bug (`6d6 + +4` → `6d6 + 4`)
  - Updated `formatSavedRoll()` to properly handle positive/negative operators
- **Bonus Tracking**: Implemented persistent bonus display through roll lifecycle
  - Added `activeSavedRoll` state to `useDiceStore` with `expectedDiceCount` tracking
  - Bonuses now persist when clicking ROLL button
  - Bonuses auto-clear when dice count changes (add/remove/clear operations)
- **Result Display**: Enhanced to show grand total with bonuses
  - Large total at top: `diceSum + perDieBonuses + flatBonus`
  - Breakdown label: Shows `"19 + 4"` when flat bonus present
  - Per-die bonuses shown beneath individual dice values
  - Shows `?` while rolling (hides partial sum until complete)

### 2025-11-16: UI Enhancements & Theme Integration
- **DiceToolbar**: Integrated with theme system for dynamic colors
  - Dice buttons now use `currentTheme.tokens.colors.accent` and `currentTheme.tokens.colors.surface`
  - Hover effects use `currentTheme.tokens.colors.dice.highlight`
  - Implemented dual trash button functionality: click to clear all, drag to delete individual dice
- **Theme System**: All themes now owned by default for development/testing
  - Added one-time migration in ThemeProvider to grant access to all themes
- **Dungeon Theme**: Updated environment colors for authentic castle aesthetic
  - Floor: `#2a2a2a` (dark gray stone)
  - Walls: `#333333` (dark gray stone)
  - Lighting: Neutral gray ambient (`#999999`) with minimal directional light

---

**Last Updated**: 2025-11-16
**Maintained By**: Claude + Development Team
