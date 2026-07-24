import { mapServerCopiesToInventoryDice } from '../store/useInventoryStore'
import type { CollectibleCatalog } from '../types/catalog'
import type { InventoryDie } from '../types/inventory'
import type {
  PersistedPullSession,
  PullCount,
  PullCtaState,
  PullIntent,
  PullPrepareReceipt,
  PullRevealAssembly,
  PullRevealReceipt,
  PullRevealSummary,
  PullVerificationDisclosure,
} from '../types/pull'
import type { DiceCopiesByCatalogItem } from './diceCopies'

export const PULL_SESSION_STORAGE_KEY = 'dicesuki-active-pull-session-v1'
export const STARS_PER_STANDARD_ROLL = 160
export const MIN_SEALING_MS = 800
export const HOLD_ESCALATION_MS = 2000

export interface PullInventorySnapshot {
  catalog: CollectibleCatalog
  copies: DiceCopiesByCatalogItem
  dice: InventoryDie[]
}

export type PullFlowState =
  | { status: 'idle' }
  | { status: 'preparing'; intent: PullIntent }
  | {
      status: 'sealing'
      intent: PullIntent
      preparation: PullPrepareReceipt
      sealingStartedAt: number
    }
  | {
      status: 'hold'
      intent: PullIntent
      preparation: PullPrepareReceipt
      reason: 'slow' | 'commit-error' | 'restored'
      error: string | null
    }
  | {
      status: 'restoring'
      persisted: PersistedPullSession
    }
  | {
      status: 'expiring'
      intent: PullIntent
      preparation: PullPrepareReceipt
    }
  | {
      status: 'auth-required'
      persisted: PersistedPullSession
      message: 'Sign in to restore your pull.'
    }
  | {
      status: 'cancelling'
      intent: PullIntent
      preparation: PullPrepareReceipt
    }
  | {
      status: 'revealed'
      intent: PullIntent
      preparation: PullPrepareReceipt
      reveal: PullRevealReceipt
    }
  | {
      status: 'error'
      intent: PullIntent
      stage: 'prepare' | 'restore'
      error: string
    }
  | { status: 'cancelled'; message: 'No rolls spent.' }
  | { status: 'expired'; message: 'Hold expired — no rolls spent.' }

export type PullFlowEvent =
  | { type: 'START'; intent: PullIntent }
  | {
      type: 'PREPARED'
      receipt: PullPrepareReceipt
      sealingStartedAt: number
    }
  | { type: 'PREPARE_FAILED'; error: string }
  | { type: 'HOLD_SLOW' }
  | { type: 'COMMIT_FAILED'; error: string }
  | { type: 'RESTORE_STARTED'; persisted: PersistedPullSession }
  | {
      type: 'RESTORE_HOLD'
      intent: PullIntent
      preparation: PullPrepareReceipt
    }
  | { type: 'RESTORE_FAILED'; intent: PullIntent; error: string }
  | { type: 'AUTH_REQUIRED'; persisted: PersistedPullSession }
  | {
      type: 'EXPIRE_STARTED'
      intent: PullIntent
      preparation: PullPrepareReceipt
    }
  | { type: 'EXPIRE_FAILED'; error: string }
  | { type: 'EXPIRED_CONFIRMED' }
  | { type: 'REVEALED'; reveal: PullRevealReceipt }
  | { type: 'CANCEL_STARTED' }
  | { type: 'CANCEL_FAILED'; error: string }
  | { type: 'CANCELLED' }
  | { type: 'CLEAR' }

export const INITIAL_PULL_FLOW_STATE: PullFlowState = { status: 'idle' }

