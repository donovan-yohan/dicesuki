# Test Suite Audit — 2026-08-01

> Companion to [testing.md](testing.md), which carries the durable policy.
> This file is a dated snapshot: the taxonomy, what was pruned, and what is
> still waiting on a product-owner call. It is not expected to stay current —
> when the next audit runs, replace it.

## Why this exists

The suite went from 666 to 2,114 Vitest tests in roughly one week of
agent-driven development. Growth that fast is not self-evidently good: a test
that proved a slice correct *while it was being written* is not automatically a
test worth carrying forever. This audit separates the two and prunes the clear
cases.

Test files by date added (`git log --diff-filter=A`):

| Window | Files added | Cumulative |
|---|---|---|
| 2025-11 → 2026-03 | 22 | 22 |
| 2026-07-03 → 07-12 | 20 | 42 |
| 2026-07-13 → 07-18 | 82 | 124 |
| 2026-07-22 → 08-01 | 64 | 188 |

166 of 188 test files — 88% — were written in the last month.

## Snapshot

| | Before | After |
|---|---|---|
| Vitest files | 169 | 168 |
| Vitest tests | 2,114 | 2,008 |
| Failures | 0 | 0 |
| Skipped / `.only` / `.todo` | 0 | 0 |
| Playwright spec files | 15 | 15 |

Vitest by area (post-prune):

| Area | Files | Tests |
|---|---|---|
| `src/lib` | 54 | 785 |
| `src/components` | 43 | 441 |
| `supabase/migrations` | 24 | 193 |
| `src/store` | 11 | 173 |
| `scripts` | 9 | 144 |
| `supabase/functions` | 6 | 87 |
| `src/hooks` | 11 | 63 |
| `src/themes` | 3 | 59 |
| `src/config` | 5 | 47 |
| `src/App`, `src/contexts` | 2 | 3 |

Playwright is manual-run only — CI runs `lint`, `test`, `build` plus the
generator/immutability checks, and no e2e job.

## Taxonomy

### 1. Invariant / contract guards — 12 files, keep

The highest value-per-line in the repo. Cheap, fail closed, and catch a class of
drift no behavioral test can see.

- `src/config/roomCapacity.guard.test.ts:25` reads `server/core/src/room.rs`
  via Vite `?raw` and asserts the client's `ROOM_DICE_CAPACITY` equals Rust's
  `MAX_DICE`. Anchored per-line so a commented-out declaration cannot satisfy it.
- `src/lib/spawnSchema.guard.test.ts:63` asserts `basic?: boolean` exists on the
  TS wire type *and* `pub basic: Option<bool>` on the Rust struct — plus
  `skip_serializing_if` at `:70`, because without it every ordinary die echoes
  `"basic":null`.
- `src/themes/contrast.source.guard.test.ts` scans component source for accent
  fills labelled with anything but `onAccent`. Its header explains why it exists:
  the sibling `contrast.guard.test.ts` proves every *declared* pairing is
  legible, and "eight live accent-filled controls kept painting `text.primary`
  on `accent` through a green suite."
- `src/lib/collectibleCatalog.guard.test.ts` regenerates the catalog artifact and
  byte-compares the committed JSON/SQL plus a SHA-256.

`contrast.source.guard.test.ts:81` deserves its own mention as a pattern:
`'every deferred file still exists and still violates'` is a **ratchet** over the
deferral allowlist, so the allowlist can only shrink. `DEFERRED` is currently
`[]`, which means the test cannot fail today — but deleting it removes the
mechanism, not just an assertion. Keep ratchets even when slack.

### 2. Behavioral regression — ~107 files, keep

The bulk and the point of the suite. `src/lib/savedRollPlan.test.ts` (61),
`src/components/panels/saved-rolls/DiceEntryCard.test.tsx` (47),
`src/lib/rollEngine.test.ts` (17: keep/drop, reroll, explode, clamp, success
counting) are representative: every title names a rule a player can observe.

Tests named for the bug they close are the strongest form and should be imitated:
`src/store/useMultiplayerStore.test.ts:378` (`'room discovery (#79)'`),
`src/lib/roomPreflight.test.ts:4` (`'preflightRoom retry through cold starts (#109)'`),
`src/lib/multiplayerServer.test.ts:78` (`'…(fast-fail, #109)'`).

### 3. Frozen-input source greps — 24 files, 193 tests, **decision needed**

