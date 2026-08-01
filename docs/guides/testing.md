# Testing & TDD

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed testing guidance.

## Development Philosophy

### Core Principles
1. **Test-Driven Development (TDD)**: Write tests before implementation
2. **Incremental Commits**: Small, focused commits with clear messages
3. **Quality Over Speed**: Ensure code works correctly before moving on
4. **Documentation**: Keep spec.md and CLAUDE.md up to date

---

## The TDD Cycle

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

---

## Writing Tests

### Test File Naming
- Component tests: `ComponentName.test.tsx`
- Hook tests: `useHookName.test.ts`
- Utility tests: `utilityName.test.ts`

### Test Structure
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

### React Three Fiber Testing Setup
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

### Testing Async State Updates
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

---

## Test Coverage Goals
- **Unit Tests**: All hooks, utilities, core logic
- **Component Tests**: UI components, rendering, interaction
- **Integration Tests**: Component + hook integration
- **Target**: >80% code coverage for hooks, utilities, and store logic

Current counts live in [CLAUDE.md](../../CLAUDE.md); don't duplicate them here,
they go stale within a day.

---

# Test Strategy

> Added 2026-08-01 after the suite went 666 → 2,114 tests in about a week of
> agent-driven development. The audit behind this section is
> [testing-audit-2026-08.md](testing-audit-2026-08.md).

## Validation vs. regression

Two different jobs wear the same costume.

**Validation** proves a change is correct *right now*, to you and to a reviewer.
Negative controls, fuzz sweeps, probe harnesses, one-shot repros, throwaway
instrumentation. Its audience is this PR. Its lifetime is this PR.

**Regression protection** stops a *future* change from breaking something.
Its audience is whoever touches this code in six months, and it must earn its
place in every CI run from now until someone deletes it.

Most validation work is excellent engineering and terrible regression
protection. A 4,000-trial fuzz sweep that confirms a slot model is sound is the
right way to review that model, and the wrong thing to run on every commit — it
is slow, and once the model is fixed it can only ever pass. The mistake is not
writing it; the mistake is committing it because it took effort to write.

Ask of every test before committing: **what future change should this fail on?**
If the honest answer is "the one I just made", it was validation. Report the
evidence and delete the test.

## Rules for agent-driven development

These encode what already worked in practice — they are policy now, not taste.

**Negative controls stay in the report, not the repo.** Revert the fix, watch
the N tests go red, restore the fix, and put the numbers in the PR body or
review report. The control is the *act*, not an artifact. Do not commit a test
whose only purpose was to demonstrate the fix worked; the behavioral test you
kept already does that.

**Probe harnesses and fuzz sweeps are scratch.** Write them under the
scratchpad, capture the conclusion with real numbers, and delete them before
committing. If a fuzz sweep finds a specific failing input, commit *that input*
as a small deterministic behavioral test and throw the sweep away. A seeded
sweep in CI is a slow, flaky way to re-derive a case you could have pinned.

**One test per invariant, in the module that owns it.** When a second slice
needs the same guarantee, import the sibling or extend it — do not restate it.
The single largest prune in the 2026-08 audit was 70 tests duplicated verbatim
across two files because two slices each wanted face-detection coverage nearby.

**Say what a test is for when it isn't obvious.** Guards and ratchets should
carry a header explaining what drifts without them.
`src/config/roomCapacity.guard.test.ts` and
`src/themes/contrast.source.guard.test.ts` are the house style.

**Name the bug.** A test closing a shipped defect gets the issue number in its
title — `it('… (#109)')`. That tells the next reader it is load-bearing, not
decorative, and makes it safe from a future prune.

## What earns a committed test

- **A durable invariant.** Something that must hold across refactors, whose
  violation is a defect rather than a change of mind.
- **User-visible behavior.** A rule a player could observe: keep/drop maths,
  capacity limits, what a control does when tapped, what copy appears on
  failure.
- **A cross-language or cross-artifact contract.** TS ↔ Rust wire types,
  client constants mirroring engine constants, generated artifacts matching
  their generator. These are cheap, fail closed, and catch drift nothing else
  can see. Prefer reading the *shipped source* (Vite `?raw`, `readFile`) over a
  re-export that can be quietly rewired.
- **A previously-shipped bug.** Regression tests are the highest-confidence
  tests in any suite because the failure mode is proven reachable.
- **A ratchet.** A guard over a deferral allowlist that can only shrink. Keep
  these even when the allowlist is empty and the test is temporarily
  unfailable — you would be deleting the mechanism, not an assertion.

