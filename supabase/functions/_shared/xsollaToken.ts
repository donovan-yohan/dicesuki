// Xsolla Pay Station payment-token request builder.
//
// Endpoint (store API v3, project-scoped admin):
//   POST https://store.xsolla.com/api/v3/project/{project_id}/admin/payment/token
//
// This module produces the { url, method, headers, body } for that request as a
// pure value so the exact wire shape is unit-testable without a live API. The
// caller performs the actual fetch.
//
// Pure module: no Deno globals, no URL imports — importable by Deno and Vitest.
// `btoa` is a Web/Deno/Node-global; available in all three runtimes.

/**
 * HTTP Basic-auth principal ambiguity — encode BOTH options behind this one
 * clearly-marked constant.
 *
 * Xsolla's own docs are inconsistent about which id pairs with the API key on
 * the `store.xsolla.com/api/v3/.../admin/payment/token` endpoint:
 *   - The Store API v3 admin reference documents `base64(merchant_id:api_key)`
 *     (the API key is a MERCHANT-level credential, so it pairs with merchant_id).
 *   - The exec plan (docs/exec-plans/.../xsolla-sandbox-payments.md, Packet B)
 *     wrote `base64(project_id:api_key)` and flagged "docs show two variants".
 *
 * We default to `'merchant_id'` (the Store API v3 admin convention). If the
 * sandbox handshake 401s, flip this ONE constant to `'project_id'` — both
 * encodings are implemented below, so go-live is a single-line switch, not code.
 */
export const XSOLLA_TOKEN_BASIC_AUTH_PRINCIPAL: 'merchant_id' | 'project_id' = 'merchant_id'

export interface XsollaMerchantAuth {
  merchantId: string
  projectId: string
  apiKey: string
}

/**
 * Build the `Authorization: Basic <base64(principal:api_key)>` header value.
 * `principal` selection is governed by XSOLLA_TOKEN_BASIC_AUTH_PRINCIPAL.
 */
export function buildBasicAuthHeader(
  auth: XsollaMerchantAuth,
  principal: 'merchant_id' | 'project_id' = XSOLLA_TOKEN_BASIC_AUTH_PRINCIPAL,
): string {
  const id = principal === 'merchant_id' ? auth.merchantId : auth.projectId
  const credentials = `${id}:${auth.apiKey}`
  return `Basic ${btoa(credentials)}`
}

export interface XsollaTokenRequestInput {
  /** Xsolla project id (numeric string), used in the URL and settings. */
  projectId: string
  /** Xsolla merchant id + api key for HTTP Basic auth. */
  merchantAuth: XsollaMerchantAuth
  /** Supabase user id → user.id.value (identifies the payer to Xsolla). */
  supabaseUserId: string
  /** Our order external_id → settings.external_id, echoed back in webhooks. */
  externalId: string
  /** Purchase price in MAJOR currency units (e.g. 4.99). */
  amount: number
  /** ISO-4217 currency, uppercase. */
  currency: string
  /** Human-readable line-item name for the checkout UI. */
  itemName: string
  /** Sandbox flag (from XSOLLA_SANDBOX). true → sandbox transaction. */
  sandbox: boolean
  /** Optional URL Xsolla returns the buyer to after checkout. */
  returnUrl?: string
}

export interface BuiltRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: Record<string, unknown>
}

/**
 * Build the payment-token request. `body` is returned as an object; the caller
 * JSON-stringifies it for the fetch. Shape follows the store API v3 create-token
 * contract: `user.id.value`, `purchase.checkout.{amount,currency}`, and
 * `settings.{project_id, external_id, sandbox}`.
 */
export function buildXsollaTokenRequest(input: XsollaTokenRequestInput): BuiltRequest {
  const projectIdNum = Number(input.projectId)
  const settings: Record<string, unknown> = {
    // project_id is required numeric in settings for the store v3 token.
    project_id: Number.isFinite(projectIdNum) ? projectIdNum : input.projectId,
    // external_id ties the Xsolla order back to OUR payment_orders row so the
    // webhook can locate the pending order (invariant #2 correlation key).
    external_id: input.externalId,
    // Sandbox toggle: a single env-driven switch, per the scope guard
    // ("Sandbox flag = single env switch so go-live is config, not code").
    sandbox: input.sandbox,
  }
  if (input.returnUrl) {
    settings.return_url = input.returnUrl
  }

  const body: Record<string, unknown> = {
    user: {
      id: { value: input.supabaseUserId },
    },
    purchase: {
      checkout: {
        currency: input.currency,
        amount: input.amount,
      },
      description: {
        items: [
          {
            name: input.itemName,
            price: {
              amount: input.amount,
              currency: input.currency,
            },
            quantity: 1,
          },
        ],
      },
    },
    settings,
  }

  return {
    url: `https://store.xsolla.com/api/v3/project/${input.projectId}/admin/payment/token`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: buildBasicAuthHeader(input.merchantAuth),
    },
    body,
  }
}
