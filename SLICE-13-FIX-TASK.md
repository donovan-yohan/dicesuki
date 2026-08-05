# Slice 13 FIX — batched review findings (client data layer)

1. (🟡 walletBalances.ts ~L303) Wallet-watch TTL death: on TTL expiry the
   watcher tears down channel+poll permanently while stale stays false —
   balances freeze looking fresh, and polling is the ONLY live mechanism for
   wallet/ticket tables (not in the supabase_realtime publication). Fix:
   remove the TTL for the wallet watch entirely OR on expiry set stale:true
   and re-subscribe fresh; either way a session-long watch must never end in
   a silent frozen state. Test the chosen behavior.
2. (🟡 walletBalances.ts ~L407 + useWalletStore ~L156) Conversion
   double-spend: idempotency key minted fresh per call means server dedupe
   never engages; no in-flight guard means double-click sends two
   conversions. Fix BOTH: store action gets an in-flight guard (subsequent
   calls while pending return the pending promise / are rejected), AND the
   key becomes stable per logical attempt — caller-supplied or generated
   once and reused across retries of the same attempt until success/hard
   failure. Tests: double-click single RPC call; retry-after-timeout reuses
   the SAME key.
3. (🟡 ~L239) Coalesced-drop window: a change signal arriving mid-fetch is
   dropped until next poll. Queue one pending re-fetch when a trigger
   arrives while refreshInFlight (fetch-again-after-current). Test it.
4. (🔵 ~L377) Lunar DELETE events: replica identity gives no old.product_id.
   Treat DELETE events with unknown product as a refresh trigger (fetch and
   re-derive) instead of filtering them out. Test.
5. (🔵 dataSync ~L342) When connectRealtime is skipped (offline/injected
   client without channel), still set useWalletStore.userId for the signed-in
   user so state stays consistent for future consumers. Test.
6. Migrate coverage: add a persist-middleware-driven migrate test (not just
   the raw fn) for v3→v4, and cover the earliest supported persisted version
   the migrate chain claims to handle.

Boundaries: same slice files only. Run the slice's targeted tests + `npm test`
full + `npm run build` (paste exact lines). SLICE-13-REPORT.md rev 2 (keep
rev 1).
