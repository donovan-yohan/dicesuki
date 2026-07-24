import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PullCancelReceipt,
  PullCount,
  PullPrepareReceipt,
  PullResolutionReason,
  PullRevealReceipt,
  PullRevealResult,
  StandardPullBanner,
} from '../types/pull'

type UnknownRecord = Record<string, unknown>

export type PullRpcOperation =
  | 'discover_standard_pull_banner'
  | 'prepare_pull'
  | 'commit_pull_session'
  | 'get_committed_pull_reveal'
  | 'cancel_pull_session'

export class PullRpcError extends Error {
  readonly operation: PullRpcOperation
  readonly code?: string

  constructor(operation: PullRpcOperation, message: string, code?: string) {
    super(`${operation} failed: ${message}`)
    this.name = 'PullRpcError'
    this.operation = operation
    this.code = code
  }
}

export interface PreparePullRequest {
  bannerVersionId: string
  pullCount: PullCount
  idempotencyKey: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BANNER_VERSION_ID = /^[a-z0-9][a-z0-9-]{2,79}@[1-9]\d*$/
const BANNER_ID = /^[a-z0-9][a-z0-9-]{2,79}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/
const SHA256_HEX = /^[0-9a-f]{64}$/i
export const PULL_COMMITMENT_SCHEME = 'sha256-result-v1+sha256-root-v1' as const
export const PULL_RNG_SCHEME = 'hmac-sha256-seed-v1' as const
const REASONS: readonly PullResolutionReason[] = [
  'base',
  'rare-guarantee',
  'epic-guarantee',
  'selected-guarantee',
  'soft-pity',
]

function object(value: unknown, operation: PullRpcOperation): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PullRpcError(operation, 'backend returned a malformed object')
  }
  return value as UnknownRecord
}

function singleton(value: unknown, operation: PullRpcOperation): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new PullRpcError(operation, 'backend returned an unexpected row count')
    }
    return value[0]
  }
  if (!value) throw new PullRpcError(operation, 'backend returned no receipt')
  return value
}

function string(value: unknown, operation: PullRpcOperation, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PullRpcError(operation, `backend returned malformed ${field}`)
  }
  return value
}

function pattern(
  value: unknown,
  expression: RegExp,
  operation: PullRpcOperation,
  field: string,
): string {
  const result = string(value, operation, field)
  if (!expression.test(result)) {
    throw new PullRpcError(operation, `backend returned malformed ${field}`)
  }
  return result
}

function timestamp(
  value: unknown,
  operation: PullRpcOperation,
  field: string,
): string {
  const result = string(value, operation, field)
  if (Number.isNaN(Date.parse(result))) {
    throw new PullRpcError(operation, `backend returned malformed ${field}`)
  }
  return result
}

function integer(
  value: unknown,
  operation: PullRpcOperation,
  field: string,
  minimum = 0,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new PullRpcError(operation, `backend returned malformed ${field}`)
  }
  return value
}

function pullCount(value: unknown, operation: PullRpcOperation): PullCount {
  if (value !== 1 && value !== 10) {
    throw new PullRpcError(operation, 'backend returned unsupported pull_count')
  }
  return value
}

function boolean(value: unknown, operation: PullRpcOperation, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PullRpcError(operation, `backend returned malformed ${field}`)
  }
  return value
}

function nullableString(
  value: unknown,
  operation: PullRpcOperation,
  field: string,
): string | null {
  return value === null ? null : string(value, operation, field)
}

function parsePrepareReceipt(value: unknown): PullPrepareReceipt {
  const operation = 'prepare_pull'
  const row = object(singleton(value, operation), operation)
  const preparedAt = timestamp(row.prepared_at, operation, 'prepared_at')
  const expiresAt = timestamp(row.expires_at, operation, 'expires_at')
  if (Date.parse(expiresAt) <= Date.parse(preparedAt)) {
    throw new PullRpcError(operation, 'backend returned an incoherent hold window')
  }
  const count = pullCount(row.pull_count, operation)
  const heldAmount = integer(row.held_amount, operation, 'held_amount', 1)
  if (heldAmount !== count) {
    throw new PullRpcError(operation, 'backend returned a non-ticket hold amount')
  }
  if (row.commitment_scheme !== PULL_COMMITMENT_SCHEME) {
    throw new PullRpcError(operation, 'backend returned an unsupported commitment_scheme')
  }
  if (row.rng_scheme !== PULL_RNG_SCHEME) {
    throw new PullRpcError(operation, 'backend returned an unsupported rng_scheme')
  }
  return {
    sessionId: pattern(row.session_id, UUID, operation, 'session_id'),
    bannerVersionId: pattern(
      row.banner_version_id,
      BANNER_VERSION_ID,
      operation,
      'banner_version_id',
    ),
    pullCount: count,
    heldAmount,
    preparedAt,
    expiresAt,
    commitmentScheme: PULL_COMMITMENT_SCHEME,
    commitmentRoot: pattern(
      row.commitment_root,
      SHA256_HEX,
      operation,
      'commitment_root',
    ),
    rngScheme: PULL_RNG_SCHEME,
  }
}

