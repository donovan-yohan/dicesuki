# Slice 19 FIX 4 — exhaustive role-discipline audit of the 0028 suite

Next live failure: ERROR: permission denied for table payment_orders — a
direct privileged-table read inside an API-role window. Stop patching hit
by hit: AUDIT EVERY STATEMENT of supabase/tests/0028_sku_fulfillment.test.sql
for role context. Rules (the established suite discipline):
- API-role windows (set local role authenticated/service_role + jwt claims)
  contain ONLY the calls under test.
- EVERY assertion/setup read of privileged or RLS-scoped tables
  (payment_orders, wallet_*, subscription_events, lunar_*, store_skus
  drafts, sealed_*, pull_*) runs as owner (reset role) — the 0025/0027
  pg_temp handoff pattern where values must cross the boundary.
- jwt-claims GUCs persist to transaction end (SET LOCAL) — pin or clear
  before any self-only call (the 0027 lesson).
Produce in SLICE-19-REPORT.md rev 4 a short table: scenario -> role
windows -> privileged reads, proving the audit was total. Then run
npm test -- 0028 (paste lines). Orchestrator runs the full harness.
