import { describe, expect, it, vi } from 'vitest'
import {
  claimCommunityDie,
  claimNewCollectorPassport,
  EarnedEconomyRpcError,
  fetchEarnedRewardStatus,
} from './earnedEconomy'

const status = {
  programId: 'earned-collection@1/rewards@1',
  economyEditionId: 'earned-collection@1',
  asOf: '2026-07-18T00:00:00Z',
  weekStart: '2026-07-13',
  weeklyRolls: {
    creditedRolls: 7,
    maximumCreditedRolls: 10,
    starsPerRoll: 160,
    starsEarned: 1120,
  },
  passport: {
    state: 'active',
    enrolledPeriodStart: '2026-07-06',
    claimedCount: 1,
    availableClaimCount: 2,
    catchUpClaimCount: 1,
    maximumClaims: 12,
  },
  community: {
    state: 'waiting',
    claimedCount: 0,
    availableClaimCount: 0,
    catchUpClaimCount: 0,
    intervalWeeks: 4,
    nextEligiblePeriodStart: '2026-08-03',
  },
}

const entitlementClaim = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  program_id: 'earned-collection@1/rewards@1',
  account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  claim_kind: 'passport',
  claim_index: 1,
  eligible_period_start: '2026-07-13',
  idempotency_key: 'passport:claim:0001',
  outcome_kind: 'entitlement',
  catalog_item_id: 'adventurer-starter/d10/common@1',
  entitlement_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  wallet_ledger_entry_id: null,
  dust_amount: 0,
  claimed_at: '2026-07-18T00:00:00Z',
}

describe('earned economy RPC client', () => {
  it('returns a validated status contract without swallowing backend data', async () => {
    const rpc = vi.fn(async () => ({ data: status, error: null }))

    await expect(fetchEarnedRewardStatus({ rpc } as never)).resolves.toEqual(status)
    expect(rpc).toHaveBeenCalledWith('get_earned_reward_status')
  })

  it('calls claim RPCs with only the caller-generated idempotency key', async () => {
    const rpc = vi.fn(async (operation: string) => ({
      data: operation === 'claim_community_die'
        ? [{
            ...entitlementClaim,
            claim_kind: 'community',
            idempotency_key: 'community:claim:0001',
            catalog_item_id: 'infernal-obsidian/d10/mythic@1',
          }]
        : entitlementClaim,
      error: null,
    }))
    const client = { rpc } as never

    await expect(
      claimNewCollectorPassport(client, 'passport:claim:0001'),
    ).resolves.toMatchObject({
      claimKind: 'passport',
      claimIndex: 1,
      outcomeKind: 'entitlement',
      catalogItemId: 'adventurer-starter/d10/common@1',
    })
    await expect(
      claimCommunityDie(client, 'community:claim:0001'),
    ).resolves.toMatchObject({
      claimKind: 'community',
      catalogItemId: 'infernal-obsidian/d10/mythic@1',
    })
    expect(rpc).toHaveBeenNthCalledWith(1, 'claim_new_collector_passport', {
      p_idempotency_key: 'passport:claim:0001',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'claim_community_die', {
      p_idempotency_key: 'community:claim:0001',
    })
  })

  it('rejects malformed outcomes and invalid keys instead of silently degrading', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ...entitlementClaim,
        outcome_kind: 'dust',
        dust_amount: 2,
      },
      error: null,
    }))
    const client = { rpc } as never

    await expect(claimNewCollectorPassport(client, 'short')).rejects.toThrow(
      /idempotency key must contain 8 to 160 characters/,
    )
    expect(rpc).not.toHaveBeenCalled()

    await expect(
      claimNewCollectorPassport(client, 'passport:claim:0002'),
    ).rejects.toThrow(/incoherent claim outcome/)
  })

  it('surfaces Supabase and transport failures with operation context', async () => {
    const backendRpc = vi.fn(async () => ({
      data: null,
      error: { message: 'not eligible', code: 'P0001' },
    }))
    await expect(
      claimCommunityDie({ rpc: backendRpc } as never, 'community:claim:0002'),
    ).rejects.toMatchObject({
      name: 'EarnedEconomyRpcError',
      operation: 'claim_community_die',
      code: 'P0001',
    } satisfies Partial<EarnedEconomyRpcError>)

    const transportRpc = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(
      fetchEarnedRewardStatus({ rpc: transportRpc } as never),
    ).rejects.toThrow('get_earned_reward_status failed: offline')
  })
})
