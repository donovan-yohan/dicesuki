# Daisu - Physics Dice Simulator - Technical Specification

**Last Updated**: 2025-11-11
**Current Phase**: Phase 1 (In Progress)

---

## Project Overview

Daisu is a web-based physics dice simulator with realistic 3D dice rolling mechanics, device motion integration, and customizable skins. The MVP focuses on delivering a high-quality single D6 experience with mobile-first optimization.

---

## Technology Stack (Actual Implementation)

### Core Libraries
- **Rendering**: `@react-three/fiber` - React renderer for Three.js
- **3D Graphics**: `three` - 3D graphics library
- **Physics Engine**: `@react-three/rapier` - WASM-based physics (replaced cannon-es after research)
  - **Why Rapier?**: 300%+ performance improvement over cannon-es, actively maintained, WASM-based
  - cannon-es was originally proposed but found to be unmaintained and significantly slower
- **UI Helpers**: `@react-three/drei` - Useful helpers for R3F (Camera, OrbitControls, etc.)
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: Custom React hooks (Zustand planned for Phase 2+)
- **Device Detection**: `detect-gpu` - GPU tier detection for performance optimization

### Development Tools
- **Testing**: Vitest + @testing-library/react + @testing-library/jest-dom
- **Testing Approach**: Test-Driven Development (TDD) - write tests first, then implementation
- **Version Control**: Git (local repository)
- **Development Workflow**: TDD + incremental commits per feature

---

## Architecture & Modules

### Implemented Modules

#### 1. **Core Geometry & Math** (`src/lib/geometries.ts`)
- D6 face normals definition with pre-computed vectors
- `createD6Geometry()` - Creates rounded cube geometry for D6
- `getDiceFaceValue()` - Face detection using dot product algorithm
- Quaternion-based rotation calculations

#### 2. **Face Detection Hook** (`src/hooks/useFaceDetection.ts`)
- At-rest detection with velocity thresholds
- **Thresholds** (conservative to prevent false positives):
  - Linear velocity: < 0.01 units/s
  - Angular velocity: < 0.01 rad/s
  - Rest duration: 1 second continuous
- State management for `isAtRest`, `faceValue`
- Reset functionality for new rolls

#### 3. **Dice Roll Hook** (`src/hooks/useDiceRoll.ts`)
- Roll state management (`canRoll`, `isRolling`)
- Random impulse generation (2-5 horizontal, 5-8 upward)
- Roll history tracking
- Result callback handling with ref-based state to prevent re-roll issues

#### 4. **D6 Component** (`src/components/dice/D6.tsx`)
- React Three Fiber + Rapier physics integration
- Imperative handle for external control (`applyImpulse`, `reset`)
- **Performance optimizations**:
  - Memoized geometry to prevent recreation
  - React.memo to prevent unnecessary re-renders
  - Deferred result notification using `requestAnimationFrame`
  - Double-check verification before state updates
- Physics properties: restitution=0.3, friction=0.6
- Automatic position reset and random rotation on roll

#### 5. **Scene Component** (`src/components/Scene.tsx`)
- Canvas setup with proper DPR (device pixel ratio)
- 20x20 platform with invisible boundary walls
- Lighting: ambient + directional with shadows
- Camera: Perspective at [0, 5, 10] with orbit controls
- Physics world with gravity [0, -9.81, 0]
- Result display (top-right corner)
- Roll history display (top-left, last 5 rolls)

#### 6. **Roll Button** (`src/components/RollButton.tsx`)
- Fixed position at bottom center
- Disabled state during rolls
- Accessible (aria-label, keyboard support)
- Responsive styling with Tailwind

#### 7. **Performance Monitoring** (`src/hooks/usePerformanceMonitor.tsx`)
- FPS tracking
- Toggle overlay with Ctrl+Shift+P
- Performance metrics display

