# Slice 14 Report — Rev 2

## Summary and status

**Status: IMPLEMENTED; final targeted tests, lint, runnable full suite, and
production build pass on the exact working tree. The exact unfiltered
full-suite command is sandbox-limited only in three pre-existing nested-git
guard files.**

Slice 14 now provides the three authenticated-only economy surfaces:

1. A compact bottom-right Wallet HUD above the bottom-control lane with Stars,
   Dust, standard tickets, optional nonzero premium tickets, and stale-state
   disclosure only after the mounted user has produced a fresh wallet snapshot.
2. Exact `×N` live-copy badges plus an exact static recent-first-copy marker in
   the authenticated server-copy inventory view.
3. A Shop panel with the free 160 Stars → 1 standard-roll conversion flow,
   quantity controls bounded by affordability and the RPC maximum of 100,
   pending/success/error feedback, and the six disabled PO-locked coming-soon
   bundle cards while payments are off.

The Shop navigation entry is shown only to authenticated users when payments
or the already-shipped free conversion are available. Guest navigation and
guest/local inventory cards are unchanged.

No 3D scene logic, edge function, purchase path, migration, or unrelated
store/lib surface changed. No commit was created.

## Preserved rev-1 blocker note and amendment resolution

Rev 1 correctly stopped with **Status: BLOCKED**. The raw `DiceCopy` snapshot
contained `isFirstCopy`, but `mapServerCopiesToInventoryDice` discarded it.
Inferring first-copy status from the oldest live acquisition was unsafe because
the true first copy can be scrapped while a later non-first copy remains live.
A second component-local fetch could also diverge from the active inventory
snapshot.

`SLICE-14B-TASK.md` accepted that blocker and amended the boundary. Rev 2
resolves it with one optional, typed, server-only field:
`InventoryDie.serverCopyMetadata.isFirstCopy`. The mapper copies the exact
latch from the same grouped live-copy snapshot. `NewInventoryDie` explicitly
omits this field, and the existing persist `partialize` contract still writes
only the retained guest/local view. Tests prove both exact mapping and absence
from persisted state.

Rev-1 provenance is retained as historical evidence:

- Runtime model: `gpt-5.6-sol`
- Reasoning effort: `high`
- HEAD at blocker: `24cc39e1985ff4d42001510b858cb3787d896b47`

## Files and line ranges

### Production

- `src/components/economy/WalletHud.tsx:1-195`
  - memoized shared balance summary and authenticated Wallet HUD
  - scalar Zustand selectors; per-user fresh-load observation; hidden for
    guests and initial pending/failed loads; later stale snapshots disclosed
  - token-positioned, scroll-safe bottom-right layout slot below core/transient
    overlays and above bottom controls
- `src/components/economy/walletHudLayout.ts:1-56`
  - shared pure/token-unit layout contract and deterministic viewport bounds
- `src/components/economy/shopCatalog.ts:1-28`
  - single client UI constants `STARS_PER_STANDARD_ROLL = 160` and
    `MAX_STANDARD_ROLL_CONVERSION_COUNT = 100`, citing product spec §1.3 and
    matching the client/RPC validation contract
  - six PO-locked bundle preview records from product spec §2
- `src/components/panels/ShopPanel.tsx:1-364`
  - authenticated BottomSheet host, affordable quantity bounds, guarded async
    conversion capped at 100, inline pending/success/error states, and flag-off
    bundle grid
- `src/components/layout/BottomNav.tsx:15-109`
  - authenticated `(payments || free conversion)` Shop-entry gate and active
    state
- `src/components/Scene.tsx:51-52,433-436,577-591,724-728`
  - bounded bottom-right Wallet HUD mount and Shop panel state/host wiring
- `src/components/panels/index.ts:8-15`
  - Shop panel export
- `src/components/panels/InventoryPanel.tsx:7-103,417-429,524-635,681-724`
  - selector subscriptions, exact per-catalog live-copy counts, injectable
    clock, recent exact first-copy gate, memoized cards, token-styled badges
- `src/types/inventory.ts:117-127,205-220`
  - optional ephemeral server-copy metadata and explicit exclusion from
    `NewInventoryDie`
- `src/store/useInventoryStore.ts:252-310`
  - minimal additive mapping of exact `copy.isFirstCopy`

### Tests

- `src/components/economy/WalletHud.test.tsx:1-155`
  - guest/uninitialized hiding, initial pending/failed hiding, fresh-to-stale
    transition, balances, nonzero premium gate, and 320×568 layout contract
