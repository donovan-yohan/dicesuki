# Slice 10 — Subscription status schema + event state machine (Lunar Pass slice A)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/10-subscription-status` (off main, migrations through 0022).
Spec §3 (Lunar Pass $2.99/mo) + §3.3/§3.6 gates; ADR-017. This slice is
SCHEMA + RPC only, dormant — the webhook branch (slice B), daily faucet
(slice C), and client (slice D) come later. Read 0013 (payment_orders +
payment_events idioms — service-role definer, append-only, buyer RLS,
Realtime), 0009 (ledger append), 0014/0020 (idempotency conventions).

## Xsolla ground truth (researched from official docs — encode EXACTLY this;
cite developers.xsolla.com/webhooks/subscriptions/* in comments)
- Exactly FOUR subscription notification_types arrive on the SAME webhook
  endpoint/signature as existing one-shot events:
  `create_subscription` (first activation; date_create, date_next_charge,
  plan_id, subscription_id, optional trial/is_gift),
  `update_subscription` (EVERY renewal AND plan/date change; date_next_charge,
  plan_id; NO status, NO date_end),
  `non_renewal_subscription` (auto-renew off, active to cycle end;
  date_next_charge = the charge that will NOT happen),
  `cancel_subscription` (terminal: user cancel / expiry / retries exhausted /
  post-refund; date_end; NO reason field).
- NO status field, NO event id/sequence number on any payload. NO webhook for
  failed renewal/grace/dunning (invisible; only outcomes arrive).
  subscription_id: store as TEXT (docs show both string and int). user.id
  required. Payload envelope: {notification_type, settings{project_id,...},
  user{id,...}, subscription{...}}.
- Delivery: sequential (next event not sent until current is 2xx-acked);
  duplicates possible; dedupe guidance = replay prior result.
- Recommended dedupe key: (subscription_id, notification_type,
  relevant date field, raw-body sha256).

## Task
`supabase/migrations/0023_subscription_status.sql` + colocated `.test.ts`
+ behavioral `supabase/tests/0023_subscription_status.test.sql`.

1. **`subscription_events`** append-only ledger (0013 payment_events idiom):
   user_id FK auth.users, subscription_id text, notification_type text
   (allowlist the four + 'unknown' passthrough class — decide and document),
   plan_id, product_id, date_create/date_next_charge/date_end (nullable
   timestamptz as per event), raw_payload jsonb, body_sha256, received_at.
   UNIQUE dedupe key per the research recommendation. Reject-mutation
   triggers (repo standard).
2. **`user_subscriptions`** projected snapshot (wallet_balances idiom): one
   row per (user_id, subscription_id): status text in
   ('active','non_renewing','canceled'), plan_id, date_next_charge, date_end,
   updated_at. Projection is MONOTONE and TERMINAL-DOMINANT:
   rank active(0) < non_renewing(1) < canceled(2, absorbing); status NEVER
   decreases in rank; within-rank refreshes take the newest date fields.
   Specifically: create → active (but if the same subscription_id is already
   canceled, append the event, do NOT resurrect — a genuine new signup gets a
   new subscription_id); update → refresh dates/plan ONLY while rank < 1
   is... precisely: ignored for projection when rank >= non_renewing;
   non_renewal → rank 1 unless already canceled; cancel → rank 2 always.
3. **`record_subscription_event` RPC** (private engine + service-only
   exposure; SECURITY DEFINER hygiene per family): input = the parsed
   envelope fields + raw body hash; idempotent (dedupe hit → return prior
   result, no reprojection); appends then recomputes the projection per the
   monotone rules in one transaction; unknown notification_type → append with
   its own class, NO projection change, receipt marks it unprocessed.
4. **Entitlement predicate** `is_lunar_pass_active(user_id, at timestamptz)`
   (stable, definer, service + authenticated-self exposure): entitled iff a
   user_subscriptions row has: status='active' (entitled regardless of date —
   grace/retry are invisible and access continues per Xsolla), OR
   status='non_renewing' AND at < date_next_charge, OR status='canceled' AND
   date_end IS NOT NULL AND at < date_end. Document each arm with the Xsolla
   citation. NULL-safe (0018/0019 lesson — no three-valued escapes).
5. RLS: owner reads own rows both tables; service-only writes; Realtime
   publication on user_subscriptions (0013's payment_orders precedent) for
   the future client watcher.
6. Gates: comment-tag the rail like 0013 does — schema lands dormant/[free];
   monetary activation rides #154 + subscription-law (spec §3.6).
7. **Behavioral suite** (reset-role discipline; SQLSTATE-pinned): full happy
   lifecycle create→update(renewal advances date)→non_renewal→cancel with
   projection asserted at each step; out-of-order safety: cancel then late
   update → still canceled, dates unchanged; create-after-cancel same id →
   event appended, projection still canceled; dedupe replay → prior receipt,
   zero new rows; unknown type → ledger row, projection untouched;
   entitlement predicate truth table across all states/date combos incl.
   NULLs; RLS cross-user denial; direct-DML denial.

## Boundaries
Only the three new 0023 files. No edge-function/webhook changes (slice B).
No commits, no docker (orchestrator runs harness). Run:
`npm test -- 0023`, `npm test -- supabase/migrations` (paste exact lines).

## Report
`SLICE-10-REPORT.md`: summary, files+lines, state-machine decisions with doc
citations, test output, risks, provenance (EXACT model id + effort from
runtime config).
