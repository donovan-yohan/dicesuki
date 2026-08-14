# Test Suite Audit — 2026-08-01

> Companion to [testing.md](testing.md), which carries the durable policy.
> This file is a dated snapshot: the taxonomy, what was pruned, and what is
> still waiting on a product-owner call. It is not expected to stay current —
> when the next audit runs, replace it.

**Reading the line numbers.** Citations in the *taxonomy* sections (§1–§8)
point at the **as-audited** tree — commit `92996b2` — because that is the tree
that was audited. Citations in *"Deleted in this PR"* also name as-audited
positions, since those lines no longer exist. Anything describing the current
state says so explicitly. If a line number does not resolve, check out
`92996b2` before assuming it drifted.

**Two of this audit's recommendations shipped separately.** #223 acted on the
frozen-migration-grep finding (§3) and the superseded-face-detection finding
(§6) while this branch was in review, and added Frontend-ADR-004 Amendment 1
recording the E2E decision. Those sections are kept as the analysis of record;
the candidate table at the end marks them **DONE** and names the PR. The
numbers below are therefore the *audited* tree, not today's — see "Final
counts" for where things actually landed.

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

## Snapshot (as audited, at `92996b2`)

| | Audited tree |
|---|---|
| Vitest files | 169 |
| Vitest tests | 2,114 |
| Failures | 0 |
| Skipped / `.only` / `.todo` | 0 |
| Playwright spec files | 15 |
| Playwright specs with an npm script | 8 |

Vitest by area (as audited):

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

- `src/config/roomCapacity.guard.test.ts:22`, `'matches MAX_DICE in
  server/core/src/room.rs'`, reads the Rust source via Vite `?raw` and asserts
  the client's `ROOM_DICE_CAPACITY` equals `MAX_DICE`. Anchored per-line so a
  commented-out declaration cannot satisfy it. **This test is the house style.**
  Its file-mate at `:34` is not — see §8; a two-test file can hold one of each,
  which is why this audit cites test sites rather than files wherever the two
  disagree.
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

The bulk and the point of the suite. `src/lib/savedRollPlan.test.ts` (61) and
`src/components/panels/saved-rolls/DiceEntryCard.test.tsx` (47) are
representative: every title names a rule a player can observe.

Tests named for the bug they close are the strongest form and should be imitated:
`src/store/useMultiplayerStore.test.ts:378` (`'room discovery (#79)'`),
`src/lib/roomPreflight.test.ts:4` (`'preflightRoom retry through cold starts (#109)'`),
`src/lib/multiplayerServer.test.ts:78` (`'…(fast-fail, #109)'`).

### 3. Frozen-input source greps — 24 files, 193 tests — ✅ **DONE in #223**

> Resolved via option 2 below: all 14 zero-mutable-input files were deleted.
> The 10 mixed files stay, keeping the arms that read live code. Analysis
> retained as the record of why.

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

Counting inputs per file: **14 of 24 files (116 tests) read no mutable file at
all** — `0005`, `0009`–`0020` inclusive, plus `0004`. They are permanently green
by construction. The other 10 keep teeth because they also read live code
(`src/lib/pullRpc.ts`), the behavioral SQL harness (`supabase/tests/*.test.sql`,
not covered by the immutability gate), or `economy/production/editions/*.json`.

`0004_collectible_catalog.test.ts` (8 tests) belongs in the frozen set for a
second reason worth stating separately: its non-migration input,
`supabase/catalog/collectible_catalog_v1.sql`, is frozen by a *different* gate —
`scripts/check-immutable-catalog-history.js:86` adds that exact path to the
immutable set, and CI runs it at `.github/workflows/ci.yml:32`, also ahead of
`npm test`. Both of its inputs are therefore locked by checks that fail first.

This audit did not delete them — 116 tests of economy auditability was a PO
call. Three options were put forward, in preference order:

