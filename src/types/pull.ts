import type { DieRarity, InventoryDie } from './inventory'

export type PullCount = 1 | 10

export interface StandardPullBanner {
  bannerVersionId: string
  bannerId: string
  bannerVersion: number
  bannerFamilyId: string
  bannerClass: 'standard'
  rollType: 'standard_roll'
}

export interface PullIntent {
  ownerId: string
  bannerVersionId: string
  pullCount: PullCount
  idempotencyKey: string
  createdAt: string
}

export interface PullPrepareReceipt {
  sessionId: string
  bannerVersionId: string
  pullCount: PullCount
  heldAmount: number
  preparedAt: string
  expiresAt: string
  commitmentScheme: string
  commitmentRoot: string
  rngScheme: string
}

export type PullResolutionReason =
  | 'base'
  | 'rare-guarantee'
  | 'epic-guarantee'
  | 'selected-guarantee'
  | 'soft-pity'

/** Exact client projection of the committed reveal row produced by 0021. */
export interface PullRevealResult {
  position: number
  catalogItemId: string
  tierId: string
  tierRank: number
  selectedTargetCatalogItemId: string | null
  reason: PullResolutionReason
  rareBefore: number
  rareAfter: number
  epicBefore: number
  epicAfter: number
  selectedBefore: number
  selectedAfter: number
  isDuplicate: boolean
  /** Ever-owned latch from the immutable copy grant, not a duplicate proxy. */
  isFirstCopy: boolean
  duplicateDustAmount: number
  nonce: string
  commitment: string
}

export interface PullRevealReceipt {
  sessionId: string
  bannerVersionId: string
  pullCount: PullCount
  heldAmount: number
  committedAt: string
  commitmentScheme: string
  commitmentRoot: string
  rngScheme: string
  rngSeed: string
  results: PullRevealResult[]
}

export interface PullCancelReceipt {
  sessionId: string
  kind: 'cancelled'
  cancelledAt: string | null
}

export interface PullRevealItem {
  result: PullRevealResult
  /** Catalog rarity when presentation metadata resolved; never inferred from tier. */
  rarity: DieRarity | null
  /** Renderable catalog/copy projection, or null for a receipt-only placeholder. */
  inventoryDie: InventoryDie | null
  /** Exact live copy identity, or null when the post-commit copy join is stale. */
  inventoryDieId: string | null
  /** Authoritative live count, or null when the post-commit copy join is stale. */
  liveCopyCount: number | null
  isNew: boolean
  /** Omitted rather than guessed when the live copy count cannot be joined. */
  copyLine: string | null
  dustLine: string | null
}

export interface PullRevealAssembly {
  receipt: PullRevealReceipt
  items: PullRevealItem[]
}

export interface PullTierSummary {
  tierId: string
  count: number
  bestRank: number
}

export interface PullRevealSummary {
  pullCount: PullCount
  newCount: number
  duplicateCount: number
  firstCopyCount: number
  duplicateDustTotal: number
  highlights: PullTierSummary[]
}

export interface PullVerificationRow {
  position: number
  nonce: string
  commitment: string
}

export interface PullVerificationDisclosure {
  commitmentRoot: string
  rngSeed: string
  rows: PullVerificationRow[]
}

export type PullCtaState =
  | {
      kind: 'sign-in'
      pullCount: PullCount
      label: 'Sign in to pull'
      disabled: false
      ticketDeficit: number
      starsRequired: 0
    }
  | {
      kind: 'tickets'
      pullCount: PullCount
      label: string
      disabled: false
      ticketDeficit: 0
      starsRequired: 0
    }
  | {
      kind: 'convert'
      pullCount: PullCount
      label: string
      disabled: false
      ticketDeficit: number
      starsRequired: number
    }
  | {
      kind: 'insufficient'
      pullCount: PullCount
      label: string
      disabled: true
      ticketDeficit: number
      starsRequired: number
      largestAffordablePull: PullCount | null
    }

export interface PersistedPullSession {
  version: 1
  ownerId: string
  intent: PullIntent
  preparation: PullPrepareReceipt | null
  status: 'intent' | 'prepared' | 'committed'
}
