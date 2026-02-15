# ADR 004 - Test Strategy with Vitest and Playwright

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

The application combines standard React UI logic with 3D rendering (React Three Fiber), WASM physics (Rapier), browser APIs (Web Vibration, DeviceMotion, IndexedDB), and Zustand global state. This creates unique testing challenges:

- Three.js and R3F require WebGL context and canvas APIs not available in Node.js test environments
- Physics hooks read from `RigidBody` refs that only exist inside a running physics simulation
- Haptic feedback depends on `navigator.vibrate` (browser API)
- Zustand stores use Maps/Sets with shallow equality
- Visual correctness of dice face detection cannot be verified through unit tests alone

The testing strategy must handle all of these while remaining fast enough for TDD workflows.

## Decision

The project MUST use a two-tier testing strategy:

### Tier 1: Unit and Component Tests (Vitest + jsdom)

**Framework:** Vitest v4 with jsdom environment, configured in `vite.config.ts`.

**Scope:** All hooks, utilities, stores, and component logic that does not require actual WebGL rendering.

**Test setup** (`src/test/setup.ts`) MUST provide:
- `ResizeObserver` mock (required by R3F Canvas)
- `WebGL/WebGL2` context mock (required by Three.js)
- `@testing-library/jest-dom` matchers

**Conventions:**
- Test files MUST be colocated with source: `ComponentName.test.tsx`, `useHookName.test.ts`, `utilityName.test.ts`
- Store tests MUST be colocated with store files in `src/store/`
- Tests MUST use the Arrange/Act/Assert pattern
- Async state updates MUST use `waitFor()` from Testing Library
- Time-dependent tests MUST use `vi.useFakeTimers({ toFake: ['performance'] })` to mock `performance.now()`
- Browser APIs (vibrate, DeviceMotion, IndexedDB) MUST be mocked at the module level

**R3F component testing:** Components that render inside a `<Canvas>` SHOULD be tested via their hook logic (extracted into custom hooks) rather than attempting to render the full 3D scene in jsdom.

### Tier 2: Visual/E2E Tests (Playwright)

**Framework:** Playwright, configured in `playwright.config.ts`.

**Scope:** Visual verification tests that require actual WebGL rendering in a real browser. Currently used for dice face detection validation.

**Structure:**
- E2E tests live in `e2e/` directory
- Excluded from Vitest via `exclude: ['e2e/**']` in vite config
- Run against dev server (`localhost:3000`)
- Screenshot-based assertions stored in `e2e/screenshots/`
- Helper utilities shared via `e2e/dice-faces.helpers.ts`

**Current coverage:** Per-face screenshot tests for all six die types (d4, d6, d8, d10, d12, d20) verifying correct face-value-to-orientation mapping.

### Test Targets

- Unit test coverage target: >80% for hooks, utilities, and store logic
- Current status: 161 tests passing, 3 known failing (haptic throttle), 16 skipped
- Known failures MUST be documented in CLAUDE.md and not suppressed

### Running Tests

```bash
npm test              # Vitest in watch mode (TDD)
npm run test:ui       # Vitest with browser UI
npm run test:coverage # Vitest with coverage report
npx playwright test   # E2E tests (requires dev server)
```

## Alternatives Considered

**Jest:** The de facto React testing framework, but Vitest provides native ESM support, Vite-aligned transforms, and significantly faster startup. Since the project already uses Vite for bundling, Vitest avoids maintaining a separate transform pipeline.

**Cypress:** Full E2E framework with better developer experience for UI testing, but heavier setup and slower execution. Playwright was chosen for its lightweight API, multi-browser support, and screenshot comparison capabilities needed for dice face verification.

**Storybook + Chromatic:** Visual regression testing for UI components. Valuable for a component library but not aligned with the current need (3D scene verification, physics hook testing). Could be added later for the 2D UI layer.

**Testing in-browser (no jsdom):** Running unit tests in a real browser would solve WebGL mocking issues but significantly slows down the TDD feedback loop. The current approach of mocking WebGL and testing hook logic in jsdom provides the best speed/coverage tradeoff.

## Consequences

### Positive

- Vitest's Vite integration means zero configuration drift between dev/build/test transform pipelines
- Fast TDD feedback loop: unit tests run in <2 seconds
- Playwright catches visual regressions that unit tests cannot (dice face orientation, rendering correctness)
- Colocated test files make it easy to find and maintain tests alongside source code
- Comprehensive test setup in `src/test/setup.ts` provides a reusable foundation for all R3F-related tests

### Negative / Considerations

- R3F components require significant mocking infrastructure; adding new browser API dependencies (e.g., WebXR) will require extending the test setup
- Physics behavior cannot be unit-tested directly; physics accuracy relies on E2E tests and manual device testing
- Playwright tests require a running dev server and real browser, making them slower and unsuitable for the TDD inner loop
- The 3 known failing haptic throttle tests indicate a gap in the timing mock strategy that needs investigation
- No integration tests currently exist for the full component + store + physics pipeline; this is a gap between unit tests and E2E
