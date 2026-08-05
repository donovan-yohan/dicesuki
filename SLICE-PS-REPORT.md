# Slice PS Report — Pull screen: banner, pull flow, reveal (Revision 2)

## Outcome

Implemented the Slice PS frontend inside the Shop hub:

- guest-browseable, full-viewport Banners destination;
- standard banner discovery that accepts only `standard_roll` funding;
- locked/dormant Premium tab;
- server-owned pity and exact active-tier rate reads;
- live wallet balances and CTA states A–D, including explicit Stars conversion
  and free-faucet insufficiency sheets;
- strict prepare → SEALING → commit → reveal flow with stable intent
  idempotency, degraded HOLD, cancel, expiry, reload resume, auth-loss
  retention, and committed-reveal recovery;
- single and ten-pull reveals with real pooled dice previews, real
  `is_first_copy`, copy + Dust lines, per-item stale-copy degradation, summary
  derivations, inspection, and room-backend-only claims;
- verification disclosure for root, seed, nonces, and commitments;
- shared rarity color and token-safe Roll/Stars/Dust glyphs;
- reduced-motion, focus, touch-target, LOD, and low-tier fallback behavior.

The screen is implemented but cannot be activated as a ticket-funded live
standard pull today: the repository seeds only `earned-collection-001@1`, whose
`roll_type` remains `NULL` and therefore spends promotional Stars directly.
Slice PS forbids migrations. The client deliberately fails closed with
“Pull unavailable” instead of misrepresenting that legacy banner as
ticket-funded.

No commits were created.

## Files and key lines

### Contract, lifecycle, and projections

| File | Key lines | Purpose |
|---|---:|---|
| `src/types/pull.ts` | 1–171 | Strict banner, preparation, reveal, CTA, verification, and persisted-session types. |
| `src/lib/pullRpc.ts` | 44–461 | Exact schemes/invariants; ticket-bound banner discovery; prepare/commit/resume/cancel parsing. |
| `src/lib/pullFlow.ts` | 17–672 | Tagged lifecycle reducer, stable intent key, persistence, CTA A–D, copy joins, summary, verification. |
| `src/hooks/usePullFlow.ts` | 69–533 | Async orchestration, ≥800 ms sealing, 2 s HOLD, bounded expiry fence, cancel/commit race, resume/retry. |
| `src/lib/pullInventoryRefresh.ts` | 15–31 | One-shot catalog/copy/inventory refresh plus best-effort wallet refresh after commit. |
| `src/lib/diceCopies.ts` | 6–133 | Threads immutable `grant_idempotency_key` for exact result-position → live copy identity. |
| `src/lib/rarityColor.ts` | 1–41 | Shared catalog-rarity palette and documented tier fallback mapping. |

### Product surface

| File | Key lines | Purpose |
|---|---:|---|
| `src/components/panels/PullBannerScreen.tsx` | 36–745 | Full-screen Shop/Banners destination, tabs, pity/rates, balances, CTA/sheets, errors, flow integration. |
| `src/components/panels/PullRevealOverlay.tsx` | 25–475 | Single/ten reveal, receipt-only fallback, inspection, summary, haptics, room claims, verification disclosure. |
| `src/components/panels/PullProgressOverlay.tsx` | 14–173 | SEALING/restoring/HOLD/countdown dialog with focus containment and safe Escape behavior. |
| `src/components/panels/PullDicePreview.tsx` | 21–132 | Hero/grid adapter, low-tier static fallback, LOD selection, rarity label/accent. |
| `src/components/panels/SharedInventoryDicePreviewCanvas.tsx` | 48–458 | Applies texture, geometry, material, shadow, animation, and pixel-ratio LOD to the pooled renderer. |
| `src/components/economy/CurrencyGlyph.tsx` | 1–83 | Theme-token text glyphs for Rolls, Stars, and Dust; no emoji currency. |
| `src/components/panels/ShopPanel.tsx` | 18–137 | Shop hub tabs and guest Banners routing while preserving wallet/bundle behavior. |
| `src/components/layout/BottomNav.tsx` | 45–105 | Makes Shop/Banners reachable to guests. |
| `src/components/Scene.tsx` | 723–730 | Supplies room-backend `addDie`, global room count, and render tier. |
| `src/components/panels/BottomSheet.tsx` | 21–221 | Dialog semantics, focus trap/restoration, Escape, reduced motion, 44 px close target. |
| `src/components/panels/InventoryPanel.tsx` | 12, 550 | Uses shared rarity color. |
| `src/components/panels/HeroDieInspector.tsx` | 9, 36, 310 | Uses shared rarity color and passes operational hero LOD. |