function parseRevealResult(
  value: unknown,
  operation: 'commit_pull_session' | 'get_committed_pull_reveal',
): PullRevealResult {
  const row = object(value, operation)
  const reason = string(row.reason, operation, 'results.reason')
  if (!REASONS.includes(reason as PullResolutionReason)) {
    throw new PullRpcError(operation, 'backend returned unsupported results.reason')
  }
  const isDuplicate = boolean(row.is_duplicate, operation, 'results.is_duplicate')
  const isFirstCopy = boolean(row.is_first_copy, operation, 'results.is_first_copy')
  if (isDuplicate && isFirstCopy) {
    throw new PullRpcError(
      operation,
      'backend returned a duplicate marked as a first copy',
    )
  }
  return {
    position: integer(row.position, operation, 'results.position', 1),
    catalogItemId: string(row.catalog_item_id, operation, 'results.catalog_item_id'),
    tierId: string(row.tier_id, operation, 'results.tier_id'),
    tierRank: integer(row.tier_rank, operation, 'results.tier_rank'),
    selectedTargetCatalogItemId: nullableString(
      row.selected_target_catalog_item_id,
      operation,
      'results.selected_target_catalog_item_id',
    ),
    reason: reason as PullResolutionReason,
    rareBefore: integer(row.rare_before, operation, 'results.rare_before'),
    rareAfter: integer(row.rare_after, operation, 'results.rare_after'),
    epicBefore: integer(row.epic_before, operation, 'results.epic_before'),
    epicAfter: integer(row.epic_after, operation, 'results.epic_after'),
    selectedBefore: integer(row.selected_before, operation, 'results.selected_before'),
    selectedAfter: integer(row.selected_after, operation, 'results.selected_after'),
    isDuplicate,
    isFirstCopy,
    duplicateDustAmount: integer(
      row.duplicate_dust_amount,
      operation,
      'results.duplicate_dust_amount',
    ),
    nonce: pattern(row.nonce, SHA256_HEX, operation, 'results.nonce'),
    commitment: pattern(
      row.commitment,
      SHA256_HEX,
      operation,
      'results.commitment',
    ),
  }
}

function parseRevealReceipt(
  value: unknown,
  operation: 'commit_pull_session' | 'get_committed_pull_reveal',
): PullRevealReceipt {
  const row = object(singleton(value, operation), operation)
  if (!Array.isArray(row.results)) {
    throw new PullRpcError(operation, 'backend returned malformed results')
  }
  const results = row.results.map(value => parseRevealResult(value, operation))
  const count = pullCount(row.pull_count, operation)
  const heldAmount = integer(row.held_amount, operation, 'held_amount', 1)
  if (
    results.length !== count ||
    results.some((result, index) => result.position !== index + 1)
  ) {
    throw new PullRpcError(operation, 'backend returned an incoherent result sequence')
  }
  if (heldAmount !== count) {
    throw new PullRpcError(operation, 'backend returned a non-ticket hold amount')
  }
  if (row.commitment_scheme !== PULL_COMMITMENT_SCHEME) {
    throw new PullRpcError(operation, 'backend returned an unsupported commitment_scheme')
  }
  if (row.rng_scheme !== PULL_RNG_SCHEME) {
    throw new PullRpcError(operation, 'backend returned an unsupported rng_scheme')
  }
  return {
    sessionId: pattern(row.session_id, UUID, operation, 'session_id'),
    bannerVersionId: pattern(
      row.banner_version_id,
      BANNER_VERSION_ID,
      operation,
      'banner_version_id',
    ),
    pullCount: count,
    heldAmount,
    committedAt: timestamp(row.committed_at, operation, 'committed_at'),
    commitmentScheme: PULL_COMMITMENT_SCHEME,
    commitmentRoot: pattern(
      row.commitment_root,
      SHA256_HEX,
      operation,
      'commitment_root',
    ),
    rngScheme: PULL_RNG_SCHEME,
    rngSeed: pattern(row.rng_seed, SHA256_HEX, operation, 'rng_seed'),
    results,
  }
}

async function rpc(
  client: SupabaseClient,
  operation: Exclude<PullRpcOperation, 'discover_standard_pull_banner'>,
  parameters: Record<string, unknown>,
  retryThrownTransport: boolean,
): Promise<unknown> {
  const attempts = retryThrownTransport ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await client.rpc(operation, parameters)
      if (result.error) {
        throw new PullRpcError(operation, result.error.message, result.error.code)
      }
      return result.data
    } catch (error) {
      if (error instanceof PullRpcError) throw error
      if (attempt + 1 < attempts) continue
      throw new PullRpcError(
        operation,
        error instanceof Error ? error.message : 'unknown client failure',
      )
    }
  }
  throw new PullRpcError(operation, 'request did not complete')
}

/**
 * Resolve the only ticket-bound standard banner. Legacy seeded rows whose
 * roll_type is NULL are deliberately excluded: those are Stars-funded and do
 * not satisfy the pull-screen contract.
 */
