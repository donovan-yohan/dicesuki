# Slice 12 — Lunar Pass daily faucet + purchase grant (Lunar Pass slice C)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/12-lunar-daily-faucet` (off main; merged: 0023 subscription
state machine PR #189, recurring webhook PR #190). Spec §3.1: $2.99/mo =
300 Stars on purchase + 90 Stars/day × 30 claimed on login = 3,000/mo.
Spec §3.5 ethic decision: claim-on-login-or-lose-it daily accrual (Genshin
model, defensible for a PAID sub — the spec calls this deliberately).
Pre-#154: ALL Stars land in the promotional bucket (spec/scout: pair rule
stars⇔promotional; paid bucket inert until #154).

Read FIRST: spec §3 + §4; scout truths: the earned_reward_program rail
(0010) is single-pinned to `earned-collection@1/rewards@1`, reward_kind
domain ('passport','community'), NO Stars outcome, frozen by reject-mutation
triggers — a Lunar daily faucet CANNOT ride it; 0010's derived-eligibility
pattern (enrollment + interval math, no mutable progress) is the idiom to
copy. 0023: `is_lunar_pass_active(user, at, product_id)` + user_subscriptions
projection. 0009: canonical promotional-Stars append. 0013+webhook: how a
Star-bundle-like SKU would flow (the 300-instant grant seam).

## Task
`supabase/migrations/0024_lunar_pass_faucet.sql` + colocated `.test.ts` +
behavioral `supabase/tests/0024_lunar_pass_faucet.test.sql`.

1. **Lunar product binding:** define the canonical Lunar Pass product id
   constant once (e.g. 'lunar-pass' — check what slice B/tests already use
   and match) — a small config table or documented constant per repo idiom;
   every gate in this migration filters is_lunar_pass_active on it.
2. **Daily claim RPC** (self-only wrapper + private engine, family hygiene):
   `claim_lunar_daily_stars()`:
   - eligibility: is_lunar_pass_active(uid, now(), lunar_product_id);
   - one claim per UTC day per user (spec §4 uses UTC periods; document);
     claim-or-lose: NO retroactive claims, NO banking (spec §3.5 decision —
     cite it);
   - credits 90 promotional Stars via the canonical 0009 append, idempotency
     key derived from (user, utc_day), distinct prefix; ledger reason code
     distinct (e.g. lunar.daily);
   - append-only claim record table (user, utc_day UNIQUE, subscription_id,
     credited ledger id) with reject-mutation triggers, owner-read RLS;
   - replay same day → prior receipt, zero effects; next day → new claim;
     after cancel/expiry (predicate false) → fail closed with clear errcode.
3. **Purchase grant (300 instant):** RPC `grant_lunar_purchase_stars`
   (service-only — the webhook fulfill path calls it later when the sub SKU
   is wired): credits 300 promotional Stars once per (user, subscription_id,
   billing period) — derive the period key from date_next_charge or
   date_create per 0023's fields; idempotent; append-only grant record.
   Renewal months: SAME rpc fires per renewal (300/mo is part of the 3,000
   monthly total? NO — spec: 300 on purchase + 90×30 daily = 3,000; the 300
   recurs each renewal per Genshin Welkin. Encode: one 300-grant per billing
   period, keyed by the period's date_next_charge advance). Document the
   Welkin-model reasoning.
4. **No webhook wiring in this slice** (the fulfill→grant call lands with
   the sub-SKU slice); no client; dormant.
5. **Behavioral suite** (reset-role discipline, SQLSTATE-pinned): active sub
   → claim credits exactly 90 promo Stars + record row; same-day replay →
   prior receipt zero new rows; different user isolated; UTC day boundary
   (two claims either side of midnight UTC — inject timestamps via a test
   seam like 0017's p_test_* precedent if needed, document it);
   non-subscriber / canceled-past-date_end / non_renewing-past-next_charge →
   fail closed; product-filter mismatch → fail closed; purchase grant: once
   per period, replay idempotent, second period grants again, service-only
   (authenticated call rejected); direct-DML denial; RLS cross-user.

## Boundaries
Only the three new 0024 files. No edge-function, client, or merged-file
edits. No commits, no docker (orchestrator runs harness). Run:
`npm test -- 0024`, `npm test -- supabase/migrations` (paste exact lines).

## Report
`SLICE-12-REPORT.md`: summary, files+lines, design decisions w/ spec
citations (esp. UTC day + claim-or-lose + Welkin recurrence), test output,
risks, provenance (EXACT model id + effort from runtime config).