## What does not

- **Implementation literals.** Exact hex values, pixel offsets, Tailwind class
  names, canvas coordinates, internal call ordering. These break on harmless
  refactors and pass while the user-visible thing is broken. Assert the
  behavior; if the literal genuinely matters, guard it where it is defined.
- **One-shot repro scaffolding.** A test pinned to the shape of one bug's
  reproduction rather than the rule it violated.
- **Redundant assertions of an already-guarded invariant.** If a drift guard
  byte-compares a generated artifact, a component test does not also need to
  pin its element count.
- **Tests that re-implement the code under test.** Recomputing the SUT's own
  formula and comparing asserts only that `=` works. Write the expectation out
  by hand — see the comment at `src/lib/diceShape.guard.test.ts:89` for the
  standard.
- **Tests that assert what the setup just set.** Asserting a mock returns the
  value you configured, or that a store holds what `beforeEach` put there,
  passes equally against a hardcoded implementation. Flip the input; the
  flipped case is the one with discriminating power.
- **Smoke tests behind real ones.** `getByTestId` throws when a node is
  missing, so a "renders the controls" test adds nothing over the tests that
  click those controls. Likewise "is importable" — `tsc` already covers it.
- **Tests with no assertions.** If the behavior can't be driven in the harness,
  say so in a comment and cover it where it *can* be driven. An empty `it` is a
  green checkmark for work not done.

## Pruning cadence

Prune continuously, and audit when the shape of the suite stops being legible.

- **When a refactor makes a test's subject unrecognizable, prune rather than
  port.** If the code it guarded moved to another language, another process, or
  out of the product, the test does not follow it — the new owner writes its own.
  Porting blindly is how a suite ends up guarding a code path nothing calls.
- **When you delete, leave a breadcrumb.** A short comment saying what covered
  it instead stops the next reader from re-adding it. Every deletion in the
  2026-08 prune did this.
- **When a test's input becomes immutable, it stops being a test.** If a
  stronger gate already forbids the input from changing — the way
  `check:immutable-migration-history` freezes merged migration SQL — assertions
  over that input are permanently green by construction. Keep only the arms that
  read something still mutable.
- **Deletion needs the same rigor as addition.** Delete only what cannot fail,
  is exactly duplicated, or is strictly dominated by a named sibling. Anything
  debatable goes on a list for a human, not into a commit. Where a merge is
  possible, carry the unique assertion forward rather than dropping it.

## E2E policy

Playwright specs are **manual-run only** — CI runs lint, unit tests, build, and
the generator/immutability checks; there is no e2e job. Each suite has its own
`npm run test:e2e:*` script and its own port so they can run concurrently.

- **Run the relevant suite per slice, not per commit.** If your change touches
  the table, the HUD, the roll builder, or dice rendering, run its suite before
  opening the PR and put the result in the PR body. Nobody else will.
- **Extend an existing spec before adding one.** A new spec means a new npm
  script and a new port. Add one only for a genuinely new surface.
- **Every spec must have an npm script.** A spec with no script is unreachable
  through any documented entry point and runs nowhere — it is deleted code that
  still costs review attention. The audit found seven in that state.
- **Prefer web-first assertions to sleeps.** `waitForSelector` /
  `expect(locator)` retry; `waitForTimeout` is a guess that gets slower on CI
  hardware and flakier on fast hardware.
- **E2E covers what unit tests structurally cannot** — real layout geometry,
  real WebGL, real worker/wasm round-trips. Anything expressible as a unit test
  belongs in one.

## Flake policy

**A flaky test is a bug.** It is either a real race in the product or a real
race in the test, and both are worth knowing about.

- Fix it deterministically: inject the clock, await the actual condition, seed
  the RNG, or drive the state machine directly instead of sleeping.
- If it cannot be made deterministic, **delete it** and write down what is no
  longer covered. An unreliable test is worse than none — it trains everyone to
  re-run CI without reading the failure.
- **Never mask with retries.** No `retry` in the Vitest config, no `retries` in
  the Playwright config, no `this.retries()`. Both configs are currently free of
  them; keep it that way.
- **Never mask with `.skip`.** A skipped test is a TODO that reports success.
  The suite currently has zero `.skip` / `.only` / `.todo`; keep it that way.
- Quarantining is not a resting place. If a test is disabled, it has an owner
  and a deadline, or it is deleted.