### Tests

Added or extended:

- `src/lib/pullRpc.test.ts`
- `src/lib/pullFlow.test.ts`
- `src/hooks/usePullFlow.test.tsx`
- `src/lib/rarityColor.test.ts`
- `src/lib/diceCopies.test.ts`
- `src/store/useInventoryStore.serverCopies.test.ts`
- `src/components/panels/PullBannerScreen.test.tsx`
- `src/components/panels/PullRevealOverlay.test.tsx`
- `src/components/panels/PullDicePreview.test.tsx`
- `src/components/panels/PullProgressOverlay.test.tsx`
- `src/components/panels/SharedInventoryDicePreviewCanvas.test.tsx`
- `src/components/panels/BottomSheet.test.tsx`
- `src/components/layout/BottomNav.test.tsx`
- existing `src/components/panels/ShopPanel.test.tsx`

### Design artifact

- Moved the binding design from root `DESIGN-PULL-SCREEN.md` to
  `docs/design/pull-screen.md` (lines 1–815). There is no duplicate root copy.

## Design §12 Slice 1 checklist

| §12 item | Status | Evidence / limitation |
|---|---|---|
| Standard banner, real die hero, shallow server pity, rates sheet | **Implemented; activation blocked** | Full surface and reads exist. Low-tier hero avoids WebGL. No ticket-bound standard row exists, so live data correctly resolves unavailable. |
| Balances and CTA A–D, explicit Stars conversion | **Pass** | Live wallet store; promotional-Stars-only conversion; sign-in, tickets, conversion, and free-faucet states covered by RTL. |
| `prepare_pull` → SEALING → `commit_pull_session` → reveal | **Pass in client/harness** | Strict RPCs, 800 ms floor, 2 s HOLD escalation, stable intent key, and no double fire. Cannot run against a live pull without the missing banner row. |
| Single and ten-pull reveal, NEW/copy/Dust/grid/summary | **Pass** | `NEW` keys only on real `is_first_copy`; exact copy identity/count comes from refreshed immutable copy rows when joinable. A stale row now falls back to catalog metadata without guessing an owned count or spawn identity, while all other committed rows continue rendering. |
| Add to table / Add all | **Pass** | Uses only `activeBackend.addDie(type, inventoryDieId)`. Global room count caps requests; UI says “Requested” pending authoritative confirmation and surfaces room rejection. |
| Cancel, expiry, HOLD, resume, §9 states | **Pass with noted prepare-error caveat** | Cancel/commit race, expired-but-committed reload, never-settling transport expiry, auth loss, restore retry, offline, loading, spawn rejection, and durable recovery are covered. A server-side insufficient prepare error remains generic retry copy rather than forcibly opening C/D; client-derived C/D are complete. |
| Verification disclosure | **Pass** | Root shown after prepare; root/seed/nonces/commitments disclosed with exact-value copy controls and an inline expandable explainer; no dead route and no false client recompute claim. |
| Premium dormant/locked | **Pass** | Present with Coming soon, soft-pity start 41, and hard 75 presentation; non-interactive pre-#154. |

## Orchestrator corrections applied

- `is_first_copy` is authoritative; no `is_duplicate === false` NEW proxy.
- Duplicates render copy + Dust and live owned count.
- Wallet balances use `useWalletStore`.
- Pity uses `get_my_pull_pity`; remaining is exactly
  `hardGuaranteePull - misses` with no ±1 adjustment.
- State C reuses `convertStarsToStandardRoll`.
- Claims use the room backend. No deleted `diceSpawner` path was reintroduced.

## Revision 2 batched polish closure

All seven findings from `SLICE-PS-FIX-TASK.md` were applied in one pass:

1. `BottomSheet` and `PullProgressOverlay` keep the latest close/cancel
   callbacks in refs; callback identity changes no longer tear down and rerun
   the focus trap.
2. The reveal result live region mounts empty and receives its announcement in
   a post-mount effect.