Each `supabase/migrations/NNNN_*.test.ts` reads its own `.sql` with
`readFile` and asserts regexes over the text. Example,
`supabase/migrations/0030_earned_economy_rare_pity_10.test.ts:77`:

```ts
expect(sql).toMatch(
  /source_banner\.rare_hard_guarantee_pull is distinct from 8[\s\S]*?epic_hard_guarantee_pull is distinct from 25/i,
)
```

These were genuine slice validation — while `0030` was being authored, the
migration was mutable and the grep had teeth. After merge it does not.
`scripts/check-immutable-migration-history.js:114` freezes every `.sql` present
at the merge base:

```
Published Supabase migrations are immutable; restore these merge-base files
and append a new migration instead
```

and CI runs that check at `.github/workflows/ci.yml:29`, **before** `npm test` at
`:51`. So for an already-merged migration, the only input these assertions read
cannot change, and a stronger, cheaper gate fails first if anyone tries.

Counting inputs per file: **13 of 24 files (108 tests) read no mutable file at
all** — `0005`, `0009`–`0020` inclusive. They are permanently green by
construction. The other 11 keep teeth because they also read live code
(`src/lib/pullRpc.ts`), the behavioral SQL harness (`supabase/tests/*.test.sql`,
not covered by the immutability gate), or `economy/production/editions/*.json`.

Not deleted here — this is 108 tests of economy auditability and the PO owns that
call. Three options, in preference order:

1. **Keep only the cross-file arms.** Delete the self-referential greps, retain
   every assertion that reads a mutable file. Preserves all live drift
   protection, removes ~108 permanently-green tests.
2. **Delete the 13 pure files, keep the 11 mixed ones.** Simplest to execute.
3. **Keep everything** as executable documentation of what each migration
   guarantees, and accept that they are prose with a green checkmark.

Note that real behavioral coverage for these migrations already runs against
live Postgres via `npm run test:db:supabase` (`supabase/tests/*.test.sql`,
CI `:49`) — that is where a broken migration actually gets caught. A CHECK-
constraint bug caught by that harness is already recorded in `CLAUDE.md`.

### 4. Implementation pinning — ~6 files, mostly keep-with-prejudice

Asserts internal literals rather than behavior; breaks on harmless refactors.

- `src/components/icons/DiceIconWithNumber.test.tsx:163` pins
  `textShadow: '0 1px 2px rgba(0,0,0,0.3)'` and the class `text-theme-text`.
  Contrast is already gated by `src/themes/contrast.guard.test.ts` over the live
  registry, which is the assertion that actually protects legibility.
- `src/lib/faceRenderers/d10Renderer.test.ts:43` pins six canvas coordinates
  (`20.48`, `450.56`, `491.52`, `61.44`). Any retune of the kite inset breaks it,
  and no visual assertion sits behind it.
- `src/components/layout/BottomNav.test.tsx:65` pins `left: '50%'`,
  `width: '70px'`, `marginLeft: '-35px'`. The test's own comment concedes
  `e2e/hud-layout.spec.ts` measures the real geometry.
- `src/lib/faceRenderers/d4Renderer.test.ts:171` and
  `src/lib/textureRendering.test.ts:68` assert the canvas context's *final
  mutable state* (`expect(mockCtx.fillStyle).toBe('white')`) rather than what was
  drawn — so they pass or fail on statement ordering inside the renderer.
  `src/lib/faceRenderers/basicFaceRenderers.test.ts:34` shows the correct
  pattern: record state at draw time.

These are rewrite candidates, not delete candidates — the subject is real, the
assertion is aimed wrong.

### 5. Scaffolding residue

- `src/lib/dataSync.slice13.test.ts` — one test, named for a slice that no longer
  exists, carrying a 30-line duplicate fake client that `src/lib/dataSync.test.ts:34`
  already defines better. Its assertion (sign-in reads 7 economy tables) is real
  and covered nowhere else. **Merge into `dataSync.test.ts`; do not delete.**
- `src/lib/paymentsConfig.test.ts:31` — `it('is sandbox-only in this slice')`
  asserts `isPaymentsSandbox() === true` unconditionally. A slice-lifetime pin:
  it will not fail loudly when production payments land, it will just have to be
  edited. Either delete or convert to a guard that reads the config source.

### 6. Superseded subject — a whole cluster, **decision needed**

`getDiceFaceValue` (`src/lib/geometries.ts:212`) is **client-side face
detection**. Shared-ADR-005 moved face detection into the Rust core
(`server/core/src/face_detection.rs:16`, `detect_face_value`, 7 tests), and
Frontend-ADR-001 says client-side face detection "MUST NOT be reintroduced."