- `src/components/panels/ShopPanel.test.tsx:1-164`
  - guest hiding, affordable bounds, zero-balance disable, double-click guard,
    100-roll ceiling, pending/success/error, and six disabled bundle cards
- `src/components/layout/BottomNav.test.tsx:1-63`
  - complete guest/authenticated × payments-off/on visibility matrix
- `src/components/panels/InventoryPanel.test.tsx:176-254`
  - `×N` only for duplicates, exact recent first-copy gate, and inactive/local
    zero-change behavior
- `src/lib/diceCopies.test.ts:14-78`
  - grouping retains an exact live first-copy latch alongside the historical
    scrapped-first case
- `src/store/useInventoryStore.serverCopies.test.ts:37-86`
  - mapper preserves the exact latch and persistence excludes the ephemeral
    metadata

## Mount point and UX decisions

### Wallet HUD

The HUD mounts at the scene UI-overlay level in a constrained bottom-right slot
(`Scene.tsx:577-578`). Right/bottom offsets, width, maximum width, and maximum
height derive from the active theme spacing unit
(`WalletHud.tsx:161-178`). Its width is bounded to remain wholly right of the
viewport center. Its maximum vertical region begins below ResultDisplay's
`top: 32px` plus `maxHeight: 40vh` region, and its 36-token bottom clearance
reserves the BottomNav / motion-hint lane. `overflow-y: auto` safely contains
the compact balance stack.

The HUD uses z-index 10, below ResultDisplay (20), RoomNotices (40), and bottom
controls (40/45), so core/transient overlays win even if geometry changes. The
numeric counterpart in `walletHudLayout.ts:1-56` proves the 320×568 portrait
bounds without relying on jsdom layout: left edge is strictly right of center,
top is below the maximum result region, bottom clearance is 144px, and maximum
height remains positive.

`userId` alone is not treated as proof that balances loaded. The HUD records,
per mounted user, whether it has observed `loading === false && stale ===
false`. A user switch resets that observation immediately. Initial pending and
initial failed states remain hidden; after one fresh observation, a later stale
snapshot remains visible with the stale disclosure.

The balance summary is shared with Shop instead of duplicating wallet markup.
Both components use scalar selectors and `React.memo` in line with
Frontend-ADR-002. The new surfaces read colors, typography, spacing, radius,
and shadows from the active theme tokens (`src/themes/tokens.ts:233-285`);
nullable icon assets are not required, and the Shop nav uses a text fallback.

### Inventory markers

Copy count is derived only while `serverCopiesActive` is true from the complete
mapped server rows, matching the slice-13 invariant that each live copy becomes
one inventory row. Every duplicate tile shows `×N` when `N > 1`; single copies
get no count badge. The recent marker requires all three facts:

1. authenticated server-copy view active;
2. the exact row has `serverCopyMetadata.isFirstCopy === true`;
3. injected/current time is not before acquisition and no more than 24 hours
   after it.

The clock is an optional function defaulting to `Date.now`, which makes the
boundary deterministic in RTL without modifying a global clock.

### Shop

Shop reuses the established `BottomSheet` panel idiom
(`src/components/panels/BottomSheet.tsx:20-151`) and Inventory’s themed
section/header idiom (`src/components/panels/InventoryPanel.tsx:206-238`).
The free conversion remains available with payments off; the six bundle cards
are disabled previews only and disappear when payments are enabled. There is
no `BuyButton`, checkout SDK, or purchase action. This preserves the existing
flag rule that purchase entry points are unreachable while off
(`src/components/checkout/BuyButton.tsx:37-38`,
`src/lib/paymentsConfig.ts:38-42`).

The UI constants `160` and `100` are single-sourced in
`src/components/economy/shopCatalog.ts:9-11`; the server RPC remains
authoritative. The rate source is product spec §1.3
(`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md:90-105`) and
the accepted economy ADR
(`docs/adrs/shared/017-monetization-economy-architecture.md:48-53`).
The 100-roll maximum matches the existing client validator
(`src/lib/walletBalances.ts:413-419`) and RPC constraint
(`supabase/migrations/0016_stars_to_standard_roll_conversion.sql:45-46`).
Bundle data is from product spec §2
(`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md:234-253`).

## Verification

### Focused Wallet HUD layout/load contract

Command:

```text
npm test -- --run src/components/economy/WalletHud.test.tsx
```