1. **Keep only the cross-file arms.** Delete the self-referential greps, retain
   every assertion that reads a mutable file. Preserves all live drift
   protection, removes ~116 permanently-green tests.
2. **Delete the 14 pure files, keep the 10 mixed ones.** Simplest to execute.
3. **Keep everything** as executable documentation of what each migration
   guarantees, and accept that they are prose with a green checkmark.

**#223 took option 2**: `0004`, `0005`, and `0009`–`0020` are gone; the 10 files
with live inputs remain. The `supabase/tests/*.test.sql` harness that actually
exercises these migrations against Postgres is untouched.

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

### 6. Superseded subject — a whole cluster — ✅ **DONE in #223**

> The client's `getDiceFaceValue()`, the 7 per-shape specs and
> `dice-faces.helpers.ts` are gone; `DiceFaceTestHarness` was retained in
> slimmed form so `e2e/basic-dice.spec.ts` can sample real composited pixels.
> Recorded as **Frontend-ADR-004 Amendment 1**, which also promotes this
> audit's "every spec needs a script" rule to a MUST. #223 found something this
> audit missed and worth recording: `validateDiceFace` compared two readouts the
> harness derived from the *same* normals table, and the screenshot-grid tests
> wrote PNGs with no comparison at all — so the specs were weaker than "template
> clones of a real check", they were not checking anything.

`getDiceFaceValue` (`src/lib/geometries.ts:212`) is **client-side face
detection**. Shared-ADR-005 moved face detection into the Rust core
(`server/core/src/face_detection.rs:16`, `detect_face_value`, 7 tests), and
Frontend-ADR-001 says client-side face detection "MUST NOT be reintroduced."

Its only non-test consumer is `src/components/test/DiceFaceTestHarness.tsx:81`,
a route mounted at `/test/dice-faces` in `src/App.tsx:96` purely so the e2e
face specs have something to drive. In other words: production code that exists
only to be tested, implementing an algorithm the room no longer consults.

Around it sit:

- **70** orientation tests in `src/lib/geometries.test.ts` — one per face across
  all seven shapes (4+6+8+10+10+12+20). The block's own header comment says
  "Total: … = 60"; that comment is wrong, it forgets `d10tens`.
- 7 Playwright specs (`e2e/dice-faces-d{4,6,8,10,10tens,12,20}.spec.ts`), 28
  parameterized cases, which are **template clones** differing only in `TYPE`
  and `FACE_COUNT`. Until this PR they had **no npm script** while every other
  e2e spec had one (`test:e2e:solo`, `test:e2e:roll-picker`, …). A bare
  `npx playwright test` does still collect them — so they were not literally
  unreachable, just absent from every documented workflow, which is how they
  went unnoticed. This PR wires them to a single stopgap script,
  `test:e2e:dice-faces`, so the new policy guard has a true tree to check; see
  the merge-order note below.

Recommendation was: retire the client-side detector, its harness route, the 7
orphaned specs, and the TS orientation tests in one slice, since the
authoritative implementation and its tests already live in core. **#223 did
exactly that**, and went further by keeping a slimmed harness so
`e2e/basic-dice.spec.ts` samples real pixels — better than deletion, because the
one thing E2E was uniquely able to check is now actually checked.

> **Merge-order dependency — resolved.** This branch briefly carried a stopgap
> `test:e2e:dice-faces` script so its policy guard had a true tree to check.
> #223 landed first and deleted those specs, so the stopgap was dropped during
> the rebase. The guard's script check now holds against the real spec set with
> nothing artificial propping it up: 9 specs, 9 scripts, including
> `roll-history.spec.ts` newly added by #228.

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

`src/config/roomCapacity.guard.test.ts:34` is the sharpest example because it
sits inside an otherwise-exemplary guard: `'builds the shared over-capacity copy
from the constant'` asserts `ROLL_DICE_CAPACITY_MESSAGE` equals
`` `Rolls are limited to ${ROOM_DICE_CAPACITY} dice` `` — the template the source
already uses. Cite `:22` when quoting this file as house style, never `:34`.