Its only non-test consumer is `src/components/test/DiceFaceTestHarness.tsx:81`,
a route mounted at `/test/dice-faces` in `src/App.tsx:96` purely so the e2e
face specs have something to drive. In other words: production code that exists
only to be tested, implementing an algorithm the room no longer consults.

Around it sit:

- ~60 orientation tests in `src/lib/geometries.test.ts:177`
- 7 Playwright specs (`e2e/dice-faces-d{4,6,8,10,10tens,12,20}.spec.ts`), 28
  parameterized cases, which are **template clones** differing only in `TYPE`
  and `FACE_COUNT` — and which have **no npm script**. Every other e2e spec has
  one (`test:e2e:solo`, `test:e2e:roll-picker`, …). These are unreachable
  through any documented entry point and run in no CI job.

Recommendation for PO: retire the client-side detector, its harness route, the
7 orphaned specs, and the TS orientation tests in one slice; the authoritative
implementation and its tests already live in core. Left alone here because
deleting production code exceeds a testing-strategy PR.

### 7. Duplicative coverage

Same invariant asserted in several places. The largest instance was deleted (see
below). Remaining, all debatable:

- `src/hooks/useEnvironmentTheme.test.ts` (3) vs `src/themes/registry.test.ts:8,14,20`
  (3) — identical case set; the hook version adds provider wiring.
- `src/config/starterDice.test.ts:92` vs `src/store/useInventoryStore.serverCopies.test.ts:114`
  — same `syncServerCopies({}, COLLECTIBLE_CATALOG)` scenario.
- `src/components/panels/PullDicePreview.test.tsx:68` and
  `src/components/panels/SharedInventoryDicePreviewCanvas.test.tsx:146` both
  re-assert `renderLod`'s `128 / 'reduced' / 'reduced'` literals, which
  `src/lib/renderLod.test.ts:58` owns. Prop-forwarding is the real subject.
- `src/components/panels/ShopPanel.test.tsx:318` pins the PO-locked
  `LUNAR_PASS_OFFER` economics inside a *rendering* suite. Belongs with the
  economy guards.
- The brand wordmark `src` is asserted in three files (`SoloRoom.test.tsx:25`,
  `RoomBrowser.test.tsx:71`, `StartupSplash.test.tsx:14`).

### 8. Tests that re-implement the code under test

A recurring smell worth naming, because it reads as thorough and asserts
nothing. `src/config/arenaFit.test.ts:9` recomputes
`(2 * 8) / FILL / (2 * Math.tan(halfFovV))` — the SUT's own formula.
`src/components/layout/hudLayout.test.ts:60` asserts
`lane.scrollable === (DICE_TOOLBAR_NATURAL_HEIGHT > lane.maxHeight)` using the
`maxHeight` the SUT just returned. `src/config/roomCapacity.guard.test.ts:34`
rebuilds the message template verbatim.

`src/lib/diceShape.guard.test.ts:89` is the counter-example and the standard to
copy — it writes the expectation out by hand and says why:

> INDEPENDENTLY WRITTEN expectation — deliberately NOT `D10_FACE_NORMALS` mapped
> ×10, which is how the implementation builds the table. A derived expectation
> would be tautological.

## Deleted in this PR — 106 tests across 15 files

Only cases that cannot fail, are exactly duplicated, or are strictly dominated by
a sibling. Every merge carried the removed assertion forward.

