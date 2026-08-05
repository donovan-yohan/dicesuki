# Slice 8 FIX — suite role bug + spec flag

1. LIVE FAILURE (the harness ran outside your sandbox):
   `0021_pull_copy_grant_rework.test.sql failed — ERROR: permission denied for
   table sealed_pull_results` at the assertion block near line 309: it queries
   `sealed_pull_results` while still in the authenticated role from the
   preceding prepare call. sealed_pull_results has no client SELECT by design
   (seed secrecy). Fix per the 0017 suite's discipline: `reset role` before
   any assertion that reads privileged tables, re-enter the API role only for
   the calls under test. Sweep the ENTIRE 0021 suite for the same pattern
   (any privileged-table read — sealed_pull_results, pull_sessions,
   dice_copies cross-user, wallet internals — inside an API-role window).
2. Spec flag (reviewer ❓, PO-pending): append to
   docs/exec-plans/active/2026-07-22-monetization-economy-spec.md §7 open
   questions: reward-rail (0010 claims) and direct-purchase (0013) grants
   write user_entitlements, NOT dice copies — under copy-count ownership the
   pull rail treats those dice as unowned (re-pullable as non-duplicates,
   fresh copy, no dupe Dust). Working assumption: intended rail split per
   ADR-017; aligning the reward/faucet rail to grant copies is a future
   delta; PO to confirm. Keep doc voice.
3. No other changes. Run `npm test -- 0021` + `npm test -- supabase/migrations`
   (paste lines); orchestrator reruns the live harness. Update SLICE-8-REPORT.md
   rev 2 (keep rev 1).
