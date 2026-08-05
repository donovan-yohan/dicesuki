# Slice 11 — Webhook RECURRING dispatch branch (Lunar Pass slice B)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/11-recurring-webhook` (off main; 0023 subscription schema merged
PR #189 — `record_subscription_event` RPC: service-only, idempotent, appends
event + reprojects monotone status; expects the RESOLVED Supabase auth uid).

Read FIRST: supabase/functions/_shared/webhookDispatch.ts (routing seam:
FULFILL_TYPES/REVERSAL_TYPES branches, WebhookDeps, resolveUserId at L132-138
— Xsolla user.id IS the Supabase uuid minted into the checkout token),
supabase/functions/xsolla-webhook/index.ts (buildDeps, RPC call pattern,
signature flow), webhookDispatch.test.ts (mocked-deps vitest style),
supabase/functions/README.md, migration 0023 header (event vocabulary +
required fields per type), SLICE-10-TASK.md §Xsolla ground truth (the
researched event reference).

## Task
Extend the webhook pipeline to handle the four Xsolla subscription events.
TypeScript only — no SQL.

1. `webhookDispatch.ts`: new SUBSCRIPTION_TYPES branch for
   `create_subscription`, `update_subscription`, `non_renewal_subscription`,
   `cancel_subscription`:
   - parse the envelope (subscription block: subscription_id AS STRING even
     if numeric, plan_id, product_id, date_create/date_next_charge/date_end
     per type), resolve user id via the existing resolver, fail 400
     INVALID_USER on unresolvable, INVALID_PARAMETER on missing
     type-required fields (cancel requires date_end; create/update/
     non_renewal require date_next_charge — mirror 0023's CHECKs so the RPC
     never sees a payload it will reject);
   - new `WebhookDeps.recordSubscriptionEvent` dep; wire it in
     xsolla-webhook/index.ts buildDeps to the `record_subscription_event`
     RPC with the raw-body sha256 (compute where the raw body is available —
     signature layer already holds it; pass it through cleanly);
   - success → 204 (Xsolla subscription pages specify 204; existing branches
     keep their current codes);
   - RPC failure → 5xx (Xsolla retries; sequential delivery depends on
     honest acks — comment this); duplicate/idempotent-replay from the RPC →
     treat as success 204;
   - unknown notification_type: keep the existing 200-ack path UNCHANGED.
2. `supabase/functions/README.md`: document the four event types, the 204
   convention, sequential-delivery + retry notes, and the sandbox limitation
   (Publisher Account test button cannot emit subscription events — sandbox
   lifecycle only, trial=0 trick for fast renewal). Cite
   developers.xsolla.com/webhooks/subscriptions/*.
3. Tests (`webhookDispatch.test.ts` extend, same mocked-deps style): each of
   the four types → correct dep call shape (subscription_id stringified,
   dates passed, user resolved) + 204; missing required field per type → 400
   INVALID_PARAMETER, dep NOT called; unresolvable user → 400 INVALID_USER;
   dep throws → 5xx; dep reports duplicate → 204; unknown type → 200
   unchanged; signature failure path untouched (existing tests must keep
   passing). Raw-body hash propagation asserted.

## Boundaries
Only: webhookDispatch.ts, xsolla-webhook/index.ts, README.md, the test file.
No SQL, no other edge functions, no client, no commits. Run:
`npm test -- webhookDispatch` and `npm test -- supabase/functions` (paste
exact result lines) + `rtk` lint is run by the orchestrator.

## Report
`SLICE-11-REPORT.md`: summary, files+lines, event→behavior table, test
output, risks (esp. anything the sandbox cannot exercise), provenance
(EXACT model id + effort from runtime config).