/** Pure lifecycle reducer. Unhandled async events leave the current state stable. */
export function reducePullFlow(
  state: PullFlowState,
  event: PullFlowEvent,
): PullFlowState {
  switch (event.type) {
    case 'START':
      if (
        state.status !== 'idle' &&
        state.status !== 'error' &&
        state.status !== 'cancelled' &&
        state.status !== 'expired' &&
        state.status !== 'auth-required'
      ) return state
      return { status: 'preparing', intent: event.intent }
    case 'PREPARED':
      if (state.status !== 'preparing') return state
      return {
        status: 'sealing',
        intent: state.intent,
        preparation: event.receipt,
        sealingStartedAt: event.sealingStartedAt,
      }
    case 'PREPARE_FAILED':
      if (state.status !== 'preparing') return state
      return {
        status: 'error',
        intent: state.intent,
        stage: 'prepare',
        error: event.error,
      }
    case 'HOLD_SLOW':
      if (state.status !== 'sealing') return state
      return {
        status: 'hold',
        intent: state.intent,
        preparation: state.preparation,
        reason: 'slow',
        error: null,
      }
    case 'COMMIT_FAILED':
      if (state.status !== 'sealing' && state.status !== 'hold') return state
      return {
        status: 'hold',
        intent: state.intent,
        preparation: state.preparation,
        reason: 'commit-error',
        error: event.error,
      }
    case 'RESTORE_STARTED':
      if (
        state.status !== 'idle' &&
        state.status !== 'error' &&
        state.status !== 'auth-required'
      ) return state
      return { status: 'restoring', persisted: event.persisted }
    case 'RESTORE_HOLD':
      if (state.status !== 'restoring') return state
      return {
        status: 'hold',
        intent: event.intent,
        preparation: event.preparation,
        reason: 'restored',
        error: null,
      }
    case 'RESTORE_FAILED':
      if (state.status !== 'restoring') return state
      return {
        status: 'error',
        intent: event.intent,
        stage: 'restore',
        error: event.error,
      }
    case 'AUTH_REQUIRED':
      if (
        state.status !== 'preparing' &&
        state.status !== 'sealing' &&
        state.status !== 'hold' &&
        state.status !== 'restoring' &&
        state.status !== 'expiring' &&
        state.status !== 'cancelling' &&
        state.status !== 'revealed' &&
        state.status !== 'error'
      ) return state
      return {
        status: 'auth-required',
        persisted: event.persisted,
        message: 'Sign in to restore your pull.',
      }
    case 'EXPIRE_STARTED':
      if (
        state.status !== 'sealing' &&
        state.status !== 'hold' &&
        state.status !== 'restoring' &&
        state.status !== 'cancelling'
      ) return state
      return {
        status: 'expiring',
        intent: event.intent,
        preparation: event.preparation,
      }
    case 'EXPIRE_FAILED':
      if (state.status !== 'expiring') return state
      return {
        status: 'error',
        intent: state.intent,
        stage: 'restore',
        error: event.error,
      }
    case 'EXPIRED_CONFIRMED':
      if (state.status !== 'expiring') return state
      return { status: 'expired', message: 'Hold expired — no rolls spent.' }
    case 'REVEALED':
      if (
        state.status !== 'sealing' &&
        state.status !== 'hold' &&
        state.status !== 'restoring' &&
        state.status !== 'cancelling' &&
        state.status !== 'expiring'
      ) return state
      if (state.status === 'restoring') {
        const preparation = state.persisted.preparation
        if (!preparation) return state
        return {
          status: 'revealed',
          intent: state.persisted.intent,
          preparation,
          reveal: event.reveal,
        }
      }
      return {
        status: 'revealed',
        intent: state.intent,
        preparation: state.preparation,
        reveal: event.reveal,
      }
    case 'CANCEL_STARTED':
      if (state.status !== 'sealing' && state.status !== 'hold') return state
      return {
        status: 'cancelling',
        intent: state.intent,
        preparation: state.preparation,
      }
    case 'CANCEL_FAILED':
      if (state.status !== 'cancelling') return state
      return {
        status: 'hold',
        intent: state.intent,
        preparation: state.preparation,
        reason: 'commit-error',
        error: event.error,
      }
    case 'CANCELLED':
      if (state.status !== 'cancelling') return state
      return { status: 'cancelled', message: 'No rolls spent.' }
    case 'CLEAR':
      if (
        state.status === 'preparing' ||
        state.status === 'sealing' ||
        state.status === 'hold' ||
        state.status === 'restoring' ||
        state.status === 'expiring' ||
        state.status === 'auth-required' ||
        state.status === 'cancelling'
      ) return state
      return INITIAL_PULL_FLOW_STATE
  }
}

