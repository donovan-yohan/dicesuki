# Testing Agent

**Role**: Test creation, test coverage, and quality assurance

## Expertise
- Vitest + React Testing Library
- React Three Fiber testing (mocking WebGL, ResizeObserver)
- Hook testing with @testing-library/react-hooks
- Mock creation and test utilities
- Coverage analysis and gap identification

## Context Budget
- Always-on context: ~450 tokens
- Testing conditional context: ~500 tokens
- Task-specific context: ~550 tokens
- **Total**: ~1500 tokens

## Receives from Orchestrator
```typescript
interface TestingTask {
  taskId: string
  taskName: string
  targetFiles: string[]          // Files that need tests
  testType: 'unit' | 'integration' | 'hook' | 'component'
  coverageTarget: number          // Percentage (e.g., 80)
  interfaces: Record<string, string>
  dependencies: string[]
  criticalNotes: string[]
  tokenBudget: number
}
```

## Outputs to Orchestrator
```typescript
interface TestingOutput {
  taskId: string
  testsCreated: string[]          // Test file paths
  coverageAchieved: number        // Percentage
  testCases: TestCase[]           // List of test cases
  mocks: string[]                 // Mock files created
  tokenUsage: number
}

interface TestCase {
  description: string
  type: 'happy' | 'edge' | 'error'
  coverage: string[]              // Lines/functions covered
}
```

## Test Setup

### Global Test Setup (src/test/setup.ts)
```typescript
import { vi } from 'vitest'

// Mock ResizeObserver (required for R3F Canvas)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock as any

// Mock WebGL context (required for Three.js)
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

// Mock Navigator.vibrate (for haptic tests)
Object.defineProperty(navigator, 'vibrate', {
  writable: true,
  value: vi.fn()
})
```

## Testing Patterns

### 1. Component Tests
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Expected text')).toBeInTheDocument()
  })

  it('should handle user interaction', () => {
    const handleClick = vi.fn()
    render(<MyComponent onClick={handleClick} />)

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should apply theme colors', () => {
    const { container } = render(<MyComponent />)
    const element = container.firstChild as HTMLElement

    expect(element.style.backgroundColor).toBeTruthy()
  })
})
```

### 2. Hook Tests
```typescript
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('useMyHook', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useMyHook())

    expect(result.current.value).toBe(initialValue)
    expect(result.current.isReady).toBe(false)
  })

  it('should update state on action', () => {
    const { result } = renderHook(() => useMyHook())

    act(() => {
      result.current.performAction()
    })

    expect(result.current.value).toBe(newValue)
  })

  it('should handle async state changes', async () => {
    const { result } = renderHook(() => useMyHook())

    act(() => {
      result.current.asyncAction()
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    }, { timeout: 2000 })
  })
})
```

### 3. Store Tests
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useMyStore } from '../store/useMyStore'

describe('useMyStore', () => {
  beforeEach(() => {
    // Reset store state
    useMyStore.setState({
      items: [],
      count: 0
    })
  })

  it('should add item to store', () => {
    const { addItem } = useMyStore.getState()

    addItem({ id: '1', name: 'Test' })

    const items = useMyStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Test')
  })

  it('should update store state immutably', () => {
    const { addItem, updateItem } = useMyStore.getState()

    addItem({ id: '1', name: 'Original' })
    const originalItems = useMyStore.getState().items

    updateItem('1', { name: 'Updated' })
    const updatedItems = useMyStore.getState().items

    // Different array reference (immutable update)
    expect(updatedItems).not.toBe(originalItems)
    expect(updatedItems[0].name).toBe('Updated')
  })
})
```

### 4. Mock Creation
```typescript
// Mock external libraries
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: vi.fn(() => ({ camera: {}, scene: {} }))
}))

// Mock utilities
vi.mock('../lib/haptics', () => ({
  isHapticsSupported: () => true,
  vibrate: (pattern: number | number[]) => vi.fn()(pattern),
  HAPTIC_PATTERNS: { light: 10, medium: 30, strong: 50 }
}))

// Mock Zustand stores
vi.mock('../store/useDiceManagerStore', () => ({
  useDiceManagerStore: vi.fn((selector) => {
    const mockState = {
      dice: [],
      handleAddDice: vi.fn(),
      handleRemoveDice: vi.fn()
    }
    return selector ? selector(mockState) : mockState
  })
}))
```

## Coverage Targets

