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
- **Current**: 60 tests passing, 100% pass rate

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

## Project-Specific Guidelines

### File Organization
```
src/
├── components/        # React components
│   ├── dice/         # Dice-specific components
│   └── *.tsx         # UI components
├── hooks/            # Custom React hooks
├── lib/              # Utilities and helpers
│   ├── geometries.ts # Dice geometries
│   └── *.ts          # Other utilities
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

**Last Updated**: 2025-11-11
**Maintained By**: Claude + Development Team