`src/lib/diceShape.guard.test.ts:89` is the counter-example and the standard to
copy — it writes the expectation out by hand and says why:

> INDEPENDENTLY WRITTEN expectation — deliberately NOT `D10_FACE_NORMALS` mapped
> ×10, which is how the implementation builds the table. A derived expectation
> would be tautological.

## Deleted by this audit — 106 tests identified, 30 unique after rebase

The prune was authored against `92996b2` and removed 106 tests across 15 files.
#223 then landed independently and deleted a superset of the face-detection
rows, so **76 of those 106 are now attributable to #223**, not to this branch.
The table below records what the audit found; the "after rebase" column says who
actually removed it. Net effect of this branch on top of `origin/main` is at the
bottom.

Only cases that cannot fail, are exactly duplicated, or are strictly dominated by
a sibling. Every merge carried the removed assertion forward.

| Site | Tests | After rebase | Why |
|---|---|---|---|
| `src/lib/faceMaterialMapping.test.ts:317` | 70 | **#223** | Verbatim duplicate of `geometries.test.ts:177` — same loop, same targets, same assertion. `getFaceNormals(shape)` returns the very arrays that file's `FACE_NORMALS_BY_SHAPE` holds. #223 deleted the same block as part of retiring `getDiceFaceValue`. |
| `src/lib/geometries.test.ts` (6 sites) | 8 | 2 here, 6 **#223** | Six single-orientation d6 tests each rebuilt the exact quaternion and asserted the exact value already covered line-for-line by the consolidated `'should match BoxGeometry material indices'` — all six went with #223's removal of the detector. The two structural duplicates of the all-shapes loop are this branch's. |
| `src/store/useDiceStore.test.ts:9,271` | 5 | here | `initial state` asserted post-`reset()` defaults with nothing between `beforeEach`'s `reset()` and the assertion. The `reset` suite asserts the same five fields *after* real mutation. |
| `src/lib/multiplayerMessages.test.ts` (3 sites) | 4 | here | `JSON.parse` of a literal, then reading `.type` back out. `JSON.parse` returns `any`, so the `: ServerMessage` annotation checks nothing at compile time, and `.type` exists on every variant — no narrowing proven. |
| `src/lib/faceRenderers/d4Renderer.test.ts` (2 sites) | 4 | here | Three data tests subsumed by one `toEqual` against the exact sorted complement; a call-count test subsumed by the same. |
| `src/components/DeviceMotionButton.test.tsx` (2 sites) | 2 | here | `'should show shake indicator when shaking'` had **zero `expect` calls**. `'should have distinct styling for each state'` asserted `className` contains `'bg-'` twice without ever comparing them. |
| `src/components/icons/DiceIconWithNumber.test.tsx` (2 sites) | 2 | here | Single-digit case byte-identical to a sibling modulo the literal; centring covered by the every-type `it.each` (merged its unique `flex` assertion in). |
| `src/lib/haptics.test.ts` (2 sites) | 2 | here | Ascending-order test already asserted inverted by the two above it; `vibrate(50)` walked the same branch-free path as `vibrate(100)`. |
| `src/hooks/useHapticFeedback.test.ts` (2 sites) | 2 | here | Each asserted the value `beforeEach` had just set, so both passed for a hook that hardcoded `true`. **Correction on review:** deleting the `isSupported` true-direction case left only the `false` assertion, which would ship a hardcoded-`false` regression green and hide the Settings haptics toggle. Both directions were restored into one case, `'should mirror navigator.vibrate support in both directions'`. |
| `src/lib/multiplayerServer.test.ts` (2 sites) | 2 | here | Weaker copies of retry-suite tests; merged their unique `command: null` assertion into the survivors. |
| `src/components/icons/DiceIcon.test.tsx:49` | 1 | here | Strict subset of the `it.each` that renders every type with no `size` prop. |
| `src/components/layout/TableHud.test.tsx:125` | 1 | here | Identical render (`isOverlayOpen: false` is the default) and identical assertion to `:83`. |
| `src/components/multiplayer/RoomShare.test.tsx:41` | 1 | here | `getByTestId` throws when absent, so all three controls are already proven by the tests that click them. **Correction on review:** the surviving `'labels the share button for native share'` only covers the `navigator.share` path, so the desktop fallback copy went uncovered. A `'Copy to share'` case was added back for the no-native-share path. |
| `src/lib/percentileRolls.test.ts:263` | 1 | here | Tautology: `geometries.ts:127` *builds* the table with `D10_FACE_NORMALS.map(f => ({ value: f.value * 10, normal: f.normal }))`, so `.map` guarantees the length, the value is the product by construction, and `normal` is the same object reference. |
| `src/hooks/useSnapshotInterpolation.test.ts` | 1 | here | Whole file: `expect(mod.useSnapshotInterpolation).toBeDefined()`. Cannot fail for any reason `tsc` would not already catch. |

