// Edge Function: create-checkout (JWT-authenticated)
//
// Flow (exec plan Packet B.1):
//   1. Verify the Supabase JWT; reject anonymous/guest users.
//   2. Validate the client SKU against the SERVER-side price catalog + DB
//      (invariant #5 — never trust a client-sent price/SKU mapping).
//   3. Open a `pending` payment_orders row via the create_payment_order RPC
//      (migration 0013 grants service_role SELECT only on the table — a direct
//      insert is 'permission denied'; the RPC returns the row + its external_id).
//   4. Mint an Xsolla Pay Station payment token.
//   5. Return { token, external_id }.
//
// Deployed with verify_jwt on:
//   supabase functions deploy create-checkout --project-ref nksxdfcjabgbxeefwkdc

import { createServiceRoleClient, createUserClient, requireEnv } from '../_shared/supabaseClient.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { lookupProduct, minorToMajor } from '../_shared/catalog.ts'
import { buildXsollaTokenRequest } from '../_shared/xsollaToken.ts'

/** Sandbox-only slice: default to sandbox unless XSOLLA_SANDBOX is explicitly "false". */
function isSandbox(): boolean {
  return (Deno.env.get('XSOLLA_SANDBOX') ?? 'true').toLowerCase() !== 'false'
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405)
  }

  // 1. Authenticate. Reject missing/invalid tokens and anonymous (guest) users.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' } }, 401)
  }
  const userClient = createUserClient(authHeader)
  const { data: userData, error: userError } = await userClient.auth.getUser()
  const user = userData?.user
  if (userError || !user) {
    return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401)
  }
  if (user.is_anonymous === true) {
    return jsonResponse(
      { error: { code: 'ANONYMOUS_FORBIDDEN', message: 'Purchases require a signed-in account' } },
      403,
    )
  }

  // 2. Parse request + server-side SKU/price lookup.
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: { code: 'INVALID_BODY', message: 'Body must be JSON' } }, 400)
  }
  const sku = (payload as { sku?: unknown } | null)?.sku
  const product = lookupProduct(sku)
  if (!product) {
    return jsonResponse({ error: { code: 'UNKNOWN_SKU', message: 'Unknown or unavailable SKU' } }, 400)
  }

  const service = createServiceRoleClient()

  // Defense in depth: the catalog item the SKU grants must actually exist.
  const { data: catalogRow, error: catalogError } = await service
    .from('catalog_items')
    .select('id')
    .eq('id', product.catalogItemId)
    .maybeSingle()
  if (catalogError) {
    console.error('catalog_items lookup failed', catalogError)
    return jsonResponse({ error: { code: 'CATALOG_ERROR', message: 'Catalog lookup failed' } }, 500)
  }
  if (!catalogRow) {
    console.error('SKU maps to missing catalog_item', product.sku, product.catalogItemId)
    return jsonResponse(
      { error: { code: 'CATALOG_MISCONFIGURED', message: 'SKU is not purchasable' } },
      500,
    )
  }

  // 3. Open the pending order through the service-role SECURITY DEFINER boundary.
  //    A direct `.from('payment_orders').insert(...)` fails 'permission denied':
  //    migration 0013 grants service_role SELECT only on the table; every write
  //    flows through the create/fulfill/refund functions. The RPC generates the
  //    order's external_id and returns the row — we no longer mint one here.
  const sandbox = isSandbox()
  const { data: orderData, error: createOrderError } = await service.rpc('create_payment_order', {
    p_user_id: user.id,
    p_catalog_item_id: product.catalogItemId,
    p_amount_minor: product.amountMinor,
    p_currency: product.currency,
    p_dry_run: sandbox,
  })
  if (createOrderError) {
    console.error('create_payment_order failed', createOrderError)
    return jsonResponse({ error: { code: 'ORDER_INSERT_FAILED', message: 'Could not open order' } }, 500)
  }
  // `create_payment_order` returns public.payment_orders (the row); PostgREST
  // hands it back as an object (array-wrapped for a SETOF-shaped return).
  const orderRow = (Array.isArray(orderData) ? orderData[0] : orderData) as
    | { external_id?: unknown }
    | null
  const externalId =
    typeof orderRow?.external_id === 'string' ? orderRow.external_id : null
  if (!externalId) {
    console.error('create_payment_order returned no external_id', orderData)
    return jsonResponse({ error: { code: 'ORDER_INSERT_FAILED', message: 'Could not open order' } }, 500)
  }

  // 4. Mint the Xsolla payment token.
  const built = buildXsollaTokenRequest({
    projectId: requireEnv('XSOLLA_PROJECT_ID'),
    merchantAuth: {
      merchantId: requireEnv('XSOLLA_MERCHANT_ID'),
      projectId: requireEnv('XSOLLA_PROJECT_ID'),
      apiKey: requireEnv('XSOLLA_API_KEY'),
    },
    supabaseUserId: user.id,
    externalId,
    amount: minorToMajor(product.amountMinor),
    currency: product.currency,
    itemName: product.name,
    sandbox,
    returnUrl: Deno.env.get('XSOLLA_RETURN_URL') ?? undefined,
  })

  let xsollaResponse: Response
  try {
    xsollaResponse = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: JSON.stringify(built.body),
    })
  } catch (err) {
    console.error('Xsolla token request threw', err)
    return jsonResponse({ error: { code: 'XSOLLA_UNREACHABLE', message: 'Payment provider unreachable' } }, 502)
  }

  if (!xsollaResponse.ok) {
    const detail = await xsollaResponse.text().catch(() => '')
    console.error('Xsolla token request failed', xsollaResponse.status, detail)
    return jsonResponse({ error: { code: 'XSOLLA_TOKEN_FAILED', message: 'Could not create checkout' } }, 502)
  }

  const tokenBody = (await xsollaResponse.json().catch(() => null)) as { token?: string } | null
  const token = tokenBody?.token
  if (!token) {
    console.error('Xsolla token response missing token', tokenBody)
    return jsonResponse({ error: { code: 'XSOLLA_TOKEN_MISSING', message: 'Malformed provider response' } }, 502)
  }

  // 5. Hand the token + our external_id back to the client.
  return jsonResponse({ token, external_id: externalId }, 200)
})
