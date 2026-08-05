# Slice PS — Pull screen: banner, pull flow, reveal (design-spec slice 1)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `feat/pull-screen` (off main — includes the saved-rolls fix: the room
backend is the ONLY spawn path; diceSpawner is deleted).

THE BINDING DESIGN DOC: ./DESIGN-PULL-SCREEN.md (read it in FULL — §12
"Slice 1" is your exact scope; §11 is the contract map; §10 the
accessibility/anti-slop gate; §2-§9 the surface specs). Move it to
docs/design/pull-screen.md as part of this slice (it ships with the code).

ORCHESTRATOR CORRECTIONS to the doc (these OVERRIDE its "gaps"; the doc's
grep was stale):
- `is_first_copy` EXISTS in the commit/reveal receipt (0021) — the ✦NEW✦
  first-copy treatment keys on the REAL ever-owned latch, not the
  is_duplicate proxy. Duplicates DO grant copy+Dust (0021/0022): render the
  "+1 copy (owned ×N)" line for real (live count via the slice-13
  diceCopies/inventory data, refreshed post-commit).
- Ticket balances: src/lib/walletBalances.ts + useWalletStore (slice 13) —
  already live, use them.
- Pity meter: src/lib/pullPity.ts / get_my_pull_pity (0025) — server-owned,
  one round trip, counters 0-based vs thresholds 1-based (remaining =
  threshold − misses, no further ±1; the RPC comment documents it).
- Conversion: the ShopPanel conversion card + store action exist (slice 14) —
  reuse the store action + error mapping for CTA State C's sheet.

## Scope (design §12 slice-1 list, plus)
1. Banner screen (full-screen route per §1.1, inside the Shop hub as the
   Banners tab — extend ShopPanel's tab structure or the nav route the shop
   entry opens; justify against §1.1), standard tab live, premium tab
   present/locked ("Coming soon", dormant per #154).
2. Hero stage with a REAL die mesh (HeroDieInspector/
   SharedInventoryDicePreviewCanvas idioms, device-tier fallback), pity
   meter (0025-fed, read-only; §2.2 standard framing; premium two-zone
   design rendered dormant), rates disclosure BottomSheet.
3. Balances strip + CTA states A–D (§3) incl. the conversion sheet (State C,
   reuse slice-14 pieces) and the faucet-pointing insufficient sheet (State D).
4. Full flow (§4.4): prepare_pull → SEALING beat (commitment_root shown,
   ≥800ms, skippable per §4.4 budgets) → commit_pull_session → reveal.
   Degraded HOLD overlay (§7) with countdown/Reveal-now/Cancel; resume via
   get_committed_pull_reveal (persist the live session id minimally);
   idempotency key per intent (stable across retries — the slice-13
   conversion key lifecycle is the precedent).
5. Reveal: single (§5.1/5.2 — NEW via is_first_copy, dupes +Dust +copy line)
   and 10-pull (§6: staggered flourish, skippable, 5×2 grid with pooled
   preview canvases + device-tier fallback, highlights line, "Add all"/
   "new only" batch). "Add to table" claims via the ROOM BACKEND
   (activeBackend.addDie with inventoryDieId — the saved-rolls fix pattern;
   NOT the deleted diceSpawner the design doc cites). Respect arena capacity
   (§6 toast for the remainder).
6. Verification affordance (§8): tick + expandable disclosure
   (commitment_root/seed/nonces + copy buttons + explainer link; no client
   recompute).
7. §9 error/loading matrix complete; §10 reduced-motion/44px/contrast/aria +
   anti-slop checklist are ACCEPTANCE; haptics per the centralized
   thresholds where the design calls them.
8. Shared util: promote getRarityColor → src/lib/rarityColor.ts with the
   tier→rarity mapping documented (§5.4); currency glyph treatment per §10
   anti-slop (text/token glyphs, no emoji) — add minimal token-consistent
   glyph components if none exist.
9. Tests: RTL for CTA state matrix (A–D × balances), flow state machine
   (prepare→sealing→commit→reveal; stall→hold; cancel; resume path), reveal
   assembly (NEW/dupe/first-copy lines from receipt fixtures), 10-pull
   summary derivations, verification disclosure content, rarityColor
   mapping. EXTEND the wasm-room e2e ONLY if a pull can be driven against
   the local harness (pulls need Supabase RPCs — likely NOT drivable in the
   wasm-room e2e; if so state that and rely on RTL + the migration suites).

## Boundaries
src/ + docs/design/pull-screen.md move + e2e (conditional). NO migrations,
NO edge functions, NO server/. Slice-13/14 stores/libs are consumable;
additive-only extensions permitted where a receipt field needs threading
(state each in the report). No commits. Run: targeted vitest + `npm test` +
`npm run build` (paste exact lines).

## Report
`SLICE-PS-REPORT.md`: summary; files+lines; §12 checklist status per item;
design deviations with justification; the §10 anti-slop self-audit; test
output; risks; provenance (EXACT model id + effort).