export function derivePullCtaState(input: {
  signedIn: boolean
  pullCount: PullCount
  availableTickets: number
  promotionalStars: number
}): PullCtaState {
  const { signedIn, pullCount } = input
  const availableTickets = Math.max(0, Math.floor(input.availableTickets))
  const promotionalStars = Math.max(0, Math.floor(input.promotionalStars))
  if (!signedIn) {
    return {
      kind: 'sign-in',
      pullCount,
      label: 'Sign in to pull',
      disabled: false,
      ticketDeficit: 0,
      starsRequired: 0,
    }
  }
  const ticketDeficit = Math.max(0, pullCount - availableTickets)
  if (ticketDeficit === 0) {
    return {
      kind: 'tickets',
      pullCount,
      label: `Pull ×${pullCount} · ${pullCount} roll${pullCount === 1 ? '' : 's'}`,
      disabled: false,
      ticketDeficit: 0,
      starsRequired: 0,
    }
  }
  const starsRequired = ticketDeficit * STARS_PER_STANDARD_ROLL
  if (promotionalStars >= starsRequired) {
    return {
      kind: 'convert',
      pullCount,
      label: `Pull ×${pullCount} · convert ${starsRequired} Stars`,
      disabled: false,
      ticketDeficit,
      starsRequired,
    }
  }
  return {
    kind: 'insufficient',
    pullCount,
    label: `Need ${ticketDeficit} more roll${ticketDeficit === 1 ? '' : 's'}`,
    disabled: true,
    ticketDeficit,
    starsRequired,
    largestAffordablePull: availableTickets >= 10
      ? 10
      : availableTickets >= 1
        ? 1
        : null,
  }
}

function isoNow(now: number): string {
  return new Date(now).toISOString()
}

export function createPullIntent(input: {
  ownerId: string
  bannerVersionId: string
  pullCount: PullCount
  now?: number
  randomUUID?: () => string
}): PullIntent {
  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID())
  return {
    ownerId: input.ownerId,
    bannerVersionId: input.bannerVersionId,
    pullCount: input.pullCount,
    idempotencyKey: `pull:${randomUUID()}`,
    createdAt: isoNow(input.now ?? Date.now()),
  }
}

export function toPersistedPullSession(
  intent: PullIntent,
  preparation: PullPrepareReceipt | null,
  status: PersistedPullSession['status'],
): PersistedPullSession {
  return { version: 1, ownerId: intent.ownerId, intent, preparation, status }
}

interface PullStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): PullStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function persistPullSession(
  record: PersistedPullSession,
  storage: PullStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PULL_SESSION_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Persistence is best-effort; server idempotency still protects retries.
  }
}

export function clearPersistedPullSession(
  ownerId: string,
  storage: PullStorage | null = defaultStorage(),
): void {
  try {
    const existing = readPersistedPullSession(ownerId, storage)
    if (existing) storage?.removeItem(PULL_SESSION_STORAGE_KEY)
  } catch {
    // A blocked storage surface must not make acknowledgement fail.
  }
}

function validIntent(value: unknown, ownerId: string): value is PullIntent {
  if (!value || typeof value !== 'object') return false
  const intent = value as Partial<PullIntent>
  return intent.ownerId === ownerId &&
    typeof intent.bannerVersionId === 'string' &&
    (intent.pullCount === 1 || intent.pullCount === 10) &&
    typeof intent.idempotencyKey === 'string' &&
    intent.idempotencyKey.startsWith('pull:') &&
    typeof intent.createdAt === 'string' &&
    !Number.isNaN(Date.parse(intent.createdAt))
}