| Site | Tests | Why |
|---|---|---|
| `src/lib/faceMaterialMapping.test.ts:317` | 70 | Verbatim duplicate of `geometries.test.ts:177` — same loop, same targets, same assertion. `getFaceNormals(shape)` returns the very arrays that file's `FACE_NORMALS_BY_SHAPE` holds. |
| `src/lib/geometries.test.ts` (6 sites) | 8 | Six single-orientation d6 tests each rebuilt the exact quaternion and asserted the exact value already covered line-for-line by the consolidated `'should match BoxGeometry material indices'`. Two structural tests duplicated the all-shapes loop at `:212`. |
| `src/store/useDiceStore.test.ts:9,271` | 5 | `initial state` asserted post-`reset()` defaults with nothing between `beforeEach`'s `reset()` and the assertion. The `reset` suite asserts the same five fields *after* real mutation. |
| `src/lib/multiplayerMessages.test.ts` (3 sites) | 4 | `JSON.parse` of a literal, then reading `.type` back out. `JSON.parse` returns `any`, so the `: ServerMessage` annotation checks nothing at compile time, and `.type` exists on every variant — no narrowing proven. |
| `src/lib/faceRenderers/d4Renderer.test.ts` (2 sites) | 4 | Three data tests subsumed by one `toEqual` against the exact sorted complement; a call-count test subsumed by the same. |
| `src/components/DeviceMotionButton.test.tsx` (2 sites) | 2 | `'should show shake indicator when shaking'` had **zero `expect` calls**. `'should have distinct styling for each state'` asserted `className` contains `'bg-'` twice without ever comparing them. |
| `src/components/icons/DiceIconWithNumber.test.tsx` (2 sites) | 2 | Single-digit case byte-identical to a sibling modulo the literal; centring covered by the every-type `it.each` (merged its unique `flex` assertion in). |
| `src/lib/haptics.test.ts` (2 sites) | 2 | Ascending-order test already asserted inverted by the two above it; `vibrate(50)` walked the same branch-free path as `vibrate(100)`. |
| `src/hooks/useHapticFeedback.test.ts` (2 sites) | 2 | Each asserted the value `beforeEach` had just set, so both passed for a hook that hardcoded `true`. The flipped-input siblings have the discriminating power. |
| `src/lib/multiplayerServer.test.ts` (2 sites) | 2 | Weaker copies of retry-suite tests; merged their unique `command: null` assertion into the survivors. |
| `src/components/icons/DiceIcon.test.tsx:49` | 1 | Strict subset of the `it.each` that renders every type with no `size` prop. |
| `src/components/layout/TableHud.test.tsx:125` | 1 | Identical render (`isOverlayOpen: false` is the default) and identical assertion to `:83`. |
| `src/components/multiplayer/RoomShare.test.tsx:41` | 1 | `getByTestId` throws when absent, so all three controls are already proven by the tests that click them. |
| `src/lib/percentileRolls.test.ts:263` | 1 | Tautology: `geometries.ts:127` *builds* the table with `D10_FACE_NORMALS.map(f => ({ value: f.value * 10, normal: f.normal }))`, so `.map` guarantees the length, the value is the product by construction, and `normal` is the same object reference. |
| `src/hooks/useSnapshotInterpolation.test.ts` | 1 | Whole file: `expect(mod.useSnapshotInterpolation).toBeDefined()`. Cannot fail for any reason `tsc` would not already catch. |

Where a deletion removed the only occurrence of an assertion, a comment was left
in place explaining what moved and where — so the next reader does not
re-add it.

## Open candidates — PO decision

Ordered by size of the prize.

| # | Candidate | Size | Risk if pruned |
|---|---|---|---|
| 1 | Frozen-input migration greps (§3), option 1 or 2 | ~108 tests, up to 13 files | **Low.** Immutability gate + live-Postgres SQL harness both still run. Loses human-readable per-migration prose. |
| 2 | Client-side face-detection cluster (§6) | 7 e2e files (28 cases) + ~60 unit tests + prod code | **Low-medium.** Core owns detection and tests it. Requires deleting `geometries.ts:212`, the harness component, and the `/test/dice-faces` route together — a production slice, not a test-only change. |
| 3 | Orphaned e2e specs alone, without touching prod code | 7 files | **Low.** No npm script, no CI job, unreachable today. Deleting them changes nothing that runs. |
| 4 | Icon suites rewrite (`DiceIcon`, `DiceIconWithNumber`) | ~37 tests | **Medium.** Heavy class/px pinning; a rewrite toward behavior is better than deletion. |
| 5 | Canvas final-state assertions → draw-time recording (§4) | ~10 tests | **Low.** Mechanical; `basicFaceRenderers.test.ts:34` is the template. |
| 6 | Merge `dataSync.slice13.test.ts` into `dataSync.test.ts` | 1 test, 1 file | **None.** Pure move. |
| 7 | Move `ShopPanel.test.tsx:318` `LUNAR_PASS_OFFER` pin to the economy guards | 1 test | **None.** |
| 8 | Collapse `useEnvironmentTheme` / `registry` overlap (§7) | 3 tests | **Low.** |

## Verification

```
vitest   2,008 passed / 0 failed / 168 files   (was 2,114 / 0 / 169)
tsc      No errors found
eslint   exit 0
build    exit 0  (vite build + PWA precache 27 entries)
```
