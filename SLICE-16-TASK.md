# Slice 16 — Lunar Pass client surface (frontend, dormant-aware)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/16-lunar-client` (off main; merged: 0023 subscription state,
0024 daily faucet + purchase grant, slice-13 useWalletStore already carries
the Lunar subscription snapshot via Realtime, slice-14 ShopPanel/WalletHud
idioms). Backend RPC: claim_lunar_daily_stars() self-only (90 promo
Stars/UTC-day, replay-safe, fails closed when not entitled).

Read FIRST: SLICE-14 components (ShopPanel.tsx structure, WalletHud,
economy component idioms + tests), useWalletStore (subscription snapshot
fields + is-entitled derivation — check what slice 13 exposed; if
entitlement derivation is missing client-side, derive in a selector matching
0023's is_lunar_pass_active arms: active always; non_renewing until
date_next_charge; canceled until date_end), paymentsConfig
(isPaymentsEnabled), spec §3 (offer: $2.99/mo, 300 instant + 90/day; §3.5
claim-or-lose; §3.4 auto-renewal disclosure requirements — the DISPLAY of
renewal terms/cancel access matters even pre-launch).

## Task — extend ShopPanel with a Lunar Pass section; guests unchanged
1. **Lunar Pass card** (ShopPanel section): shows the offer ($2.99/mo, 300
   Stars instant + 90/day = 3,000/mo — constants single-sourced with spec
   citation); state machine per the wallet store's subscription snapshot:
   - no subscription: offer display + a DISABLED "coming soon" subscribe
     button while isPaymentsEnabled is false (no purchase path — the sub SKU
     ships with the #154/sub-law wiring); include the auto-renewal
     disclosure line + "cancel anytime" placement per §3.4 so the layout is
     compliance-ready.
   - active: status line (renews <date_next_charge>), daily-claim card (see
     2), manage/cancel note (managed via the payment provider — copy only).
   - non_renewing: "ends <date_next_charge>" + claim card while entitled.
   - canceled with future date_end: "ends <date_end>" + claim card;
     past/none: back to offer state.
2. **Daily claim card:** claimable state (entitled + not yet claimed today
   UTC — needs claim status: the RPC replay returns the prior receipt;
   simplest correct client check is calling claim and treating the
   already-claimed receipt as "claimed" — but do NOT auto-claim; show the
   button, on tap call a new lib wrapper claimLunarDailyStars(client?) (typed
   receipt incl. already-claimed discrimination, house error mapping), then
   refresh balances via the store. Show claimed-today state (checkmark +
   resets-at-UTC-midnight countdown text) after success or already-claimed.
   Pending/error states per slice-14 idioms. Double-tap guarded (in-flight).
3. **WalletHud**: no change unless trivial (do NOT add subscription state to
   the HUD).
4. **Tests** (RTL + lib, house patterns): state matrix (none/active/
   non_renewing/canceled-future/canceled-past × payments flag), claim flow
   (success updates state + triggers refresh once; already-claimed maps to
   claimed state; not-entitled error surfaced; double-tap single call),
   guests see no Lunar section, disclosure copy present in offer state,
   constants match spec (2.99/300/90/3000).

## Boundaries
ShopPanel.tsx + new lib wrapper (src/lib/lunarPass.ts + test) + any small
new subcomponents + tests. NO store changes unless the entitlement selector
is genuinely missing (then a minimal additive selector in useWalletStore —
state the gap in the report). No backend, no nav changes, no commits. Run:
targeted tests + `npm test` + `npm run build` (paste exact lines).

## Report
`SLICE-16-REPORT.md`: summary, files+lines, state-machine mapping w/ 0023
citations, disclosure-copy rationale (§3.4), test output, risks, provenance
(EXACT model id + effort).