Where a deletion removed the only occurrence of an assertion, a comment was left
in place explaining what moved and where — so the next reader does not
re-add it.

Two further corrections came out of review, both cases of a deletion that was
individually defensible costing coverage the audit had not accounted for:

- **d6 normal precision.** Folding the d6-specific unit-length test into the
  all-shapes loop adopted that loop's `toBeCloseTo(1.0, 3)`, silently
  downgrading d4/d6/d8/d10/d12 from 5 decimal places to 3. The loop now carries
  a per-shape `unitLengthPrecision` map: 5 everywhere, 3 only for d20, which is
  the sole shape whose stored components are rounded.
- **Breadcrumb completeness.** The `multiplayerMessages` breadcrumb named three
  of the four removed cases; the `'presence and removal lifecycle'` case
  (covering `player_presence_changed` and `removed_from_room`) was missing from
  it and has been added.

The general lesson, now in [testing.md](testing.md): a merge is only lossless if
you diff the *assertions*, not the test names.

## Enforcement added

This audit's own policy would be doctrine without a gate, so
`src/test/testPolicy.guard.test.ts` (4 tests) fails the build on the three rules
that are mechanically checkable:

- every `e2e/*.spec.ts` appears in some `package.json` script
- no `.skip` / `.only` / `.todo` / `.fails` anywhere in test sources
- neither `vite.config.ts` nor `playwright.config.ts` declares `retries`

Plus a scanner-sanity check (`> 100` files walked) so a broken walker fails
loudly instead of passing vacuously — the same shape as
`contrast.source.guard.test.ts:61`.

Negative control, run at authoring time:

| Injected violation | Result |
|---|---|
| `describe.only` in `src/lib/qrCode.test.ts` | fails `'has no skipped, focused, or todo tests'`, naming the file |
| removed `test:e2e:d100` script | fails `'gives every e2e spec an npm script'`, naming the spec |
| `retries: 2` in `playwright.config.ts` | fails `'declares no retries in either runner config'`, naming the config |

Each fired in exactly one assertion; all reverted, guard green.

## Order dependence found by the shuffle run

Running the suite with `--sequence.shuffle` surfaced **pre-existing order
dependence that the default declaration order hides**. This is not caused by the
prune — the files involved are byte-identical to the branch point
(`git diff 92996b2 -- <file>` is empty).

`src/components/multiplayer/PlayerPanel.test.tsx` fails **14 of its 17 tests**
under `npx vitest run --sequence.shuffle --sequence.seed=3`, *running that file
alone*. Seeds 1 and 2 pass. The three survivors are the `connectionIndicator`
pure-function tests; every test that renders fails, with the roster stuck in its
pre-animation state:

