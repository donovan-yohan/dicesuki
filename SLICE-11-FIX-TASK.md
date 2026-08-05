# Slice 11 FIX — close the poison-event queue stall (both sides)

Review confirmed: any subscription payload that passes the TS gate but is
deterministically rejected by the RPC (22023/22007/22008) becomes a permanent
500 → Xsolla's sequential delivery retries it forever → the whole
subscription queue stalls with no escape. Three concrete holes + one nit.
Fix BOTH layers:

1. Gate tightening (webhookDispatch.ts):
   a. Date validation must be timestamptz-accurate, not Date.parse: reject
      when the ISO round-trip disagrees with the source (calendar-invalid
      like 2026-02-30 currently rolls over) → 400 INVALID_PARAMETER.
   b. Payload size guard: reject raw envelopes whose serialized size exceeds
      the RPC's 64KB bound → 400 INVALID_PARAMETER (mirror the exact bound
      from 0023).
   c. `bodySha256` parameter: remove the '' default — make it required in
      the type signature so a missing hash is a compile error.
2. Drain escape (xsolla-webhook/index.ts recordSubscriptionEvent dep):
   mirror the payment path's deterministic-rejection handling — if the RPC
   error is a deterministic rejection (SQLSTATE 22023, or datetime casts
   22007/22008), LOG it loudly and return an acked outcome (the dispatcher
   204s, marked as drained-invalid in the log/result) instead of re-throwing;
   genuine transient errors (connection, 5xx-ish, serialization) still throw
   → 500 → retry. Comment WHY: sequential delivery means a deterministically
   doomed event must drain, not block the queue.
3. Nit: either populate and branch on SubscriptionRpcResult.duplicate or
   delete the dead field — don't leave scaffolding.
4. Tests: calendar-invalid date → 400, dep not called; oversized payload →
   400, dep not called; dep receives deterministic-rejection from RPC → 204
   + drained-marker logged/returned, NOT 500; transient error still → 500;
   compile-level: bodySha256 required (adjust existing call sites/tests).

Boundaries: same four files as slice 11 only. Run `npm test -- webhookDispatch`
and `npm test -- supabase/functions` (paste exact lines). SLICE-11-REPORT.md
rev 2 (keep rev 1).
