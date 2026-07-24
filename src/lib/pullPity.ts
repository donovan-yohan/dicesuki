import type { SupabaseClient } from '@supabase/supabase-js'

const OPERATION = 'get_my_pull_pity'
const BANNER_FAMILY_ID = /^[a-z0-9][a-z0-9-]{2,79}$/
const BANNER_VERSION_ID = /^[a-z0-9][a-z0-9-]{2,79}@[1-9]\d*$/

export type SoftPityModel = 'linear-rate-ramp'

export interface PullPitySnapshot {
  bannerFamilyId: string
  bannerVersionId: string
  bannerVersion: number
  totalPulls: number
  rareMisses: number
  epicMisses: number
  selectedMisses: number
  rareHardGuaranteePull: number
  epicHardGuaranteePull: number
  selectedHardGuaranteePull: number
  softPityModel: SoftPityModel | null
  softPityStartPull: number | null
  softPityPerPullIncrement: number | null
}

export class PullPityReadError extends Error {
  readonly operation = OPERATION
  readonly code?: string

  constructor(message: string, code?: string) {
    super(`${OPERATION} failed: ${message}`)
    this.name = 'PullPityReadError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>

function object(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PullPityReadError('backend returned a malformed object')
  }
  return value as UnknownRecord
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PullPityReadError('backend returned a malformed string')
  }
  return value
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PullPityReadError('backend returned a malformed integer')
  }
  return value
}

function positiveInteger(value: unknown): number {
  const result = nonNegativeInteger(value)
  if (result === 0) {
    throw new PullPityReadError('backend returned a malformed positive integer')
  }
  return result
}

function positiveNumber(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  ) {
    throw new PullPityReadError('backend returned a malformed numeric value')
  }
  return value
}

function singleton(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new PullPityReadError('backend returned an unexpected row count')
  }
  return value[0]
}

function parseSnapshot(value: unknown, requestedBannerFamilyId: string): PullPitySnapshot {
  const row = object(singleton(value))
  const bannerFamilyId = string(row.banner_family_id)
  if (bannerFamilyId !== requestedBannerFamilyId) {
    throw new PullPityReadError('backend returned pity for the wrong banner family')
  }

  const bannerVersionId = string(row.banner_version_id)
  const bannerVersion = positiveInteger(row.banner_version)
  if (
    !BANNER_VERSION_ID.test(bannerVersionId) ||
    !bannerVersionId.endsWith(`@${bannerVersion}`)
  ) {
    throw new PullPityReadError('backend returned an incoherent banner version')
  }
  const selectedHardGuaranteePull = positiveInteger(row.selected_hard_guarantee_pull)
  const softPityModel = row.soft_pity_model
  const softPityStartPull = row.soft_pity_start_pull
  const softPityPerPullIncrement = row.soft_pity_per_pull_increment
  const softPityDisabled =
    softPityModel === null &&
    softPityStartPull === null &&
    softPityPerPullIncrement === null
  const softPityEnabled =
    softPityModel === 'linear-rate-ramp' &&
    softPityStartPull !== null &&
    softPityPerPullIncrement !== null

  if (!softPityDisabled && !softPityEnabled) {
    throw new PullPityReadError('backend returned an incoherent soft-pity configuration')
  }

  let parsedSoftPityStartPull: number | null = null
  let parsedSoftPityPerPullIncrement: number | null = null
  if (softPityEnabled) {
    parsedSoftPityStartPull = positiveInteger(softPityStartPull)
    parsedSoftPityPerPullIncrement = positiveNumber(softPityPerPullIncrement)
    if (
      parsedSoftPityStartPull <= 1 ||
      parsedSoftPityStartPull >= selectedHardGuaranteePull
    ) {
      throw new PullPityReadError('backend returned an incoherent soft-pity configuration')
    }
  }

  return {
    bannerFamilyId,
    bannerVersionId,
    bannerVersion,
    totalPulls: nonNegativeInteger(row.total_pulls),
    rareMisses: nonNegativeInteger(row.rare_misses),
    epicMisses: nonNegativeInteger(row.epic_misses),
    selectedMisses: nonNegativeInteger(row.selected_misses),
    rareHardGuaranteePull: positiveInteger(row.rare_hard_guarantee_pull),
    epicHardGuaranteePull: positiveInteger(row.epic_hard_guarantee_pull),
    selectedHardGuaranteePull,
    softPityModel: softPityEnabled ? 'linear-rate-ramp' : null,
    softPityStartPull: parsedSoftPityStartPull,
    softPityPerPullIncrement: parsedSoftPityPerPullIncrement,
  }
}

function assertBannerFamilyId(bannerFamilyId: string): void {
  if (typeof bannerFamilyId !== 'string' || !BANNER_FAMILY_ID.test(bannerFamilyId)) {
    throw new PullPityReadError(
      'banner family id must contain 3 to 80 lowercase letters, digits, or hyphens',
      '22023',
    )
  }
}

export async function fetchMyPullPity(
  client: SupabaseClient,
  bannerFamilyId: string,
): Promise<PullPitySnapshot> {
  assertBannerFamilyId(bannerFamilyId)

  let data: unknown
  try {
    const result = await client.rpc(OPERATION, {
      p_banner_family_id: bannerFamilyId,
    })
    if (result.error) {
      throw new PullPityReadError(result.error.message, result.error.code)
    }
    data = result.data
  } catch (error) {
    if (error instanceof PullPityReadError) throw error
    throw new PullPityReadError(
      error instanceof Error ? error.message : 'unknown client failure',
    )
  }

  return parseSnapshot(data, bannerFamilyId)
}