```
data-testid="player-roster"  style="… opacity: 0; transform: translateX(100px);"
TestingLibraryElementError: Unable to find an element with the text: Alice
```

Because it reproduces in isolation, this is intra-file: some test leaves state
that the others depend on not being there, and declaration order happens to put
the damage last. Root cause not pinned — it is another owner's file — but the
two candidates are the framer-motion enter transition at `PlayerPanel.tsx:96`
never completing, and the `afterEach` at `PlayerPanel.test.tsx:318` calling
`vi.restoreAllMocks()`, which tears down the `vi.fn()` globals that
`src/test/setup.ts:15` installs once per file. Note the sibling `describe`
blocks all pair `reset()` with `reset()`; that one pairs `reset()` with
`restoreAllMocks()`.

`src/components/panels/InventoryPanel.test.tsx > only mounts previews for the
visible dice window` also failed once across eight full shuffled runs and did
not reproduce at the same seed, which makes it a lower-frequency, probably
load-sensitive flake rather than an ordering bug.

**Confirmed pre-existing after the rebase.** Running the same seeds on
`origin/main` and on this branch gives byte-identical failure counts, in the
same single file:

| Seed | `origin/main` | this branch |
|---|---|---|
| 11 | 8 failed / 1,875 passed | 8 failed / 1,850 passed |
| 22 | 11 failed / 1,872 passed | 11 failed / 1,847 passed |

`PlayerPanel.test.tsx` is the only file that fails, on either tree, at every
seed tried. The prune neither caused nor worsened it.

**Not fixed here** — both are outside this slice. Recommended as a follow-up
slice, because per the flake policy these are bugs, and because order dependence
is exactly the failure that a future `--sequence.shuffle` in CI would need
cleared first. The policy guard deliberately does *not* assert shuffle-safety:
it would fail on day one, and a guard that ships red teaches people to ignore
guards.

