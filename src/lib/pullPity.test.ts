import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchMyPullPity,
  PullPityReadError,
  type PullPitySnapshot,
} from './pullPity'

const familyId = 'standard-collection'

const row = {
  banner_family_id: familyId,
  banner_version_id: 'standard-banner@2',
  banner_version: 2,
  total_pulls: 24,
  rare_misses: 3,
  epic_misses: 8,
  selected_misses: 12,
  rare_hard_guarantee_pull: 10,
  epic_hard_guarantee_pull: 40,
  selected_hard_guarantee_pull: 80,
  soft_pity_model: 'linear-rate-ramp',
  soft_pity_start_pull: 60,
  soft_pity_per_pull_increment: 0.015,
}

function clientWith(data: unknown, error: unknown = null): {
  client: SupabaseClient
  rpc: ReturnType<typeof vi.fn>
} {
  const rpc = vi.fn(async () => ({ data, error }))
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  }
}

describe('fetchMyPullPity', () => {
  it('uses the exact self-only RPC args and projects snake_case into a typed snapshot', async () => {
    const { client, rpc } = clientWith([row])

    await expect(fetchMyPullPity(client, familyId)).resolves.toEqual({
      bannerFamilyId: familyId,
      bannerVersionId: 'standard-banner@2',
      bannerVersion: 2,
      totalPulls: 24,
      rareMisses: 3,
      epicMisses: 8,
      selectedMisses: 12,
      rareHardGuaranteePull: 10,
      epicHardGuaranteePull: 40,
      selectedHardGuaranteePull: 80,
      softPityModel: 'linear-rate-ramp',
      softPityStartPull: 60,
      softPityPerPullIncrement: 0.015,
    } satisfies PullPitySnapshot)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('get_my_pull_pity', {
      p_banner_family_id: familyId,
    })
  })

  it('accepts an array singleton with all-null soft-pity configuration', async () => {
    const { client } = clientWith([{
      ...row,
      total_pulls: 0,
      rare_misses: 0,
      epic_misses: 0,
      selected_misses: 0,
      soft_pity_model: null,
      soft_pity_start_pull: null,
      soft_pity_per_pull_increment: null,
    }])

    await expect(fetchMyPullPity(client, familyId)).resolves.toMatchObject({
      totalPulls: 0,
      rareMisses: 0,
      epicMisses: 0,
      selectedMisses: 0,
      softPityModel: null,
      softPityStartPull: null,
      softPityPerPullIncrement: null,
    })
  })

  it.each([
    '',
    'UPPERCASE',
    'ab',
    '-leading-hyphen',
    'contains space',
    'a'.repeat(81),
    null as never,
    undefined as never,
    123 as never,
  ])('rejects invalid banner family id %j before calling the backend', async invalidId => {
    const { client, rpc } = clientWith([row])

    await expect(fetchMyPullPity(client, invalidId)).rejects.toMatchObject({
      name: 'PullPityReadError',
      operation: 'get_my_pull_pity',
      code: '22023',
    } satisfies Partial<PullPityReadError>)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('propagates backend SQLSTATE and operation context', async () => {
    const { client } = clientWith(null, {
      message: 'Unknown pull banner family',
      code: '22023',
    })

    await expect(fetchMyPullPity(client, familyId)).rejects.toMatchObject({
      name: 'PullPityReadError',
      operation: 'get_my_pull_pity',
      code: '22023',
      message: 'get_my_pull_pity failed: Unknown pull banner family',
    } satisfies Partial<PullPityReadError>)
  })

  it('wraps thrown transport and non-Error client failures', async () => {
    const offline = {
      rpc: vi.fn(async () => {
        throw new Error('offline')
      }),
    } as unknown as SupabaseClient
    await expect(fetchMyPullPity(offline, familyId)).rejects.toThrow(
      'get_my_pull_pity failed: offline',
    )

    const unknown = {
      rpc: vi.fn(async () => {
        throw 'offline'
      }),
    } as unknown as SupabaseClient
    await expect(fetchMyPullPity(unknown, familyId)).rejects.toThrow(
      'get_my_pull_pity failed: unknown client failure',
    )
  })

  it.each([
    null,
    [],
    [row, row],
    row,
    'not-a-row',
    [{ ...row, banner_family_id: 'another-family' }],
    [{ ...row, banner_version_id: '' }],
    [{ ...row, banner_version_id: 'invalid version@2' }],
    [{ ...row, banner_version_id: 'standard-banner@3' }],
    [{ ...row, banner_version: 0 }],
    [{ ...row, total_pulls: -1 }],
    [{ ...row, rare_misses: 1.5 }],
    [{ ...row, epic_misses: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...row, selected_hard_guarantee_pull: 0 }],
    [{ ...row, soft_pity_per_pull_increment: Number.POSITIVE_INFINITY }],
    [{ ...row, soft_pity_per_pull_increment: '0.015' }],
  ])('fails closed on malformed or duplicate response %#', async data => {
    const { client } = clientWith(data)
    await expect(fetchMyPullPity(client, familyId)).rejects.toBeInstanceOf(
      PullPityReadError,
    )
  })

  it.each([
    {
      soft_pity_model: 'linear-rate-ramp',
      soft_pity_start_pull: null,
      soft_pity_per_pull_increment: 0.015,
    },
    {
      soft_pity_model: null,
      soft_pity_start_pull: 60,
      soft_pity_per_pull_increment: null,
    },
    {
      soft_pity_model: 'unsupported',
      soft_pity_start_pull: 60,
      soft_pity_per_pull_increment: 0.015,
    },
    {
      soft_pity_model: 'linear-rate-ramp',
      soft_pity_start_pull: 1,
      soft_pity_per_pull_increment: 0.015,
    },
    {
      soft_pity_model: 'linear-rate-ramp',
      soft_pity_start_pull: 80,
      soft_pity_per_pull_increment: 0.015,
    },
  ])('rejects incoherent soft-pity configuration %#', async softPity => {
    const { client } = clientWith([{ ...row, ...softPity }])
    await expect(fetchMyPullPity(client, familyId)).rejects.toThrow(
      /incoherent soft-pity configuration/,
    )
  })
})
