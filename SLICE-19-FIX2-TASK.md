# Slice 19 FIX 2 — 0026 suite fixture vs the 0028 snapshot CHECK

The FK fix unmasked this: supabase/tests/0026_sku_registry.test.sql's raw
sku-bound payment_orders insert now violates 0028's
payment_orders_sku_snapshot_shape CHECK (the fixture bypasses
create_sku_payment_order, which fills the snapshot columns). The CHECK is
correct (fail-closed on malformed sku orders); the FIXTURE is stale.
Update the 0026 suite: route that scenario through the production
create_sku_payment_order RPC (stronger test) or, where the scenario
specifically needs a raw insert, include a valid snapshot shape — state
which you chose per scenario and why. Do not weaken the CHECK or any 0026
assertion. Sweep the 0026 suite for any OTHER raw sku-order inserts with
the same problem. Run npm test -- 0026 and npm test -- supabase/migrations
(paste lines). Orchestrator runs the full harness. SLICE-19-REPORT.md
rev 3 note.
