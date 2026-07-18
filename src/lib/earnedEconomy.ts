import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommunityRewardState,
  EarnedRewardClaimKind,
  EarnedRewardClaimOutcome,
  EarnedRewardOutcomeKind,
  EarnedRewardStatus,
  PassportRewardState,
} from '../types/earnedEconomy'

type UnknownRecord = Record<string, unknown>

interface EarnedRewardClaimRow {
  id: string
  program_id: string
  account_id: string
  user_id: string
  claim_kind: EarnedRewardClaimKind
  claim_index: number
  eligible_period_start: string
  idempotency_key: string
  outcome_kind: EarnedRewardOutcomeKind
  catalog_item_id: string | null
  entitlement_id: string | null
  wallet_ledger_entry_id: number | null
  dust_amount: number
  claimed_at: string
}

export class EarnedEconomyRpcError extends Error {
  readonly operation: string
  readonly code?: string

  constructor(operation: string, message: string, code?: string) {
    super(`${operation} failed: ${message}`)
    this.name = 'EarnedEconomyRpcError'
    this.operation = operation
    this.code = code
  }
}

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EarnedEconomyRpcError(label, 'backend returned a malformed object')
  }
  return value as UnknownRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EarnedEconomyRpcError(label, 'backend returned a malformed string')
  }
  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label)
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new EarnedEconomyRpcError(label, 'backend returned a malformed integer')
  }
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new EarnedEconomyRpcError(label, 'backend returned an unsupported enum value')
  }
  return value as T
}

function singleton(value: unknown, operation: string): unknown {
  if (!Array.isArray(value)) return value
  if (value.length !== 1) {
    throw new EarnedEconomyRpcError(operation, 'backend returned an unexpected row count')
  }
  return value[0]
}

function parseStatus(value: unknown): EarnedRewardStatus {
  const status = object(value, 'get_earned_reward_status')
  const weekly = object(status.weeklyRolls, 'get_earned_reward_status.weeklyRolls')
  const passport = object(status.passport, 'get_earned_reward_status.passport')
  const community = object(status.community, 'get_earned_reward_status.community')
  const maximumCreditedRolls = integer(
    weekly.maximumCreditedRolls,
    'get_earned_reward_status.weeklyRolls.maximumCreditedRolls',
  )
  const starsPerRoll = integer(
    weekly.starsPerRoll,
    'get_earned_reward_status.weeklyRolls.starsPerRoll',
  )
  const maximumClaims = integer(
    passport.maximumClaims,
    'get_earned_reward_status.passport.maximumClaims',
  )
  const intervalWeeks = integer(
    community.intervalWeeks,
    'get_earned_reward_status.community.intervalWeeks',
  )
  if (maximumCreditedRolls !== 10 || starsPerRoll !== 160 || maximumClaims !== 12 || intervalWeeks !== 4) {
    throw new EarnedEconomyRpcError(
      'get_earned_reward_status',
      'backend reward version does not match the earned-collection@1 client contract',
    )
  }

  return {
    programId: string(status.programId, 'get_earned_reward_status.programId'),
    economyEditionId: string(status.economyEditionId, 'get_earned_reward_status.economyEditionId'),
    asOf: string(status.asOf, 'get_earned_reward_status.asOf'),
    weekStart: string(status.weekStart, 'get_earned_reward_status.weekStart'),
    weeklyRolls: {
      creditedRolls: integer(weekly.creditedRolls, 'get_earned_reward_status.weeklyRolls.creditedRolls'),
      maximumCreditedRolls: 10,
      starsPerRoll: 160,
      starsEarned: integer(weekly.starsEarned, 'get_earned_reward_status.weeklyRolls.starsEarned'),
    },
    passport: {
      state: enumValue<PassportRewardState>(
        passport.state,
        ['not_enrolled', 'active', 'complete'],
        'get_earned_reward_status.passport.state',
      ),
      enrolledPeriodStart: nullableString(
        passport.enrolledPeriodStart,
        'get_earned_reward_status.passport.enrolledPeriodStart',
      ),
      claimedCount: integer(passport.claimedCount, 'get_earned_reward_status.passport.claimedCount'),
      availableClaimCount: integer(
        passport.availableClaimCount,
        'get_earned_reward_status.passport.availableClaimCount',
      ),
      catchUpClaimCount: integer(
        passport.catchUpClaimCount,
        'get_earned_reward_status.passport.catchUpClaimCount',
      ),
      maximumClaims: 12,
    },
    community: {
      state: enumValue<CommunityRewardState>(
        community.state,
        ['not_enrolled', 'waiting', 'claimable'],
        'get_earned_reward_status.community.state',
      ),
      claimedCount: integer(community.claimedCount, 'get_earned_reward_status.community.claimedCount'),
      availableClaimCount: integer(
        community.availableClaimCount,
        'get_earned_reward_status.community.availableClaimCount',
      ),
      catchUpClaimCount: integer(
        community.catchUpClaimCount,
        'get_earned_reward_status.community.catchUpClaimCount',
      ),
      intervalWeeks: 4,
      nextEligiblePeriodStart: nullableString(
        community.nextEligiblePeriodStart,
        'get_earned_reward_status.community.nextEligiblePeriodStart',
      ),
    },
  }
}

