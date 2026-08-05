# Slice 19 FIX — review red + items

1. (RED) Drop the lunar_order_invoices.lunar_purchase_grant_id FK to
   lunar_purchase_star_grants: store plain bigint (+ keep/add a covering
   index). 0024 chose no-inbound-FK deliberately (append-only, never
   deleted; TRUNCATE contract = trigger 55000). Do NOT touch the 0024
   probe. Document the by-value reference in a comment citing 0024's
   ordering-independence note.
2. Fix the stray-semicolon lint error (npx eslint --fix the new TS files).
3. Provenance: your report says gpt-5.6-terra; the runtime config pins
   gpt-5.6-sol (verify via your config; the orchestrator's run log header
   confirms sol). Correct the report line to the truth.
4. Add a spec/report note (risk register): xsollaToken subscription-token
   still sends purchase.checkout alongside purchase.subscription on
   merchant-v2 — unverified against live Xsolla sandbox; must be exercised
   before enabling Lunar checkout (potential 502).

Run npm test -- 0028 and npm test -- supabase/migrations (paste lines).
Orchestrator runs the FULL harness after. SLICE-19-REPORT.md rev 2.