3. A stale copy-group, grant, first-copy latch, or playable-copy join degrades
   only that result to catalog presentation metadata. It logs the reason,
   exposes no guessed live count, omits the owned-copy line, and cannot be sent
   to the room with a fabricated copy id. If catalog presentation is also
   absent, the row becomes a deterministic, non-owning receipt-only placeholder.
   Ten-result regressions prove the other nine exact rows remain assembled in
   both degradation modes.
4. The nonexistent `/docs/fair-pulls` link was removed and replaced with one
   inline expandable verification paragraph.
5. `EngineConfig` was inspected and does not expose the room dice cap. The
   client therefore retains the named `ROOM_DICE_CAPACITY` constant with an
   explicit pointer to `server/core/src/room.rs::MAX_DICE` and a drift-risk
   comment; no engine or server code changed.
6. Pity `aria-valuenow` is clamped to the server-provided hard guarantee.
7. Pity refresh generation advances only when the pull flow enters
   `revealed`, `cancelled`, or `expired`; intermediate status churn does not
   refetch.

## Design deviations and justification

1. **Ticket-funded activation fails closed.** No allowed frontend change can
   create the missing `standard_roll` banner version. Falling back to
   `earned-collection-001@1` would silently spend Stars and violate the CTA.
2. **Shop integration is a full-viewport child destination.** Shop/Banners is
   the primary opened tab; wallet/bundles remains a BottomSheet tab. This keeps
   the banner ceremony full-screen while preserving the existing Shop surface.
3. **Exact rates are unavailable when no valid banner exists.** The UI does not
   invent percentages or pity counters. It fetches and normalizes active tier
   weights only after a ticket-bound banner is discovered.
4. **No wasm-room Playwright extension.** That harness starts Vite + the guest
   WASM room only. It has no Supabase Auth/PostgREST service or authenticated
   non-anonymous user, so it cannot drive pull RPCs. RTL plus migration-contract
   suites are the executable coverage.
5. **Room placement confirmation is conservative.** `addDie` returns a request
   id, not a synchronous placement receipt. Copy says “Requested; the room will
   confirm placement,” then uses the existing room-action error surface.

## §10 accessibility, motion, performance, and anti-slop audit

| Gate | Status |
|---|---|
| Reduced motion | Pass: SEALING/reveal motion degrades; BottomSheet drag/animation disables; low LOD can be static. |
| Touch targets | Pass: CTA, tabs, close, copy, grid, and dialog controls use ≥44 px targets. |
| Contrast/token styling | Pass by token use; no automated contrast measurement was run. Rarity is paired with a text label. |
| Focus/ARIA | Pass: sheets and overlays are labeled modal dialogs with focus containment/restoration; HOLD Escape maps to safe cancel and is disabled while cancelling. |
| Screen-reader result | Pass: the live region mounts empty, then announces name, rarity, NEW/duplicate state, available copy count, and Dust after mount. |
| Performance | Pass: one pooled preview canvas; low tier uses non-WebGL fallback; medium/high apply actual texture/geometry/animation/shadow policy. |
| Haptics | Pass: light pull, medium reveal, strong signature/first-copy reveal via centralized haptic thresholds. |
| No purple/blue gradient hero | Pass. |
| No icon-in-circle feature cards | Pass. |
| No emoji currency | Pass: token/text glyph components. |
| No bubbly dice cards | Pass: real dice meshes/static die fallback carry the composition. |
| No color-only rarity | Pass: rarity label plus decorative accent. |

## Adversarial review

### Revision 1 production-slice review

- Broad review: **0 P0**, seven P1 and one P2 findings.
- All findings were batched into one correction pass.
- Focused changed-hunk re-review cleared all but two P1s:
  unbounded expiry waiting and non-operational LOD.
- Both final P1s were corrected:
  expiry now immediately uses server-authoritative reveal/fence checks and has
  a never-settling transport regression; LOD now changes real renderer behavior
  and low-tier hero/grid paths avoid WebGL.
- Per repository closure rules, broad review was not reopened.

The state-machine/tagged-union implementation was checked against the pinned
`battle-tested-patterns` catalog at
`08448fc6613d790ae635fa12751e8a3cf9617816`. Defining invariants are executable
tests. Optional pattern telemetry could not be written because
`~/.codex/pattern-evidence` is read-only in this sandbox.