#### 8. **Device Detection** (`src/lib/deviceDetection.ts`)
- GPU tier checking
- Device compatibility validation
- Low-end device blocking (tier < 2)

---

## Data Models

### Implemented

```typescript
// Face Detection
interface DiceFace {
  value: number
  normal: THREE.Vector3
}

// Dice Roll State
interface DiceRollState {
  canRoll: boolean
  isRolling: boolean
  lastResult: number | null
  rollHistory: number[]
  roll: () => THREE.Vector3 | null
  onDiceRest: (faceValue: number) => void
  reset: () => void
}

// D6 Props
interface D6Props {
  position?: [number, number, number]
  rotation?: [number, number, number]
  size?: number
  color?: string
  onRest?: (faceValue: number) => void
}

// D6 Imperative Handle
interface D6Handle {
  applyImpulse: (impulse: THREE.Vector3) => void
  reset: () => void
}
```

### Planned (Phase 2+)

```typescript
type DieShape = "d4" | "d6" | "d8" | "d10" | "d12" | "d20"

interface DiceRoll {
  id: string
  timestamp: number
  shapes: DieShape[]
  results: number[]
}

interface Skin {
  id: string
  name: string
  thumbnailUrl: string
  textureUrl: string
  unlocked: boolean
}

interface UserInventory {
  selectedSkinId: string
  unlockedSkinIds: string[]
  rollHistory: DiceRoll[]
}
```

---

## Key Technical Decisions & Learnings

### 1. Physics Engine Selection
**Decision**: Switched from cannon-es to @react-three/rapier
**Rationale**:
- Research revealed cannon-es is on "life support" (last update 2021)
- Rapier shows 300%+ performance gains in benchmarks
- WASM-based for better performance on mobile
- Active maintenance and modern API
- Better integration with React Three Fiber ecosystem

### 2. At-Rest Detection
**Challenge**: Dice would "pop" or move slightly after result registration
**Solution**: Multi-layered approach
- Conservative velocity thresholds (0.01 vs original 0.1)
- 1-second continuous rest duration
- Deferred notification using `requestAnimationFrame`
- Double-check verification before callback
- Separate physics loop from React state updates

### 3. Render Performance
**Challenge**: Parent state updates causing D6 re-renders and physics glitches
**Solution**:
- Memoize geometry with `useMemo`
- Memoize callbacks with `useCallback`
- Wrap D6 in `React.memo`
- Use refs for state that doesn't need renders

### 4. Test-Driven Development
**Approach**: Write tests before implementation
**Benefits**:
- Caught rotation axis bug in face detection
- Identified timing issues with fake timers
- Ensured proper mocking for R3F/Three.js
- 60 tests passing across 5 test files

---

## Phase-by-Phase Implementation

### Phase 0 – Setup & Basic Infrastructure ✅ COMPLETED

**Duration**: 3 hours
**Completed**: 2025-11-11