Result:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
exit 0
```

### Targeted matrix

Command:

```text
npm test -- --run src/lib/diceCopies.test.ts src/store/useInventoryStore.serverCopies.test.ts src/components/economy/WalletHud.test.tsx src/components/panels/InventoryPanel.test.tsx src/components/panels/ShopPanel.test.tsx src/components/layout/BottomNav.test.tsx
```

Result:

```text
Test Files  6 passed (6)
Tests       28 passed (28)
Duration    2.38s
exit 0
```

The only stderr was the repository’s existing
`WARNING: Multiple instances of Three.js being imported.` from the Inventory
component test environment.

### Lint

Command:

```text
npm run lint
```

Result:

```text
eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
exit 0
```

### Exact unfiltered full suite

Command:

```text
npm test -- --run
```

Result:

```text
Test Files  3 failed | 127 passed (130)
Tests       17 failed | 1176 passed (1193)
Duration    17.79s
exit 1
```

All 17 failures are confined to:

- `scripts/check-immutable-catalog-history.test.ts`
- `scripts/check-immutable-economy-history.test.ts`
- `scripts/check-immutable-migration-history.test.ts`

Every failure is the same sandbox limitation at the guard’s nested git helper:

```text
Error: spawnSync git EPERM
return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
```

No slice test or other repository test failed.

### Runnable full-suite proof excluding only the sandbox-blocked files

Command:

```text
npm test -- --run --exclude scripts/check-immutable-catalog-history.test.ts --exclude scripts/check-immutable-economy-history.test.ts --exclude scripts/check-immutable-migration-history.test.ts
```

Result:

```text
Test Files  127 passed (127)
Tests       1176 passed (1176)
Duration    16.68s
exit 0
```

Pre-existing React `act(...)` warnings and the Three.js duplicate-instance
warning remain non-failing.

### Production build

Command:

```text
npm run build
```

Result:

```text
Verified 69 collectible catalog items
Verified 1 immutable economy contract edition(s)
Verified 1 immutable economy simulation scenario(s)
Verified 1 immutable production economy edition(s)
Runtime dice assets passed for all 3 imagegen sets
Verified dice manifest: 4 sets, 19 dice
tsc: passed
vite: 1212 modules transformed
✓ built in 5.82s
PWA precache: 24 entries
exit 0
```

Vite emitted its existing advisory that some chunks exceed 500 kB; it is not a
build failure. This build ran after the review fix batch on the same working
tree as the final targeted, lint, and runnable full-suite gates.

### Static checks

```text
git diff --check
exit 0
```

The adversarial review checked guest invisibility, exact first-copy identity,
persistence exclusion, quantity bounds, double-submit behavior, payment
gating, selector subscriptions, memoization, theme-token use, wallet loading
semantics, RPC validation parity, and overlay collisions. Its six valid
findings were fixed before the final targeted gate:

1. `NewInventoryDie` now forbids constructing server-only metadata locally.
2. Server-copy badge spacing/typography/radius use theme tokens while the
   original guest/local Fav/Lock/DEV badge markup and styling remain verbatim.
3. Wallet HUD visibility now requires a per-user fresh-load observation and
   retains stale display only after that observation.
4. Shop affordability is capped by the single-sourced 100-roll RPC maximum.
5. Wallet HUD moved out of the colliding top-center anchor.
6. Focused placement review then replaced the still-overlapping left slot with
   a pure-contract, right-half-constrained bottom-right region below
   ResultDisplay/notices in z-order and above the bottom controls/motion hint.

## Risks and follow-ups

1. The three immutable-history guard files could not exercise their nested-git
   semantics in this managed sandbox. Their failure is environmental and
   unrelated to this diff, but a host/CI run with subprocess git permission
   should supply the final green unfiltered-suite proof.
2. The bottom-right HUD is intentionally compact, height-bounded, and
   scroll-safe, but this slice has component/layout-contract proof rather than
   a physical small-screen visual artifact. A later visual/E2E pass can tune
   wrapping if real-device evidence shows pressure above bottom controls.
3. Payments-on Shop v1 intentionally contains no bundle purchase path. The
   disabled previews are rendered only while payments are off, exactly as the
   slice boundary specifies.
4. Existing bundle-size and React `act(...)` warnings are outside this slice.

## Repository state and provenance

- Branch: `econ/14-wallet-shop-ui`
- Base/HEAD: `24cc39e1985ff4d42001510b858cb3787d896b47`
- Commits created: none
- Runtime model: `gpt-5.6-terra`
- Reasoning effort: `high`