### Revision 2 fix-round review

- Initial adversarial review found **0 P0/P1** findings.
- One bounded P2 batch strengthened pre-effect live-region proof, terminal pity
  transition coverage, and receipt-only reveal degradation.
- Focused changed-hunk re-review found **0 P0/P1** findings.
- No broad review restart was warranted under the repository closure rules.

## Test and build output

### Revision 2 targeted P2 Vitest

Command:

```text
rtk npm test -- --run src/lib/pullFlow.test.ts src/components/panels/PullRevealOverlay.test.tsx src/components/panels/PullBannerScreen.test.tsx
```

Exact summary:

```text
Test Files  3 passed (3)
Tests       22 passed (22)
Duration    1.47s
```

Vitest emitted non-failing React `act(...)` warnings from asynchronous
`PullBannerScreen` effects in the existing auth-loss test.

### Revision 2 broader focused Slice PS Vitest

Command:

```text
rtk npm test -- --run src/lib/pullRpc.test.ts src/lib/pullFlow.test.ts src/hooks/usePullFlow.test.tsx src/lib/rarityColor.test.ts src/lib/diceCopies.test.ts src/components/panels/PullBannerScreen.test.tsx src/components/panels/PullRevealOverlay.test.tsx src/components/panels/PullDicePreview.test.tsx src/components/panels/SharedInventoryDicePreviewCanvas.test.tsx src/components/panels/PullProgressOverlay.test.tsx src/components/panels/BottomSheet.test.tsx src/components/layout/BottomNav.test.tsx src/components/panels/ShopPanel.test.tsx
```

Exact summary:

```text
Test Files  13 passed (13)
Tests       91 passed (91)
Duration    14.88s
```

Vitest emitted the existing non-failing React `act(...)` warnings from
asynchronous `PullBannerScreen` effects.

### Lint

Command:

```text
rtk npm run lint
```

Exact command line:

```text
eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
```

Result: exit 0, no warnings.

### Full Vitest

Command:

```text
rtk npm test -- --run
```

Exact summary:

```text
Test Files  3 failed | 140 passed (143)
Tests       17 failed | 1334 passed (1351)
Duration    27.71s
```

All 17 failures are sandbox process restrictions in:

- `scripts/check-immutable-catalog-history.test.ts`
- `scripts/check-immutable-economy-history.test.ts`
- `scripts/check-immutable-migration-history.test.ts`

Each failure is `Error: spawnSync git EPERM`. All product tests and migration
contract suites passed, including `0017_pull_commit_reveal`,
`0021_pull_copy_grant_rework`, and `0025_pity_read`.

### Docker-backed Supabase suite (Revision 1 baseline; not rerun)

Command:

```text
rtk npm run test:db:supabase
```

Blocked before database startup:

```text
Error: spawnSync docker EPERM
code: 'EPERM'
syscall: 'spawnSync docker'
spawnargs: [ 'version' ]
```

### Production build

Command:

```text
rtk npm run build
```

Exact key lines:

```text
✓ 1224 modules transformed.
✓ built in 5.89s
PWA v1.3.0
precache  24 entries (3866.84 KiB)
```

Build exit: 0. Vite retained its existing large-chunk advisory.

### Final hygiene

```text
rtk git diff --check
```

Result: exit 0. Changed production paths are confined to `src/**`; the only
other implementation artifact is `docs/design/pull-screen.md`, plus this
required root report. No migrations, edge functions, `server/**`, or E2E files
changed.

## Risks / follow-up

1. A backend slice must append a real active standard banner version with
   `roll_type='standard_roll'`; until then pulling remains intentionally
   unavailable.
2. Run `npm run test:db:supabase` and the three immutable-history guard files in
   an environment that permits Docker and nested Git subprocesses.
3. Clean the non-failing async React `act(...)` warnings in
   `PullBannerScreen.test.tsx`.
4. The exact rates read depends on client-readable banner-tier rows once the
   ticket-bound banner exists; verify the hosted RLS/data shape during backend
   activation.
5. Automated contrast measurement and authenticated browser dogfood were not
   possible in this packet/harness.

## Provenance

- Primary orchestrator model id: `gpt-5`
- Implementation/review worker model id: `gpt-5.6-terra`
- Effort: `high`
- Date: `2026-07-24`
