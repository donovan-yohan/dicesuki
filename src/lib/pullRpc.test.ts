import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  commitPullSession,
  fetchActiveStandardPullBanner,
  preparePull,
} from './pullRpc'

const sessionId = '11111111-1111-4111-8111-111111111111'

function rpcClient(data: unknown): SupabaseClient {
  return {
    rpc: vi.fn(async () => ({ data, error: null })),
  } as unknown as SupabaseClient
}

function discoveryClient(data: unknown): SupabaseClient {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(async () => ({ data, error: null })),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return { from: vi.fn(() => query) } as unknown as SupabaseClient
}

function revealData(overrides: Record<string, unknown> = {}) {
  return {
    session_id: sessionId,
    banner_version_id: 'standard-banner@2',
    pull_count: 1,
    held_amount: 1,
    committed_at: '2026-07-24T00:00:01Z',
    commitment_scheme: 'sha256-result-v1+sha256-root-v1',
    commitment_root: 'a'.repeat(64),
    rng_scheme: 'hmac-sha256-seed-v1',
    rng_seed: 'b'.repeat(64),
    results: [{
      position: 1,
      catalog_item_id: 'item-a',
      tier_id: 'signature',
      tier_rank: 3,
      selected_target_catalog_item_id: null,
      reason: 'base',
      rare_before: 0,
      rare_after: 0,
      epic_before: 0,
      epic_after: 0,
      selected_before: 0,
      selected_after: 0,
      is_duplicate: true,
      duplicate_dust_amount: 25,
      is_first_copy: false,
      nonce: 'c'.repeat(64),
      commitment: 'd'.repeat(64),
    }],
    ...overrides,
  }
}

function prepareDataForTest(overrides: Record<string, unknown> = {}) {
  return {
    session_id: sessionId,
    banner_version_id: 'standard-banner@2',
    pull_count: 1,
    held_amount: 1,
    prepared_at: '2026-07-24T00:00:00Z',
    expires_at: '2026-07-24T00:02:00Z',
    commitment_scheme: 'sha256-result-v1+sha256-root-v1',
    commitment_root: 'a'.repeat(64),
    rng_scheme: 'hmac-sha256-seed-v1',
    ...overrides,
  }
}

describe('pull RPC boundary', () => {
  it('parses the result-free prepare receipt and passes the supplied stable key', async () => {
    const client = rpcClient([prepareDataForTest()])
    const receipt = await preparePull(client, {
      bannerVersionId: 'standard-banner@2',
      pullCount: 1,
      idempotencyKey: 'pull:22222222-2222-4222-8222-222222222222',
    })
    expect(receipt.sessionId).toBe(sessionId)
    expect(client.rpc).toHaveBeenCalledWith('prepare_pull', {
      p_banner_version_id: 'standard-banner@2',
      p_pull_count: 1,
      p_idempotency_key: 'pull:22222222-2222-4222-8222-222222222222',
    })
  })

  it('threads the real 0021 first-copy and copy+Dust receipt fields', async () => {
    const receipt = await commitPullSession(rpcClient(revealData()), sessionId)
    expect(receipt.results[0]).toMatchObject({
      isDuplicate: true,
      isFirstCopy: false,
      duplicateDustAmount: 25,
    })
  })

  it.each([
    ['commitment scheme', { commitment_scheme: 'future-scheme' }],
    ['rng scheme', { rng_scheme: 'future-rng' }],
    ['ticket hold amount', { held_amount: 160 }],
    ['first-copy duplicate contradiction', {
      results: [{
        ...revealData().results[0],
        is_duplicate: true,
        is_first_copy: true,
      }],
    }],
  ])('rejects malformed %s receipts', async (_label, overrides) => {
    await expect(commitPullSession(
      rpcClient(revealData(overrides)),
      sessionId,
    )).rejects.toThrow(/unsupported|non-ticket|duplicate marked as a first copy/)
  })

  it.each([
    ['commitment scheme', { commitment_scheme: 'future-scheme' }],
    ['rng scheme', { rng_scheme: 'future-rng' }],
    ['ticket hold amount', { held_amount: 160 }],
  ])('rejects malformed prepare %s', async (_label, overrides) => {
    await expect(preparePull(rpcClient([prepareDataForTest(overrides)]), {
      bannerVersionId: 'standard-banner@2',
      pullCount: 1,
      idempotencyKey: 'pull:22222222-2222-4222-8222-222222222222',
    })).rejects.toThrow(/non-ticket hold amount|unsupported/)
  })

  it('fails closed when only the seeded legacy Stars-funded banner exists', async () => {
    expect(await fetchActiveStandardPullBanner(discoveryClient([]))).toBeNull()
  })

  it('discovers exactly one provided ticket-bound standard banner', async () => {
    await expect(fetchActiveStandardPullBanner(discoveryClient([{
      id: 'standard-banner@2',
      banner_id: 'standard-banner',
      banner_version: 2,
      banner_family_id: 'standard-family',
      banner_class: 'standard',
      roll_type: 'standard_roll',
    }]))).resolves.toEqual({
      bannerVersionId: 'standard-banner@2',
      bannerId: 'standard-banner',
      bannerVersion: 2,
      bannerFamilyId: 'standard-family',
      bannerClass: 'standard',
      rollType: 'standard_roll',
    })
  })
})
