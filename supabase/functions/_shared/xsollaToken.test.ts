// Token-request body shape + Basic-auth encoding. Pure module — no Deno.

import { describe, it, expect } from 'vitest'
import {
  buildBasicAuthHeader,
  buildXsollaTokenRequest,
  XSOLLA_TOKEN_BASIC_AUTH_PRINCIPAL,
  type XsollaTokenRequestInput,
} from './xsollaToken.ts'

const merchantAuth = { merchantId: '896270', projectId: '310909', apiKey: 'test-api-key' }

function decodeBasic(header: string): string {
  const b64 = header.replace(/^Basic\s+/, '')
  return atob(b64)
}

describe('buildBasicAuthHeader', () => {
  it('encodes merchant_id:api_key when principal is merchant_id', () => {
    const header = buildBasicAuthHeader(merchantAuth, 'merchant_id')
    expect(decodeBasic(header)).toBe('896270:test-api-key')
  })

  it('encodes project_id:api_key when principal is project_id', () => {
    const header = buildBasicAuthHeader(merchantAuth, 'project_id')
    expect(decodeBasic(header)).toBe('310909:test-api-key')
  })

  it('defaults to the XSOLLA_TOKEN_BASIC_AUTH_PRINCIPAL constant', () => {
    const header = buildBasicAuthHeader(merchantAuth)
    const expectedId =
      XSOLLA_TOKEN_BASIC_AUTH_PRINCIPAL === 'merchant_id' ? '896270' : '310909'
    expect(decodeBasic(header)).toBe(`${expectedId}:test-api-key`)
  })
})

describe('buildXsollaTokenRequest', () => {
  const base: XsollaTokenRequestInput = {
    projectId: '310909',
    merchantAuth,
    supabaseUserId: 'user-uuid-123',
    externalId: 'order-ext-abc',
    amount: 4.99,
    currency: 'USD',
    itemName: 'Celestial Gold d20',
    sandbox: true,
  }

  it('targets the store v3 project-scoped token endpoint via POST', () => {
    const req = buildXsollaTokenRequest(base)
    expect(req.method).toBe('POST')
    expect(req.url).toBe(
      'https://store.xsolla.com/api/v3/project/310909/admin/payment/token',
    )
    expect(req.headers['Content-Type']).toBe('application/json')
    expect(req.headers.Authorization).toMatch(/^Basic /)
  })

  it('sets user.id.value to the Supabase user id', () => {
    const req = buildXsollaTokenRequest(base)
    const user = req.body.user as { id: { value: string } }
    expect(user.id.value).toBe('user-uuid-123')
  })

  it('sets purchase.checkout amount + currency from server-side price', () => {
    const req = buildXsollaTokenRequest(base)
    const purchase = req.body.purchase as { checkout: { amount: number; currency: string } }
    expect(purchase.checkout.amount).toBe(4.99)
    expect(purchase.checkout.currency).toBe('USD')
  })

  it('carries external_id, numeric project_id, and sandbox flag in settings', () => {
    const req = buildXsollaTokenRequest(base)
    const settings = req.body.settings as {
      external_id: string
      project_id: number
      sandbox: boolean
      return_url?: string
    }
    expect(settings.external_id).toBe('order-ext-abc')
    expect(settings.project_id).toBe(310909)
    expect(settings.sandbox).toBe(true)
    expect(settings.return_url).toBeUndefined()
  })

  it('reflects sandbox=false and includes return_url when provided', () => {
    const req = buildXsollaTokenRequest({ ...base, sandbox: false, returnUrl: 'https://x/return' })
    const settings = req.body.settings as { sandbox: boolean; return_url?: string }
    expect(settings.sandbox).toBe(false)
    expect(settings.return_url).toBe('https://x/return')
  })
})