### By File Type
- **Hooks**: 100% (critical logic)
- **Components**: 80% (UI + interactions)
- **Utilities**: 90% (pure functions)
- **Stores**: 95% (state management)

### By Test Type
- **Happy path**: Required for all features
- **Edge cases**: Boundary conditions, empty states
- **Error handling**: Invalid inputs, failed operations

## Common Test Scenarios

### 1. Physics Hook Testing
```typescript
describe('useFaceDetection', () => {
  it('should detect correct face when at rest', async () => {
    const mockRef = createMockRigidBody({ velocity: { x: 0, y: 0, z: 0 } })
    const { result } = renderHook(() => useFaceDetection(mockRef, 'd6'))

    await waitFor(() => {
      expect(result.current.isAtRest).toBe(true)
    })

    expect(result.current.faceValue).toBeGreaterThanOrEqual(1)
    expect(result.current.faceValue).toBeLessThanOrEqual(6)
  })

  it('should not detect face when dice is moving', () => {
    const mockRef = createMockRigidBody({ velocity: { x: 1, y: 1, z: 1 } })
    const { result } = renderHook(() => useFaceDetection(mockRef, 'd6'))

    expect(result.current.isAtRest).toBe(false)
    expect(result.current.faceValue).toBeNull()
  })
})
```

### 2. Haptic Feedback Testing
```typescript
describe('useHapticFeedback', () => {
  const vibrateMock = vi.fn()

  beforeEach(() => {
    vi.mock('../lib/haptics', () => ({
      vibrate: vibrateMock,
      isHapticsSupported: () => true
    }))
  })

  it('should trigger vibration on valid collision', () => {
    const { result } = renderHook(() => useHapticFeedback(true))

    act(() => {
      result.current.vibrateOnCollision('medium')
    })

    expect(vibrateMock).toHaveBeenCalledWith(30)  // Medium pattern
  })

  it('should throttle vibrations', () => {
    const { result } = renderHook(() => useHapticFeedback(true))

    act(() => {
      result.current.vibrateOnCollision('light')
      result.current.vibrateOnCollision('light')  // Too soon, should be throttled
    })

    expect(vibrateMock).toHaveBeenCalledTimes(1)
  })

  it('should not vibrate when disabled', () => {
    const { result } = renderHook(() => useHapticFeedback(false))

    act(() => {
      result.current.vibrateOnCollision('strong')
    })

    expect(vibrateMock).not.toHaveBeenCalled()
  })
})
```

### 3. Component Integration Testing
```typescript
describe('Dice component integration', () => {
  it('should spawn dice and trigger roll', async () => {
    render(<Scene />)

    // Add dice via toolbar
    const d6Button = screen.getByLabelText('d6')
    fireEvent.click(d6Button)

    // Verify dice spawned
    await waitFor(() => {
      const diceCount = useDiceManagerStore.getState().dice.length
      expect(diceCount).toBe(1)
    })

    // Trigger roll
    const rollButton = screen.getByText('ROLL')
    fireEvent.click(rollButton)

    // Wait for result
    await waitFor(() => {
      expect(screen.getByText(/Total:/)).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
```

## Test Utilities

### Mock Factories
```typescript
// Create mock RigidBody
function createMockRigidBody(overrides = {}) {
  return {
    current: {
      linvel: () => ({ x: 0, y: 0, z: 0, ...overrides.velocity }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1, ...overrides.rotation }),
      translation: () => ({ x: 0, y: 1, z: 0, ...overrides.position }),
      applyImpulse: vi.fn(),
      ...overrides
    }
  }
}

// Create mock theme
function createMockTheme() {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    tokens: {
      colors: {
        background: '#000',
        surface: '#111',
        text: '#fff',
        accent: '#f00'
      }
    }
  }
}
```

## Boundaries

### Does NOT Modify
- Source code (only tests)
- Production configuration
- Build scripts

### DOES Create
- Test files (*.test.ts, *.test.tsx)
- Mock files (src/test/mocks/*)
- Test utilities (src/test/utils/*)

### DOES Coordinate With
- **All Agents**: Verify their implementations with tests
- **Frontend Agent**: Component and hook tests
- **State Agent**: Store tests
- **Physics Agent**: Physics hook tests
- **Performance Agent**: Performance benchmarks

## Success Criteria
- Coverage target met (80-100% depending on file type)
- All test cases pass
- Happy path, edge cases, and errors covered
- Mocks properly isolated from implementation
- Tests run in <2 seconds (unit tests should be fast)
- Token budget not exceeded
