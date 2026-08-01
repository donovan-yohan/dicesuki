# ADR 004 - Test Strategy with Vitest and Playwright

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team
* Amended: 2026/08/01 — see [Amendments](#amendments) (the per-face dice-faces
  specs are removed; E2E no longer validates face detection)

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

**Scope:** Visual and behavioural verification that requires actual WebGL rendering in a real browser.

~~Currently used for dice face detection validation.~~
**Superseded by [Amendment 1](#amendment-1---e2e-no-longer-validates-face-detection-2026-08-01):**
face detection is `dicesuki-core`'s, not the client's, and the specs that
"validated" it only round-tripped one table through itself.

**Structure:**
- E2E tests live in `e2e/` directory
- Excluded from Vitest via `exclude: ['e2e/**']` in vite config
- Run against a dev server on a per-spec port (`PLAYWRIGHT_TEST_PORT`)
- Each spec is wired to its own `npm run test:e2e:*` script
- Screenshots written to `e2e/screenshots/` are artifacts; assertions that read
  pixels sample the composited frame in-page rather than diffing a baseline
- ~~Helper utilities shared via `e2e/dice-faces.helpers.ts`~~ (deleted 2026-08-01)

**Current coverage:** ~~Per-face screenshot tests for all six die types (d4, d6, d8, d10, d12, d20) verifying correct face-value-to-orientation mapping.~~
Solo wasm room, runtime dice assets, HUD layout, roll builder/picker/advanced,
d100 percentile pairing, and basic-dice rendering (which samples real pixels
through the `/test/dice-faces` harness). See [Amendment 1](#amendment-1---e2e-no-longer-validates-face-detection-2026-08-01).

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
- Playwright catches visual regressions that unit tests cannot (~~dice face orientation~~ rendering correctness, real pixels — see [Amendment 1](#amendment-1---e2e-no-longer-validates-face-detection-2026-08-01))
- Colocated test files make it easy to find and maintain tests alongside source code
- Comprehensive test setup in `src/test/setup.ts` provides a reusable foundation for all R3F-related tests

### Negative / Considerations

- R3F components require significant mocking infrastructure; adding new browser API dependencies (e.g., WebXR) will require extending the test setup
- Physics behavior cannot be unit-tested directly; physics accuracy relies on E2E tests and manual device testing
- Playwright tests require a running dev server and real browser, making them slower and unsuitable for the TDD inner loop
- The 3 known failing haptic throttle tests indicate a gap in the timing mock strategy that needs investigation
- No integration tests currently exist for the full component + store + physics pipeline; this is a gap between unit tests and E2E

## Amendments

### Amendment 1 - E2E no longer validates face detection (2026-08-01)

* Status: Accepted
* Deciders: Donovan (PO approval, 2026-08-01), Development Team
* Amends: the Tier 2 scope and "Current coverage" clauses describing the
  per-face dice-faces screenshot grid as current E2E coverage.

**Context.** This ADR's Tier 2 premise was that "visual correctness of dice face
detection cannot be verified through unit tests alone". Two things have since
changed. First, face detection left the client entirely: Shared-ADR-005 and
Frontend-ADR-001 put it in `dicesuki-core` (`server/core/src/face_detection.rs`),
delivered on `die_settled`, and forbid reintroducing the client-side path.
Second, a test-suite audit showed the `e2e/dice-faces-*.spec.ts` specs never
verified anything visual. `validateDiceFace` compared two DOM readouts that the
harness derived from the *same* `D<shape>_FACE_NORMALS` array — the expected
value read straight off the table, the "reported" value obtained by feeding that
table's normal back through `getDiceFaceValue()`, which is an argmax over the
same table. No pixel was ever read. The companion `generate <type> screenshot
grid` tests wrote PNGs with no comparison, so they passed unless they threw; the
numerals were only ever checked by a human looking at the grid.

**Decision.** The per-shape dice-faces specs and `e2e/dice-faces.helpers.ts` are
removed, together with the client's `getDiceFaceValue()`. E2E MUST NOT be used to
re-verify a value the room already owns.

- The numeral-to-physical-face binding — the real client invariant, since core
  detects indices while the client paints textures — is proven by unit tests
  that do not call any detection function: `faceMaterialMapping.test.ts`
  ("Mapping matches geometry triangle normals") checks each declared
  `FACE_MATERIAL_MAPS` entry against triangle normals independently recomputed
  from the mesh by `geometryFaceMapper.generateMaterialMapping()`, backed by the
  hard-coded d6 axis table in `geometries.test.ts`, the independently
  hand-written d10tens 00-90 table in `diceShape.guard.test.ts`,
  `textureRendering.test.ts`, and `percentileRolls.test.ts`.
- The `/test/dice-faces` route and `DiceFaceTestHarness` are RETAINED in slimmed
  form. They no longer report a detected face; they park a die at a known
  rotation and publish the expected numeral, which `e2e/basic-dice.spec.ts`
  (`npm run test:e2e:basic-dice`) uses to sample real composited pixels.
- Every E2E spec MUST be reachable from an `npm run test:e2e:*` script. The
  deleted specs were not, which is why their decay went unnoticed.

**Consequences.** E2E is now reserved for what only a real browser can show —
rendered pixels and full user flows — and is no longer a second home for logic
the Rust core owns. The `D<shape>_FACE_NORMALS` tables remain in
`src/lib/geometries.ts`: they are rendering data (which numeral goes on which
facet), not detection data.
