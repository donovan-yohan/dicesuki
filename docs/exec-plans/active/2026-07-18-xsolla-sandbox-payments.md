# Xsolla Sandbox Payments Infrastructure (issue #153 groundwork)

> Status: ACTIVE — sandbox-only. Real payments blocked on Xsolla merchant agreement (legal in progress).
> Provider decision: **Xsolla Pay Station** (Merchant of Record). Client SDK: `@xsolla/pay-station-sdk` (headless, TS, framework-agnostic — pin exact version via `npm view @xsolla/pay-station-sdk version` at implementation time).
> Scope guard: **direct cosmetic purchases only.** No paid randomized chests (gated by #154). No currency purchase in this slice. Sandbox flag = single env switch so go-live is config, not code.

## Non-negotiable invariants (from epic #155 / issue #153)

1. Fulfillment truth is the **webhook**, never the success redirect. "Never grant from success redirect alone."
2. Idempotent: duplicate/out-of-order webhooks cannot double-grant. Unique key = Xsolla `transaction.id` (+ our `external_id`).
3. Forged webhook fails closed: verify `Authorization: Signature <sha1(raw_body + webhook_secret)>` against the **raw** request body (never re-serialized JSON). Mismatch → 400.
4. Refund/chargeback path explicit: `refund` webhook reverses entitlement + marks ledger row; auditable.
5. Server-side price lookup — never trust client-sent price/SKU mapping.
6. Sandbox transactions (`transaction.dry_run == 1`) ledger separately; must not grant production entitlements outside sandbox env.
7. Axum room servers stay physics-only (Server-ADR-001 / Shared-ADR-006). All payment logic in Supabase.

## Work packets (one PR each, in order)

### Packet A — schema: paid bucket + payment orders (migration 0013)

> Note 2026-07-18 evening: PRs #168/#169 landed migrations 0011 (earned pull preparation holds, ADR shared/016) and 0012 (FK indexes). Packet A is now migration 0013. Study 0011's conventions (sealed holds, idempotent RPC patterns) before writing 0013 — reuse its style. Live DB has only 0001–0010 applied; 0011/0012 must be applied before 0013.

- Migration file: follow the existing `NNNN_name.sql` convention (next: `0013_`). Extend `wallet_balances.balance_bucket` CHECK to include `'paid'` (currently `('promotional','earned')`).
- New `payment_orders` table (immutable-ish state machine): `id`, `external_id` (uuid, unique — ours, sent to Xsolla), `user_id`, `catalog_item_id` / bundle ref, `amount_minor` + `currency`, `status` (`pending`→`paid`→`fulfilled` | `canceled` | `refunded`), `xsolla_transaction_id` (bigint, **unique**, null until webhook), `dry_run` bool, `raw_event` jsonb (bounded), timestamps. Own-row SELECT RLS for the buyer; writes only via service role / SECURITY DEFINER path.
- New `payment_events` append-only table keyed by `(xsolla_transaction_id, event_type)` unique — the webhook idempotency lock (INSERT ... ON CONFLICT DO NOTHING).
- RPC `fulfill_payment_order(...)` — SECURITY DEFINER, **service-role only**, single transaction: insert payment_event (idempotency gate) → grant `user_entitlements` row (`provenance = 'purchase'`, `grant_ref = external_id`) → append wallet ledger entry if applicable → flip order status. Replay returns prior result without re-granting (mirror `append_wallet_ledger_entry` pattern from migration 0009).
- Follow existing conventions: immutability triggers, `(select auth.uid())` RLS style, SQL tests in `supabase/tests/0013_*` like 0009/0010/0011.

### Packet B — edge functions (first in repo; `supabase/functions/`)

1. `create-checkout` (JWT-authenticated):
   - Validate Supabase user (reject anon), validate SKU against `catalog_items`, look up server-side price.
   - Insert `payment_orders` row (`pending`, fresh `external_id`).
   - Mint token: `POST https://store.xsolla.com/api/v3/project/{XSOLLA_PROJECT_ID}/admin/payment/token`, HTTP Basic `base64(project_id:api_key)`; body sets `user.id.value = supabase user id`, purchase content, `settings.sandbox` from `XSOLLA_SANDBOX` env. (Verify exact request shape against live API reference — docs show two variants.)
   - Return `{ token, external_id }`.
2. `xsolla-webhook` (public, `--no-verify-jwt`; server-to-server):
   - Read raw body → SHA1 signature check against `XSOLLA_WEBHOOK_SECRET` → 400 on mismatch.
   - Handle `user_validation` (200 if Supabase user exists, 400 otherwise — required or sandbox payments fail), `payment`/`order_paid` (call `fulfill_payment_order`), `refund` (reverse), unknown types → 200 ack.
   - Respond fast (200/204); 5xx triggers Xsolla retries (~20 over 12h for order_paid) — handler must be replay-safe.
- Secrets via `Deno.env`: `XSOLLA_PROJECT_ID`, `XSOLLA_MERCHANT_ID`, `XSOLLA_API_KEY`, `XSOLLA_WEBHOOK_SECRET`, `XSOLLA_SANDBOX=true`. Never in client bundle, never committed.
- All five are SET (2026-07-18) in remote Supabase Edge Function secrets and in gitignored `supabase/functions/.env` for local `supabase functions serve`. Public-safe IDs: project `310909`, merchant `896270` (Publisher Account URL `publisher.xsolla.com/896270/projects/310909/`).
- Deno unit tests: signature verify (raw-body fidelity), replayed transaction → single grant, forged signature → 400, user_validation paths.

### Packet C — client (PWA) sandbox checkout

- Add `@xsolla/pay-station-sdk` (pinned). Feature flag `VITE_PAYMENTS_ENABLED` (default off) — UI renders nothing when off.
- Buy flow: call `create-checkout` → open headless checkout with returned token, `sandbox: true` → persist `external_id` to IndexedDB/localStorage before handoff.
- Return route `/checkout/return` (register in SW denylist like `/room/`): displays status only; polls own `payment_orders.status` / subscribes via Supabase Realtime; "confirming…" until webhook flips it. Cold-relaunch reconciliation from persisted pending order (issue #152 checkout-return safety).
- Entitlement refresh on fulfillment (existing `user_entitlements` read path).
- Vitest: return-route states (pending/paid/fulfilled/refunded), persistence reconciliation, flag-off renders nothing.

## Verification gates (per packet, before merge)

- `npm test` + new tests green; `~/.cargo/bin/cargo test` untouched-green; SQL tests pass against local Supabase (`supabase db reset` + test scripts, pattern from `scripts/test-wallet-ledger-postgres.mjs`).
- Manual sandbox E2E once Packets A–C land: test card → webhook → single entitlement grant; replay webhook → no double grant; refund → revoked.
- `get_advisors` (security) clean or explained after migration.

## Blocked on legal (do NOT build): live api_key wiring, `sandbox=false`, real payout config, production Pay Station URL.

## Reference: research sources in session notes (Xsolla docs, webhook spec, sandbox policy). MoR compliance claims must be confirmed in the actual merchant contract during onboarding (#154).