> **Resolved (issue #224).** Both candidates guessed above were wrong. The
> framer-motion `opacity: 0; translateX(100px)` in the failure dump is just the
> unadvanced jsdom initial state — it is present in *passing* runs too, and no
> assertion depends on it. `vi.restoreAllMocks()` is also innocent: under Vitest
> 4 it restores only `vi.spyOn` spies, and a probe confirmed the `vi.fn()` canvas
> mock from `src/test/setup.ts:15` survives it.
>
> The actual contaminant was `serverUrl`. `useMultiplayerStore.reset()`
> deliberately preserves it — it is connection config, not room state, so
> leaving a room must not forget which server the client is pointed at. The
> per-`describe` `beforeEach(reset)` therefore could not restore it. (That
> contract is now commented at the `reset()` call site and pinned by the
> "reset preserves serverUrl" store test, which previously had no backpressure:
> deleting the line left the whole suite green.) `PlayerPanel solo vs live room > shows the go-online controls …`
> sets `serverUrl` to the `worker://solo` sentinel; every test scheduled after it
> then rendered PlayerPanel's solo branch and lost the live-room controls it
> asserts on. In declaration order that test is second-to-last and the last test
> overwrites `serverUrl`, which is why the file looked clean. Test bug, not a
> product bug. Fixed by pinning `serverUrl` in a file-level `beforeEach`/
> `afterEach`; CI now runs a pinned-seed shuffled pass to keep it fixed.

## Candidates

### Shipped

| # | Candidate | Size | Outcome |
|---|---|---|---|
| 1 | Frozen-input migration greps (§3) | 116 tests, 14 files | ✅ **DONE — #223** took option 2: `0004`, `0005`, `0009`–`0020` deleted; the 10 files with live inputs kept. |
| 2 | Client-side face-detection cluster (§6) | 7 e2e files + 70 unit tests + prod code | ✅ **DONE — #223** removed `getDiceFaceValue()`, the per-shape specs and `dice-faces.helpers.ts`; kept a slimmed `/test/dice-faces` harness so `basic-dice.spec.ts` samples real pixels. Recorded as **Frontend-ADR-004 Amendment 1**. |
| 3 | Orphaned e2e specs | 7 files | ✅ **DONE — #223.** Every surviving spec now has a script (9/9), enforced by `testPolicy.guard.test.ts` and required by Amendment 1. |

### Still open — PO decision

| # | Candidate | Size | Risk if pruned |
|---|---|---|---|
| 4 | Icon suites rewrite (`DiceIcon`, `DiceIconWithNumber`) | ~34 tests | **Medium.** Heavy class/px pinning; a rewrite toward behavior is better than deletion. |
| 5 | Canvas final-state assertions → draw-time recording (§4) | ~10 tests | **Low.** Mechanical; `basicFaceRenderers.test.ts:34` is the template. |
| 6 | Merge `dataSync.slice13.test.ts` into `dataSync.test.ts` | 1 test, 1 file | **None.** Pure move. |
| 7 | Move `ShopPanel.test.tsx:318` `LUNAR_PASS_OFFER` pin to the economy guards | 1 test | **None.** |
| 8 | Collapse `useEnvironmentTheme` / `registry` overlap (§7) | 3 tests | **Low.** |
| 9 | Fix the `PlayerPanel` order dependence, then consider `sequence.shuffle` in CI | 1 file, 17 tests affected | **None** — it is a bug fix. Blocks any future shuffle gate. |

## Final counts

Measured on the rebased branch against `origin/main` (which already contains
#223, #225, #227, #228):

| | `origin/main` | this branch |
|---|---|---|
| Vitest tests | 1,883 | **1,858** |
| Vitest files | 156 | **156** |
| Failures | 0 | 0 |
| Playwright specs / with a script | 9 / 9 | 9 / 9 |

Net **−25**: 30 tests removed, 5 added (4 in `testPolicy.guard.test.ts`, 1
restoring the `RoomShare` fallback). File count is flat —
`useSnapshotInterpolation.test.ts` deleted, `testPolicy.guard.test.ts` added.

Per file, versus `origin/main`:

```
 -5  src/store/useDiceStore.test.ts        -2  src/components/DeviceMotionButton.test.tsx
 -4  src/lib/multiplayerMessages.test.ts   -2  src/components/icons/DiceIconWithNumber.test.tsx
 -4  src/lib/faceRenderers/d4Renderer.ts   -2  src/hooks/useHapticFeedback.test.ts
 -2  src/lib/geometries.test.ts            -2  src/lib/haptics.test.ts
 -2  src/lib/multiplayerServer.test.ts     -1  src/components/icons/DiceIcon.test.tsx
 -1  src/components/layout/TableHud.test.tsx
 -1  src/lib/percentileRolls.test.ts
 -1  src/hooks/useSnapshotInterpolation.test.ts   [file deleted]
 +4  src/test/testPolicy.guard.test.ts            [file added]
```

`faceMaterialMapping.test.ts` and `RoomShare.test.tsx` show no delta — the
former because #223's deletion superseded this branch's identical one, the
latter because one test was removed and one added back.

## Verification

Rebased onto `origin/main` at `643331a` (#223, #225, #227, #228).

```
vitest   1,858 passed / 0 failed / 156 files   (origin/main: 1,883 / 0 / 156)
tsc      No errors found
eslint   exit 0
build    exit 0
guard    4/4, all three negative controls fire
e2e      9 specs, 9 npm scripts
```

Shuffled runs (`--sequence.shuffle`) are **not** clean — see "Order dependence
found by the shuffle run" above. That is pre-existing and tracked as a
follow-up, not a gate this PR claims. *(Cleared afterwards by issue #224: the
suite is now shuffle-clean and CI asserts it at a pinned seed. See the Resolved
note in that section.)*

The obsolete PWA icon generator that caused the historical lint discrepancy has
been removed; `npm run lint` is the supported lint gate.