export async function fetchActiveStandardPullBanner(
  client: SupabaseClient,
): Promise<StandardPullBanner | null> {
  const operation = 'discover_standard_pull_banner'
  let data: unknown
  try {
    const result = await client
      .from('pull_banner_versions')
      .select('id, banner_id, banner_version, banner_family_id, banner_class, roll_type')
      .eq('banner_class', 'standard')
      .eq('roll_type', 'standard_roll')
      .order('banner_version', { ascending: false })
    if (result.error) {
      throw new PullRpcError(operation, result.error.message, result.error.code)
    }
    data = result.data
  } catch (error) {
    if (error instanceof PullRpcError) throw error
    throw new PullRpcError(
      operation,
      error instanceof Error ? error.message : 'unknown client failure',
    )
  }
  if (!Array.isArray(data)) {
    throw new PullRpcError(operation, 'backend returned a malformed row set')
  }
  if (data.length === 0) return null
  const candidates = data.map(value => {
    const row = object(value, operation)
    if (row.banner_class !== 'standard' || row.roll_type !== 'standard_roll') {
      throw new PullRpcError(operation, 'backend returned a non-ticket standard banner')
    }
    return {
      bannerVersionId: pattern(row.id, BANNER_VERSION_ID, operation, 'id'),
      bannerId: pattern(row.banner_id, BANNER_ID, operation, 'banner_id'),
      bannerVersion: integer(row.banner_version, operation, 'banner_version', 1),
      bannerFamilyId: pattern(
        row.banner_family_id,
        BANNER_ID,
        operation,
        'banner_family_id',
      ),
      bannerClass: 'standard' as const,
      rollType: 'standard_roll' as const,
    }
  })
  const families = new Set(candidates.map(candidate => candidate.bannerFamilyId))
  if (families.size !== 1) {
    throw new PullRpcError(
      operation,
      'multiple ticket-bound standard banner families are ambiguous',
      '22023',
    )
  }
  return candidates.sort((a, b) => (
    b.bannerVersion - a.bannerVersion ||
    a.bannerVersionId.localeCompare(b.bannerVersionId)
  ))[0]
}

export async function preparePull(
  client: SupabaseClient,
  request: PreparePullRequest,
): Promise<PullPrepareReceipt> {
  if (
    !BANNER_VERSION_ID.test(request.bannerVersionId) ||
    (request.pullCount !== 1 && request.pullCount !== 10) ||
    !IDEMPOTENCY_KEY.test(request.idempotencyKey)
  ) {
    throw new PullRpcError('prepare_pull', 'invalid pull request', '22023')
  }
  const receipt = parsePrepareReceipt(await rpc(client, 'prepare_pull', {
    p_banner_version_id: request.bannerVersionId,
    p_pull_count: request.pullCount,
    p_idempotency_key: request.idempotencyKey,
  }, true))
  if (
    receipt.bannerVersionId !== request.bannerVersionId ||
    receipt.pullCount !== request.pullCount
  ) {
    throw new PullRpcError('prepare_pull', 'backend returned a receipt for another intent')
  }
  return receipt
}

export async function commitPullSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<PullRevealReceipt> {
  if (!UUID.test(sessionId)) {
    throw new PullRpcError('commit_pull_session', 'invalid session id', '22023')
  }
  const receipt = parseRevealReceipt(
    await rpc(client, 'commit_pull_session', { p_session_id: sessionId }, true),
    'commit_pull_session',
  )
  if (receipt.sessionId !== sessionId) {
    throw new PullRpcError('commit_pull_session', 'backend returned another session')
  }
  return receipt
}

export async function getCommittedPullReveal(
  client: SupabaseClient,
  sessionId: string,
): Promise<PullRevealReceipt> {
  if (!UUID.test(sessionId)) {
    throw new PullRpcError('get_committed_pull_reveal', 'invalid session id', '22023')
  }
  const receipt = parseRevealReceipt(
    await rpc(client, 'get_committed_pull_reveal', { p_session_id: sessionId }, false),
    'get_committed_pull_reveal',
  )
  if (receipt.sessionId !== sessionId) {
    throw new PullRpcError('get_committed_pull_reveal', 'backend returned another session')
  }
  return receipt
}

export async function cancelPullSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<PullCancelReceipt> {
  const operation = 'cancel_pull_session'
  if (!UUID.test(sessionId)) {
    throw new PullRpcError(operation, 'invalid session id', '22023')
  }
  const row = object(
    singleton(
      await rpc(client, operation, { p_session_id: sessionId }, true),
      operation,
    ),
    operation,
  )
  const returnedSessionId = pattern(row.session_id, UUID, operation, 'session_id')
  if (returnedSessionId !== sessionId || row.kind !== 'cancelled') {
    throw new PullRpcError(operation, 'backend returned an incoherent cancellation')
  }
  return {
    sessionId,
    kind: 'cancelled',
    cancelledAt: row.created_at === undefined
      ? null
      : timestamp(row.created_at, operation, 'created_at'),
  }
}