function parseClaim(value: unknown, operation: string): EarnedRewardClaimOutcome {
  const row = object(singleton(value, operation), operation) as unknown as EarnedRewardClaimRow
  const claimKind = enumValue<EarnedRewardClaimKind>(
    row.claim_kind,
    ['passport', 'community'],
    `${operation}.claim_kind`,
  )
  const outcomeKind = enumValue<EarnedRewardOutcomeKind>(
    row.outcome_kind,
    ['entitlement', 'dust'],
    `${operation}.outcome_kind`,
  )
  const catalogItemId = nullableString(row.catalog_item_id, `${operation}.catalog_item_id`)
  const entitlementId = nullableString(row.entitlement_id, `${operation}.entitlement_id`)
  const walletLedgerEntryId = row.wallet_ledger_entry_id === null
    ? null
    : integer(row.wallet_ledger_entry_id, `${operation}.wallet_ledger_entry_id`)
  const dustAmount = integer(row.dust_amount, `${operation}.dust_amount`)
  if (
    (outcomeKind === 'entitlement' && (!catalogItemId || !entitlementId || walletLedgerEntryId !== null || dustAmount !== 0)) ||
    (outcomeKind === 'dust' && (catalogItemId !== null || entitlementId !== null || walletLedgerEntryId === null || dustAmount === 0))
  ) {
    throw new EarnedEconomyRpcError(operation, 'backend returned an incoherent claim outcome')
  }

  return {
    id: string(row.id, `${operation}.id`),
    programId: string(row.program_id, `${operation}.program_id`),
    accountId: string(row.account_id, `${operation}.account_id`),
    userId: string(row.user_id, `${operation}.user_id`),
    claimKind,
    claimIndex: integer(row.claim_index, `${operation}.claim_index`),
    eligiblePeriodStart: string(row.eligible_period_start, `${operation}.eligible_period_start`),
    idempotencyKey: string(row.idempotency_key, `${operation}.idempotency_key`),
    outcomeKind,
    catalogItemId,
    entitlementId,
    walletLedgerEntryId,
    dustAmount,
    claimedAt: string(row.claimed_at, `${operation}.claimed_at`),
  }
}

async function rpc(
  client: SupabaseClient,
  operation: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  try {
    const { data, error } = args
      ? await client.rpc(operation, args)
      : await client.rpc(operation)
    if (error) {
      throw new EarnedEconomyRpcError(operation, error.message, error.code)
    }
    return data
  } catch (error) {
    if (error instanceof EarnedEconomyRpcError) throw error
    throw new EarnedEconomyRpcError(
      operation,
      error instanceof Error ? error.message : 'unknown client failure',
    )
  }
}

function assertIdempotencyKey(idempotencyKey: string, operation: string) {
  if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    throw new EarnedEconomyRpcError(operation, 'idempotency key must contain 8 to 160 characters')
  }
}

export async function fetchEarnedRewardStatus(
  client: SupabaseClient,
): Promise<EarnedRewardStatus> {
  return parseStatus(await rpc(client, 'get_earned_reward_status'))
}

async function claim(
  client: SupabaseClient,
  operation: 'claim_new_collector_passport' | 'claim_community_die',
  idempotencyKey: string,
): Promise<EarnedRewardClaimOutcome> {
  assertIdempotencyKey(idempotencyKey, operation)
  return parseClaim(
    await rpc(client, operation, { p_idempotency_key: idempotencyKey }),
    operation,
  )
}

export function claimNewCollectorPassport(
  client: SupabaseClient,
  idempotencyKey: string,
): Promise<EarnedRewardClaimOutcome> {
  return claim(client, 'claim_new_collector_passport', idempotencyKey)
}

export function claimCommunityDie(
  client: SupabaseClient,
  idempotencyKey: string,
): Promise<EarnedRewardClaimOutcome> {
  return claim(client, 'claim_community_die', idempotencyKey)
}
