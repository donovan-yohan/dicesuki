# Slice 14 — Wallet HUD, collection copy badges, Shop panel v1 (frontend slice 2, [free])

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/14-wallet-shop-ui` (off main; slice 13's data layer merged
PR #192: useWalletStore, walletBalances/diceCopies libs, server-copies-backed
useInventoryStore, convertStarsToStandardRoll action).

Read FIRST: src/components/panels/InventoryPanel.tsx + SettingsPanel.tsx +
SavedRollsPanel.tsx (panel structure, styling idioms), src/components/layout/
BottomNav.tsx (nav slots), src/themes/tokens.ts + useTheme() (ALL colors/
spacing from tokens — Frontend-ADR-003: no hardcoded colors, graceful null
asset fallbacks), src/components/checkout/BuyButton.tsx + PendingPurchaseBanner
(payments-flag idioms), src/config/paymentsConfig.ts, src/store/useWalletStore
+ useInventoryStore server-copies slice + useAuthStore (signed-in detection),
Frontend-ADR-001/002/004 rules in .claude/rules/architecture.md, existing
component tests (*.test.tsx) for RTL patterns.

## Task — three UI surfaces, signed-in only (guests see ZERO change)
1. **WalletHud** (new src/components/economy/WalletHud.tsx): compact
   Stars/Dust/standard-ticket display reading useWalletStore (premium ticket
   shown only when nonzero); stale indicator when store says stale; hidden
   entirely when signed out or store never loaded. Mount it where the panel
   headers/topbar idiom fits (study Scene.tsx layout mounts; pick the least
   intrusive host and justify). Theme tokens only; React.memo + selector
   subscriptions (no whole-store re-renders — ADR-002).
2. **Collection copy badges** (extend InventoryPanel): when server-copies
   view is active, each die row/tile shows its live copy count (×N badge,
   N>1 only) and a subtle first-copy marker for copies acquired in the last
   24h with isFirstCopy (the celebration effect proper is a later slice —
   this is the static indicator). Zero layout change for guests/local dice.
3. **ShopPanel v1** (new src/components/panels/ShopPanel.tsx + nav entry):
   - Nav: add a shop entry to BottomNav ONLY when signed in AND
     (isPaymentsEnabled OR conversion available) — study how the existing 5
     slots are declared; keep guests' nav identical.
   - Panel contents v1: balances summary (reuse WalletHud internals or a
     shared subcomponent); a Stars → standard_roll conversion card: shows
     rate (160:1 — read from a single-sourced constant, cite where the rate
     canonically lives client-side; if none exists, define one constant
     citing spec §1.3), quantity stepper (1..N bounded by affordable),
     confirm button wired to the store's convertStarsToStandardRoll (the
     in-flight guard exists — reflect pending state, success/error toasts or
     inline states per existing panel idioms), resulting balances update via
     the store refresh.
   - Star bundle grid: render the six PO-locked bundles (handful..hoard,
     $0.49..$49.99 — amounts/prices from a data constant, spec §2 cited)
     ONLY as disabled "coming soon" cards when isPaymentsEnabled is false
     (which it is pre-#154) — no BuyButton wiring in this slice; visible
     structure, no purchase path.
4. **Tests** (colocated RTL + vitest, existing mock patterns): WalletHud
   renders balances/hides for guests/stale flag; InventoryPanel badge logic
   (xN only when >1, first-copy marker gating) with server-copies active and
   inactive; ShopPanel conversion flow (stepper bounds vs balance, confirm
   calls store action once — double-click covered by store guard, pending/
   success/error states), nav entry visibility matrix (guest/signed-in ×
   payments-flag).

## Boundaries
New components + InventoryPanel.tsx + BottomNav.tsx (+ the chosen HUD mount
file) edits only. NO 3D scene logic, NO store/lib changes (slice 13 is
merged — consume as-is; if a genuine gap blocks you, STOP and report it
rather than patching stores), no edge functions, no commits. Run:
targeted component tests + `npm test` full + `npm run build` (paste exact
lines).

## Report
`SLICE-14-REPORT.md`: summary, files+lines, mount-point + UX decisions with
idiom citations, test output incl. build, risks, provenance (EXACT model id
+ effort from runtime config).
