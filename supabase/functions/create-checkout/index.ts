// Edge Function: create-checkout (JWT-authenticated)
//
// Flow (exec plan Packet B.1):
//   1. Verify the Supabase JWT; reject anonymous/guest users.
//   2. Validate the client SKU against the legacy die map or non-die registry
//      (invariant #5 — never trust a client-sent price/SKU mapping).
//   3. Open a `pending` payment_orders row via the class-specific creation RPC
//      (migration 0013 grants service_role SELECT only on the table — a direct
//      insert is 'permission denied'; the RPC returns the row + its external_id).
//   4. Mint an Xsolla Pay Station payment token.
//   5. Return { token, external_id }.
//
// Deployed with verify_jwt on:
//   supabase functions deploy create-checkout --project-ref nksxdfcjabgbxeefwkdc

import { createServiceRoleClient, createUserClient, requireEnv } from '../_shared/supabaseClient.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  minorToMajor,
  resolveCheckoutProduct,
  type RegistrySkuRow,
} from '../_shared/catalog.ts'
import {
  openCheckoutOrder,
  unwrapPaymentOrderRow,
  type PaymentOrderRpcResponse,
} from '../_shared/checkout.ts'
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
  const service = createServiceRoleClient()
  const { product, lookupError } = await resolveCheckoutProduct(
    sku,
    async (registrySku) => {
      const { data, error } = await service
        .from('store_skus')
        .select('sku_id,sku_class,price_usd_cents,status,product_id')
        .eq('sku_id', registrySku)
        .in('sku_class', ['star_bundle', 'subscription'])
        .in('status', ['sandbox', 'live'])
        .maybeSingle()
      return { data: data as RegistrySkuRow | null, error }
    },
  )
  if (lookupError) {
    console.error('store_skus lookup failed', lookupError)
    return jsonResponse({ error: { code: 'CATALOG_ERROR', message: 'Catalog lookup failed' } }, 500)
  }
  if (!product) {
    return jsonResponse({ error: { code: 'UNKNOWN_SKU', message: 'Unknown or unavailable SKU' } }, 400)
  }

  // Preserve the legacy die path's catalog existence backstop. Registry SKUs
  // are non-die by construction and are revalidated atomically by their RPC.
  if (product.source === 'legacy_catalog') {
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
  }

  let xsollaSubscription:
    | { planId: string; productId: string }
    | undefined
  if (product.source === 'registry' && product.skuClass === 'subscription') {
    const planId = (Deno.env.get('XSOLLA_LUNAR_PLAN_ID') ?? '').trim()
    if (!planId || !product.productId) {
      console.error('Lunar checkout provider binding is missing')
      return jsonResponse(
        { error: { code: 'CATALOG_MISCONFIGURED', message: 'SKU is not purchasable' } },
        500,
      )
    }
    xsollaSubscription = { planId, productId: product.productId }
  }

  // 3. Open the pending order through its service-role SECURITY DEFINER boundary.
  //    A direct `.from('payment_orders').insert(...)` fails 'permission denied':
  //    migration 0013 grants service_role SELECT only on the table; every write
  //    flows through the create/fulfill/refund functions. The RPC generates the
  //    order's external_id and returns the row — we no longer mint one here.
  const sandbox = isSandbox()
  const { data: orderData, error: createOrderError } = await openCheckoutOrder(
    product,
    user.id,
    sandbox,
    {
      async createCatalogItemOrder(args): Promise<PaymentOrderRpcResponse> {
        const { data, error } = await service.rpc('create_payment_order', {
          p_user_id: args.userId,
          p_catalog_item_id: args.catalogItemId,
          p_amount_minor: args.amountMinor,
          p_currency: args.currency,
          p_dry_run: args.dryRun,
        })
        return { data, error }
      },
      async createRegistrySkuOrder(args): Promise<PaymentOrderRpcResponse> {
        const { data, error } = await service.rpc('create_sku_payment_order', {
          p_user_id: args.userId,
          p_sku_id: args.skuId,
          p_currency: args.currency,
          p_dry_run: args.dryRun,
        })
        return { data, error }
      },
    },
  )
  if (createOrderError) {
    console.error('payment order RPC failed', createOrderError)
    return jsonResponse({ error: { code: 'ORDER_INSERT_FAILED', message: 'Could not open order' } }, 500)
  }
  const orderRow = unwrapPaymentOrderRow(orderData)
  const externalId =
    typeof orderRow?.external_id === 'string' ? orderRow.external_id : null
  if (!externalId) {
    console.error('payment order RPC returned no external_id', orderData)
    return jsonResponse({ error: { code: 'ORDER_INSERT_FAILED', message: 'Could not open order' } }, 500)
  }

  // Registry price may be retuned between the lookup and RPC. The RPC derives
  // and persists its own current registry price atomically; mint the token from
  // that returned order amount so provider and database can never diverge.
  let checkoutAmountMinor = product.amountMinor
  if (product.source === 'registry') {
    if (
      typeof orderRow?.amount_minor !== 'number' ||
      !Number.isSafeInteger(orderRow.amount_minor) ||
      orderRow.amount_minor <= 0 ||
      orderRow.currency !== product.currency
    ) {
      console.error('create_sku_payment_order returned invalid price/currency', orderData)
      return jsonResponse({ error: { code: 'ORDER_INSERT_FAILED', message: 'Could not open order' } }, 500)
    }
    checkoutAmountMinor = orderRow.amount_minor
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
    amount: minorToMajor(checkoutAmountMinor),
    currency: product.currency,
    itemName: product.name,
    sandbox,
    returnUrl: Deno.env.get('XSOLLA_RETURN_URL') ?? undefined,
    subscription: xsollaSubscription,
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
