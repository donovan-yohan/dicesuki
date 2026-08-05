# Slice 12 FIX — invoice-keyed purchase grant + batched findings

## 1. REDESIGN the 300-Star purchase grant (review 🟡×2 — over-grant + paid-denial)
Root cause: `update_subscription` is NOT a charge signal (fires on plan
changes, payment-method updates, dunning-driven date moves), so period-keying
on date_create/date_next_charge can mint 300 Stars without money moving
(plan-change and double-advance cases), and gating on currently-active can
DENY a legitimately paid charge processed after cancellation.

Correct anchor (researched Xsolla ground truth, cited in SLICE-10-TASK.md):
the Pay Station `payment` event for a recurring charge carries a
`purchase.subscription` block (plan_id, subscription_id, product_id,
date_next_charge) and a unique transaction/invoice id — the ONLY reliable
"money actually moved" signal, covering both the first charge (create fires
after first successful payment) and every renewal.

Rework `grant_lunar_purchase_stars`:
- Keyed by (user_id, subscription_id, xsolla transaction/invoice id):
  UNIQUE; one 300-Star promotional grant per charge invoice. Drop the
  period-key derivation entirely.
- Signature: service-only, takes the invoice/transaction id + subscription
  block fields the payment webhook path actually has (subscription_id,
  plan_id, product_id as strings) — NOT a subscription_events FK (payment
  events don't land in that ledger). Validate product_id ==
  private.lunar_pass_product_id() (grant is Lunar-scoped); NO
  currently-active requirement — a paid charge grants unconditionally
  (document why: refunds reverse via the refund path, not by withholding).
- Idempotency: ledger key derived from the invoice id (canonical text — no
  timestamptz::text session-TZ dependence anywhere, review 🔵); replay →
  prior receipt, zero effects; drift (same invoice, different amount/sub) →
  fail closed.
- Grant record table adjusted accordingly (append-only, reject-mutation,
  FORCE RLS owner-read, FK auth.users; keep FK to subscription state OUT —
  payment may precede subscription-event processing; document ordering
  independence).
- Wiring contract comment: the (future) payment-fulfill branch calls this
  when a `payment` event carries purchase.subscription with the Lunar
  product; never from update_subscription.

## 2. Cross-slice harness failure (orchestrator-found, live):
`0023_subscription_status.test.sql` truncate-denial case now dies on
`0A000/FK: Table "lunar_purchase_star_grants" references "subscription_events"`
before the reject trigger fires. IF your rework (item 1) removes that FK, the
case passes again unchanged — verify. If any 0024 FK to subscription_events
remains, update the 0023 suite's truncate case to prove truncate-denial in
the FK era (e.g. attempt the multi-table truncate and assert the reject
trigger's 55000 still wins). Do not weaken the assertion.

## 3. (🔵) Single-source the amounts: 90 and 300 defined once each (immutable
private function or constant table per repo idiom), referenced by CHECKs,
appends, and inserts; static-test the single-sourcing.

## 4. Suite updates: rewrite the purchase-grant behavioral scenarios for
invoice keying — same invoice replay idempotent; distinct invoice same period
→ grants (that IS correct now: two real charges = two grants); plan-change
update event → NO grant path exists to call (assert service function rejects
product mismatch + drift); paid-after-cancel invoice → GRANTS (the fixed
denial case); daily-claim scenarios unchanged (keep green).

Run: `npm test -- 0024`, `npm test -- 0023`, `npm test -- supabase/migrations`
(paste exact lines). No docker. SLICE-12-REPORT.md rev 2 (keep rev 1).