**Tasks Completed**:
1. ✅ Initialized Vite + React + TypeScript project
2. ✅ Installed dependencies: `three`, `@react-three/fiber`, `@react-three/rapier`, `@react-three/drei`, `zustand`, `detect-gpu`
3. ✅ Installed dev dependencies: `vitest`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`
4. ✅ Set up Vite config with test configuration
5. ✅ Created folder structure: `src/components/`, `src/hooks/`, `src/lib/`, `src/test/`
6. ✅ Set up test environment with ResizeObserver and WebGL mocks
7. ✅ Created Scene with React Three Fiber Canvas
8. ✅ Set up Rapier physics world
9. ✅ Added ground plane and test geometry
10. ✅ Implemented device detection (GPU tier check)
11. ✅ Created performance monitoring hook
12. ✅ Verified rendering + physics loop working on mobile

**Deliverable**: Working 3D scene with physics, test geometry visible on mobile

---

### Phase 1 – Rolling a Single D6 ⏳ IN PROGRESS

**Estimated Duration**: 1 week
**Progress**: ~80% complete

**Tasks Completed**:

1. ✅ **D6 Geometry & Face Detection** (TDD)
   - Created `geometries.ts` with D6 face normals
   - Implemented `getDiceFaceValue()` using quaternion math
   - 10 tests passing for face detection logic
   - Fixed rotation axis bugs through test failures

2. ✅ **At-Rest Detection Hook** (TDD)
   - Created `useFaceDetection.ts` hook
   - Velocity/angular velocity thresholds
   - 2-second rest duration (later optimized to 1s)
   - 9 tests passing
   - Fixed timing issues with fake timers

3. ✅ **D6 Component** (TDD)
   - Created `D6.tsx` with physics integration
   - RigidBody with restitution and friction
   - 6 tests passing
   - Fixed ResizeObserver and WebGL mocking issues

4. ✅ **Roll Mechanics Hook** (TDD)
   - Created `useDiceRoll.ts` hook
   - Random impulse generation
   - Roll state management
   - Roll history tracking
   - 22 tests passing

5. ✅ **Roll Button Component** (TDD)
   - Created `RollButton.tsx`
   - Disabled state during rolls
   - Accessibility features
   - 13 tests passing

6. ✅ **Scene Integration**
   - Integrated D6 with roll button
   - Result display (top-right)
   - Roll history display (top-left)
   - Larger platform (20x20) with invisible walls

7. ✅ **Performance Optimizations**
   - Fixed "popping" issue after result registration
   - Memoized geometry, callbacks, component
   - Deferred notifications with `requestAnimationFrame`
   - Conservative rest thresholds (0.01)

**Tasks Remaining**:

8. ⏳ **Device Motion Integration**
   - DeviceMotionEvent permission flow
   - Tilt-to-roll mechanics
   - Permission UI/prompts
   - Fallback for desktop (drag/button only)

9. ⏳ **Mobile Testing & Refinement**
   - Complete iPad testing validation
   - Cross-browser testing (Safari, Chrome Mobile)
   - Performance profiling on mid-range devices
   - Final UX polish

**Current Test Coverage**: 60 tests passing across 5 files

**Deliverable**: Single D6 roll via button working perfectly; device motion support for tilt/shake rolls

---

### Phase 2 – Multiple Dice Shapes (PLANNED)

**Estimated Duration**: 2 weeks

**Tasks**:
1. Extend `DiceManager` to support: d4, d8, d10, d12, d20
2. Create geometry generators for each shape
3. Implement multi-dice spawning system
4. Dice shape selector UI
5. Handle multiple dice collision detection
6. Aggregate results for multiple dice
7. Performance testing with multiple dice

**Deliverable**: Multiple dice shapes supported; tap/drag toss mechanics

---

### Phase 3 – Skins & Cosmetics (PLANNED)

**Estimated Duration**: 2 weeks

**Tasks**:
1. Define skin system architecture
2. Create texture/material system
3. Implement skin selector UI
4. Critical/failure visual effects
5. Persist skin selection locally
6. Create 3-5 sample skins

**Deliverable**: Customizable dice skins; critical/failure effects

---

### Phase 4 – Persistence & Backend Stubs (PLANNED)

**Estimated Duration**: 1-2 weeks

**Tasks**:
1. Implement localStorage/IndexedDB persistence
2. Roll history persistence
3. User inventory persistence
4. Basic backend stub architecture
5. Offline-first functionality

**Deliverable**: Local persistence working; backend-ready architecture

---

### Phase 5 – Performance & Deployment (PLANNED)

**Estimated Duration**: 1 week

**Tasks**:
1. Performance profiling and optimization
2. Cross-browser testing
3. Responsive UI refinement
4. Production build optimization
5. Deploy to Netlify/Vercel
6. Analytics integration (optional)

**Deliverable**: Production-ready MVP deployed

---

## Testing Strategy

### Test-Driven Development (TDD)
1. **Red**: Write failing tests first
2. **Green**: Implement minimum code to pass
3. **Refactor**: Optimize while keeping tests passing

### Test Coverage Goals
- Unit tests for all hooks and utilities
- Component tests for UI elements
- Integration tests for physics interactions
- Target: >80% coverage

### Current Test Stats
- **Test Files**: 5
- **Total Tests**: 60
- **Pass Rate**: 100%

### Test Files
1. `geometries.test.ts` - 10 tests (face normals, face detection)
2. `useFaceDetection.test.ts` - 9 tests (at-rest detection, state management)
3. `useDiceRoll.test.ts` - 22 tests (roll mechanics, history tracking)
4. `RollButton.test.tsx` - 13 tests (UI, interaction, accessibility)
5. `D6.test.tsx` - 6 tests (rendering, props, integration)

---

## Performance Targets

### Mobile Performance (Mid-Range Devices)
- **FPS**: Maintain 60fps during rolls
- **Physics**: Stable simulation at 60Hz
- **Load Time**: < 3 seconds initial load
- **Memory**: < 200MB peak usage

### Desktop Performance
- **FPS**: 60fps+ consistently
- **Physics**: Full fidelity
- **Resolution**: Support 4K displays

### Optimization Strategies
- GPU tier detection for adaptive quality
- Lazy loading for future assets
- Texture compression
- Simplified collision shapes
- Reduced polygon counts for dice

---

## Known Issues & Technical Debt

### Resolved
- ✅ Dice "popping" after result registration
- ✅ False positive at-rest detection
- ✅ Re-render causing physics glitches
- ✅ Black screen on mobile (lighting/geometry issues)
- ✅ Dice falling off platform
- ✅ Test mocking for R3F components

### Active
- None currently

### Future Considerations
- Multiple dice collision optimization
- More complex dice geometries (d4, d20)
- Advanced visual effects (particles, post-processing)
- Network multiplayer (Phase 6+)

---

## Development Workflow

See `CLAUDE.md` for detailed development practices including:
- TDD methodology
- Git workflow and commit practices
- Testing conventions
- Code review guidelines

---

## Resources & References

### Libraries
- [Three.js Documentation](https://threejs.org/docs/)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [Rapier Physics](https://rapier.rs/docs/)
- [@react-three/drei Helpers](https://github.com/pmndrs/drei)

### Research & Tutorials
- [Crafting a Dice Roller with Three.js and Cannon-es (Codrops)](https://tympanus.net/codrops/2023/01/25/crafting-a-dice-roller-with-three-js-and-cannon-es/)
- [DeviceMotionEvent - MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent)
- [GPU Detection Library](https://github.com/pmndrs/detect-gpu)

### Performance Benchmarks
- Rapier vs Cannon-es: 300%+ performance improvement
- Mobile target: 60fps on iPhone 12 / Pixel 5 equivalent
- Desktop target: 60fps on integrated graphics

---

## Timeline Summary

| Phase   | Duration | Status      | Completion Date |
|---------|----------|-------------|----------------|
| Phase 0 | 3 hours  | ✅ Complete | 2025-11-11     |
| Phase 1 | 1 week   | ⏳ 80%      | In Progress    |
| Phase 2 | 2 weeks  | 📋 Planned  | -              |
| Phase 3 | 2 weeks  | 📋 Planned  | -              |
| Phase 4 | 1-2 weeks| 📋 Planned  | -              |
| Phase 5 | 1 week   | 📋 Planned  | -              |

**Total Estimated**: 7-9 weeks for full MVP
**Current Progress**: Phase 1, Week 1

---

## Next Steps

1. ⏳ Complete Device Motion integration
2. ⏳ Finalize iPad testing
3. ⏳ Add DeviceMotion permission flow
4. 📋 Begin Phase 2 planning (multiple dice shapes)
5. 📋 Research d4/d8/d10/d12/d20 geometries
