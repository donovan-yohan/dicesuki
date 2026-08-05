# Slice 16 FIX — friendly error copy (both economy flows)

1. LunarPassCard.tsx (~L165): claim failures currently render the raw typed
   error message (internal RPC-name prefix leaks to users). Branch on
   `error instanceof LunarPassClaimError` and map `error.kind`
   (not_entitled / unauthenticated / not_configured / rpc_failure) to
   friendly user copy (short, theme-consistent, no internal names); generic
   fallback otherwise.
2. Same class in the slice-14 conversion path (ShopPanel/conversion error
   branch ~L84-89): map the conversion error kinds (insufficient funds etc.)
   to friendly copy the same way.
3. Fix the vacuous test (ShopPanel.test.tsx ~L409): reject with the REAL
   LunarPassClaimError('...','not_entitled','55000') and assert the friendly
   copy actually surfaces (not the raw message). Add one conversion-error
   equivalent.
4. Nit while there: the claim/conversion notices use role="alert" with
   aria-live="polite" (contradictory) — use role="status" for polite notices,
   role="alert" only for errors, matching intent.

Boundaries: LunarPassCard.tsx, ShopPanel.tsx (+the notice subcomponent if
shared), their tests. Nothing else. Run targeted tests + `npm test` +
`npm run build` (paste lines). SLICE-16-REPORT.md rev 2 (keep rev 1).
