# Supabase Edge Functions — Xsolla sandbox payments

First edge functions in the repo (exec plan: `docs/exec-plans/active/2026-07-18-xsolla-sandbox-payments.md`, Packet B). Sandbox-only until the Xsolla merchant agreement lands.

| Function | Auth | Purpose |
|----------|------|---------|
| `create-checkout` | JWT (verify on) | Authenticated buy flow: validate SKU → server-side price → open a `pending` order via the `create_payment_order` RPC → mint an Xsolla payment token. Returns `{ token, external_id }` (the RPC-generated external_id). |
| `xsolla-webhook` | **public** (`--no-verify-jwt`) | Server-to-server Xsolla notifications: SHA-1 signature check → dispatch `user_validation` / `payment` / `order_paid` → `fulfill_payment_order`, and `refund` / `chargeback` → `refund_payment_order` (both idempotent RPCs). |

## Layout

```
supabase/functions/
  _shared/
    xsollaSignature.ts   # sha1(raw_body + secret) verify, constant-time compare (PURE)
    xsollaToken.ts       # Xsolla payment-token request builder + Basic-auth encoding (PURE)
    catalog.ts           # server-side SKU → price map (PURE, invariant #5)
    webhookDispatch.ts   # notification routing + idempotent dispatch (PURE)
    supabaseClient.ts    # service-role / user JWT client factories (Deno-only)
    cors.ts              # CORS + JSON response helpers (Deno-only)
  create-checkout/index.ts
  xsolla-webhook/index.ts
```

The `_shared/*.ts` modules ending in "PURE" have no Deno globals and no URL/`npm:` imports, so they are unit-tested under Vitest (`*.test.ts`, run by `npm test`). The `index.ts` entrypoints and `supabaseClient.ts`/`cors.ts` use `Deno.serve`, `Deno.env`, and `npm:@supabase/supabase-js@2`; they run only in the Supabase Edge runtime.

## Secrets

Required (set in remote Supabase Edge secrets **and** in gitignored `supabase/functions/.env` for local serve):

| Var | Notes |
|-----|-------|
| `XSOLLA_PROJECT_ID` | Public-safe id `310909`. |
| `XSOLLA_MERCHANT_ID` | Public-safe id `896270`. |
| `XSOLLA_API_KEY` | Secret. Merchant API key. |
| `XSOLLA_WEBHOOK_SECRET` | Secret. Signs the webhook. |
| `XSOLLA_SANDBOX` | `true` for sandbox. Anything but `"false"` = sandbox (fail-safe). |
| `XSOLLA_RETURN_URL` | Optional. Buyer return URL passed to Xsolla. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Edge runtime — do **not** add them to `.env` for deploy (they are provided).

Set remote secrets:

```bash
supabase secrets set --project-ref nksxdfcjabgbxeefwkdc \
  XSOLLA_PROJECT_ID=310909 \
  XSOLLA_MERCHANT_ID=896270 \
  XSOLLA_API_KEY=... \
  XSOLLA_WEBHOOK_SECRET=... \
  XSOLLA_SANDBOX=true
```

## Deploy

```bash
# JWT-protected checkout function
supabase functions deploy create-checkout --project-ref nksxdfcjabgbxeefwkdc

# Public webhook — MUST be deployed with JWT verification OFF so Xsolla
# (which cannot present a Supabase JWT) can reach it.
supabase functions deploy xsolla-webhook --project-ref nksxdfcjabgbxeefwkdc --no-verify-jwt
```

No `supabase/config.toml` is used; the webhook's public status is set at deploy time via `--no-verify-jwt` (the signature check inside the handler is the real gate).

## Local development

```bash
# Serve both functions with the local .env. --no-verify-jwt applies to the whole
# local serve session, which is what the webhook needs; call create-checkout with
# a real Supabase JWT in the Authorization header when testing it locally.
supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
```

Local URLs:

- `POST http://localhost:54321/functions/v1/create-checkout` — body `{ "sku": "celestial-gold-d20" }`, header `Authorization: Bearer <supabase_jwt>`.
- `POST http://localhost:54321/functions/v1/xsolla-webhook` — header `Authorization: Signature <sha1(raw_body + XSOLLA_WEBHOOK_SECRET)>`.

## Webhook URL for the Xsolla dashboard

Configure in the Xsolla Publisher Account (Project `310909`, Webhooks):

```
https://nksxdfcjabgbxeefwkdc.supabase.co/functions/v1/xsolla-webhook
```

Use the same value for `XSOLLA_WEBHOOK_SECRET` here and in the Xsolla webhook settings. Xsolla signs each request `Authorization: Signature <sha1(raw_request_body + secret)>`; a mismatch returns `400` and the notification is rejected (fail closed).

## Tests

`deno` is not installed in CI/dev here (`which deno` → not found; the Supabase CLI bundles no standalone `deno`). Per the plan, the signature / dispatch / token-shape tests therefore run under **Vitest** against the pure `_shared` modules:

```bash
npm test                       # includes supabase/functions/_shared/*.test.ts
npx vitest run supabase/functions   # just these
```

When `deno` becomes available, the same pure modules can also be exercised with `deno test` (they use only Web-standard APIs); the Vitest suites are the current source of truth.

## Contract dependency (migration 0013 / Packet A)

Packet A owns three service-role-only `SECURITY DEFINER` boundaries. Each
`returns public.payment_orders` — the order ROW, **not** a `{ ok, replay }` jsonb.
No API role holds table DML; every write flows through these functions.

```sql
create_payment_order(          -- create-checkout: open the pending order
  p_user_id         uuid,
  p_catalog_item_id text,
  p_amount_minor    bigint,
  p_currency        text,
  p_dry_run         boolean
) returns public.payment_orders   -- RPC generates external_id; use the returned row

fulfill_payment_order(         -- webhook payment / order_paid → grant
  p_external_id           uuid,     -- locates the pending order (required)
  p_xsolla_transaction_id bigint,   -- Xsolla transaction id (idempotency key)
  p_event_type            text,     -- 'payment' | 'order_paid'
  p_dry_run               boolean,
  p_raw_event             jsonb
) returns public.payment_orders

refund_payment_order(          -- webhook refund / chargeback → reversal
  p_xsolla_transaction_id bigint,   -- locates the fulfilled order (NO external_id)
  p_event_type            text,     -- 'refund' | 'chargeback'
  p_dry_run               boolean,
  p_raw_event             jsonb
) returns public.payment_orders
```

The `(xsolla_transaction_id, event_type)` `payment_events` row is the idempotency
gate: an exact replay (or out-of-order type on an already-advanced order) re-returns
the prior order row and never re-grants/re-revokes. On a hard failure the RPC
`RAISE`s → the webhook returns 5xx so Xsolla retries — **except** a deliberate-no-grant
SQLSTATE (`22023` invalid_parameter_value, e.g. a sandbox/production `dry_run`
mismatch), which the webhook 200-acks + audit-logs so Xsolla stops retrying a
permanently-rejected event. `create-checkout` must NOT insert into `payment_orders`
directly (service_role has SELECT only); it calls `create_payment_order`. If Packet
A's column/param names differ, reconcile against migration 0013.
