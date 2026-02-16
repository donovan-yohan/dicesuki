# Code Patterns & Conventions

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed code patterns guidance.

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
│   ├── customDiceDB.ts # IndexedDB for custom dice GLB files
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