function validPreparation(
  value: unknown,
  intent: PullIntent,
): value is PullPrepareReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Partial<PullPrepareReceipt>
  return typeof receipt.sessionId === 'string' &&
    receipt.bannerVersionId === intent.bannerVersionId &&
    receipt.pullCount === intent.pullCount &&
    typeof receipt.heldAmount === 'number' &&
    Number.isSafeInteger(receipt.heldAmount) &&
    receipt.heldAmount > 0 &&
    typeof receipt.preparedAt === 'string' &&
    !Number.isNaN(Date.parse(receipt.preparedAt)) &&
    typeof receipt.expiresAt === 'string' &&
    Date.parse(receipt.expiresAt) > Date.parse(receipt.preparedAt) &&
    typeof receipt.commitmentScheme === 'string' &&
    typeof receipt.commitmentRoot === 'string' &&
    typeof receipt.rngScheme === 'string'
}

export function readPersistedPullSession(
  ownerId: string,
  storage: PullStorage | null = defaultStorage(),
): PersistedPullSession | null {
  try {
    const raw = storage?.getItem(PULL_SESSION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PersistedPullSession>
    if (
      value.version !== 1 ||
      value.ownerId !== ownerId ||
      !validIntent(value.intent, ownerId) ||
      !['intent', 'prepared', 'committed'].includes(value.status ?? '')
    ) return null
    if (value.status === 'intent') {
      if (value.preparation !== null) return null
    } else if (!validPreparation(value.preparation, value.intent)) {
      return null
    }
    return value as PersistedPullSession
  } catch {
    return null
  }
}

export function makePullGrantIdempotencyKey(
  sessionId: string,
  position: number,
): string {
  return `pull-copy-grant:${sessionId}:result:${position}`
}

export function createPullInventorySnapshot(
  copies: DiceCopiesByCatalogItem,
  catalog: CollectibleCatalog,
): PullInventorySnapshot | null {
  const dice = mapServerCopiesToInventoryDice(copies, catalog)
  return dice ? { copies, catalog, dice } : null
}

function createCatalogRevealDie(
  receipt: PullRevealReceipt,
  position: number,
  catalogItemId: string,
  inventory: PullInventorySnapshot,
): InventoryDie | null {
  const item = inventory.catalog.items.find(candidate => candidate.id === catalogItemId)
  const asset = item
    ? inventory.catalog.assetVersions.find(candidate => (
      candidate.id === item.assetVersionId &&
      candidate.catalogItemId === item.id
    ))
    : null
  if (!item || !asset) {
    const fallback = inventory.dice.find(die => die.catalogRef?.itemId === catalogItemId)
    return fallback
      ? { ...fallback, id: `pull-reveal:${receipt.sessionId}:${position}:${catalogItemId}` }
      : null
  }

  const die: InventoryDie = {
    id: `pull-reveal:${receipt.sessionId}:${position}:${catalogItemId}`,
    type: item.diceType,
    setId: item.setId,
    rarity: item.rarity,
    appearance: asset.metadata.appearance,
    vfx: asset.metadata.vfx,
    name: asset.metadata.name,
    description: asset.metadata.description,
    isFavorite: false,
    isLocked: true,
    acquiredAt: Date.parse(receipt.committedAt),
    source: 'gacha_standard',
    catalogRef: {
      itemId: item.id,
      assetVersionId: asset.id,
    },
    stats: {
      timesRolled: 0,
      totalValue: 0,
      critsRolled: 0,
      failsRolled: 0,
    },
    assignedToRolls: [],
  }
  if (asset.assetKind === 'gltf') {
    die.customAsset = {
      modelUrl: asset.modelPath,
      thumbnailUrl: asset.metadata.delivery?.thumbnailPath,
      assetId: item.catalogKey,
      storage: 'bundled',
      metadata: asset.metadata.diceMetadata,
    }
  }
  return die
}

/**
 * Join each immutable receipt row to the exact 0021 copy grant, then to its
 * playable inventory die. A stale post-commit copy projection degrades only
 * that row to catalog metadata; ownership count and room-spawn identity are
 * omitted rather than inferred, so the committed reveal remains renderable.
 */
export function assemblePullReveal(
  receipt: PullRevealReceipt,
  inventory: PullInventorySnapshot,
): PullRevealAssembly {
  const dieById = new Map(inventory.dice.map(die => [die.id, die]))
  return {
    receipt,
    items: receipt.results.map(result => {
      const group = inventory.copies[result.catalogItemId]
      const grantKey = makePullGrantIdempotencyKey(receipt.sessionId, result.position)
      const copy = group?.copies.find(candidate => (
        candidate.grantIdempotencyKey === grantKey
      ))
      const inventoryDie = copy ? dieById.get(copy.id) : undefined
      const exactJoin = Boolean(
        group &&
        copy &&
        copy.isFirstCopy === result.isFirstCopy &&
        inventoryDie?.catalogRef?.itemId === result.catalogItemId,
      )

      if (!exactJoin || !group || !copy || !inventoryDie) {
        const reason = !group
          ? 'missing copy group'
          : !copy
            ? 'missing granted copy'
            : copy.isFirstCopy !== result.isFirstCopy
              ? 'first-copy latch disagreement'
              : 'missing playable copy identity'
        const catalogDie = createCatalogRevealDie(
          receipt,
          result.position,
          result.catalogItemId,
          inventory,
        )
        if (!catalogDie) {
          console.warn(
            `[pullFlow] Pull result ${result.position} copy join degraded: ${reason}; catalog metadata unavailable`,
          )
          return {
            result,
            rarity: null,
            inventoryDie: null,
            inventoryDieId: null,
            liveCopyCount: null,
            isNew: result.isFirstCopy,
            copyLine: null,
            dustLine: result.isDuplicate
              ? `+${result.duplicateDustAmount} Dust`
              : null,
          }
        }
        console.warn(
          `[pullFlow] Pull result ${result.position} copy join degraded: ${reason}`,
        )
        return {
          result,
          rarity: catalogDie.rarity,
          inventoryDie: catalogDie,
          inventoryDieId: null,
          liveCopyCount: null,
          isNew: result.isFirstCopy,
          copyLine: null,
          dustLine: result.isDuplicate
            ? `+${result.duplicateDustAmount} Dust`
            : null,
        }
      }
      return {
        result,
        rarity: inventoryDie.rarity,
        inventoryDie,
        inventoryDieId: inventoryDie.id,
        liveCopyCount: group.liveCount,
        isNew: result.isFirstCopy,
        copyLine: `+1 copy (owned ×${group.liveCount})`,
        dustLine: result.isDuplicate
          ? `+${result.duplicateDustAmount} Dust`
          : null,
      }
    }),
  }
}

export function summarizePullReveal(
  receipt: PullRevealReceipt,
): PullRevealSummary {
  const tiers = new Map<string, { tierId: string; count: number; bestRank: number }>()
  for (const result of receipt.results) {
    const current = tiers.get(result.tierId)
    if (current) {
      current.count += 1
      current.bestRank = Math.max(current.bestRank, result.tierRank)
    } else {
      tiers.set(result.tierId, {
        tierId: result.tierId,
        count: 1,
        bestRank: result.tierRank,
      })
    }
  }
  return {
    pullCount: receipt.pullCount,
    newCount: receipt.results.filter(result => result.isFirstCopy).length,
    duplicateCount: receipt.results.filter(result => result.isDuplicate).length,
    firstCopyCount: receipt.results.filter(result => result.isFirstCopy).length,
    duplicateDustTotal: receipt.results.reduce(
      (sum, result) => sum + (result.isDuplicate ? result.duplicateDustAmount : 0),
      0,
    ),
    highlights: [...tiers.values()].sort((a, b) => (
      b.bestRank - a.bestRank || a.tierId.localeCompare(b.tierId)
    )),
  }
}

export function derivePullVerification(
  receipt: PullRevealReceipt,
): PullVerificationDisclosure {
  return {
    commitmentRoot: receipt.commitmentRoot,
    rngSeed: receipt.rngSeed,
    rows: receipt.results.map(result => ({
      position: result.position,
      nonce: result.nonce,
      commitment: result.commitment,
    })),
  }
}

/**
 * Catalog rarity is authoritative. This fallback only supports pre-catalog
 * placeholders; signature occupies the established legendary visual band.
 */
export { pullTierFallbackRarity } from './rarityColor'
