import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import type { DiceShape } from '../lib/geometries'
import { createDicePresentationMetadata } from '../lib/dicePresentation'
import { createBasicDicePresentation } from '../lib/basicDice'
import type { DicePresentationMetadata } from '../lib/multiplayerMessages'
import type { PercentilePresentationFields } from '../lib/percentileRolls'
import { selectRandomAvailableDie } from '../lib/diceSelection'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'
import { useInventoryStore } from '../store/useInventoryStore'

/**
 * Merge caller-supplied presentation fields over a base block.
 *
 * `extras` is narrowed to {@link PercentilePresentationFields} on purpose: the
 * only fields a spawn caller may add are the percentile pairing ones. A wider
 * `Partial<DicePresentationMetadata>` would let a caller structurally overwrite
 * `displayName`, `baseColor`, `inventoryDieId` and friends — silently
 * misrepresenting which owned die is on the table. Widen this only with a reason.
 */
function mergePresentation(
  base: DicePresentationMetadata,
  extras: PercentilePresentationFields | undefined,
): DicePresentationMetadata {
  if (!extras || Object.keys(extras).length === 0) return base
  return { ...base, ...extras }
}

/**
 * Multiplayer implementation of the dice backend.
 * Actions send WebSocket messages; state comes from server via useMultiplayerStore.
 */
export function useMultiplayerDiceBackend(): DiceBackendState {
  const spawnDice = useMultiplayerStore((s) => s.spawnDice)
  const mpRemoveDice = useMultiplayerStore((s) => s.removeDice)
  const roll = useMultiplayerStore((s) => s.roll)
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const roomId = useMultiplayerStore((s) => s.roomId)
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)

  const rollHistory = useDiceStore((s) => s.rollHistory)

  /**
   * Spawn ONE die of `type`, preferring an owned one.
   *
   * Owned dice are finite; basic dice are not. A request that cannot be met from
   * the inventory — the die id is unknown, that die is already on the table, or
   * every owned die of the type is in play — falls through to a basic die rather
   * than refusing. That is the whole point of basics: the toolbar never disables
   * a type and a roll for 6d4 always puts six d4s on the table, however many the
   * player happens to own.
   *
   * Returns the client request id, or `null` only when the ROOM rejects the
   * spawn (disconnected, at capacity) — never because of inventory scarcity.
   */
  const addDie = useCallback((
    type: DiceShape,
    inventoryDieId?: string,
    presentationExtras?: PercentilePresentationFields,
  ) => {
    useDiceStore.getState().clearActiveSavedRoll()

    const inventoryStore = useInventoryStore.getState()
    const multiplayerState = useMultiplayerStore.getState()
    const inUseInventoryIds = new Set([
      ...Array.from(multiplayerState.dice.values())
        .filter((die) => !multiplayerState.localPlayerId || die.ownerId === multiplayerState.localPlayerId)
        .map((die) => die.presentation?.inventoryDieId)
        .filter((id): id is string => Boolean(id)),
      ...multiplayerState.pendingInventoryDieIds,
    ])

    const inventoryCandidates = inventoryStore.getDiceByType(type)
    const requestedDie = inventoryDieId
      ? inventoryStore.dice.find((die) => die.id === inventoryDieId)
      : selectRandomAvailableDie(inventoryCandidates, inUseInventoryIds)

    // A saved roll can outlive the die it names (sold, revoked with a server
    // copy, or dropped by the starter-inventory cleanup). Substituting a basic
    // keeps the rest of the roll intact; `savedRollExecution` reports the swap.
    if (inventoryDieId && !requestedDie) {
      console.warn(`[useMultiplayerDiceBackend] Inventory die ${inventoryDieId} not found; spawning a basic ${type.toUpperCase()}`)
    } else if (requestedDie && inUseInventoryIds.has(requestedDie.id)) {
      console.warn(`[useMultiplayerDiceBackend] Die "${requestedDie.name}" is already on the table; spawning a basic ${type.toUpperCase()}`)
    }

    const inventoryDie = requestedDie && !inUseInventoryIds.has(requestedDie.id)
      ? requestedDie
      : undefined

    return spawnDice(
      inventoryDie?.type ?? type,
      mergePresentation(
        inventoryDie
          ? createDicePresentationMetadata(inventoryDie)
          : createBasicDicePresentation(type),
        presentationExtras,
      ),
    )
  }, [spawnDice])

  /**
   * Spawn a die that is deliberately not an owned one — the percentile tens
   * half, an exploding die's offspring, a plain entry in a saved roll.
   *
   * These are basic dice. Spawning them with NO presentation at all would render
   * them in the owner's player colour, which reads as "a die of yours" for
   * something the player never owned.
   */
  const addGenericDie = useCallback((
    type: DiceShape,
    presentationExtras?: PercentilePresentationFields,
  ) => {
    useDiceStore.getState().clearActiveSavedRoll()
    return spawnDice(type, mergePresentation(createBasicDicePresentation(type), presentationExtras))
  }, [spawnDice])

  const removeDie = useCallback((id: string) => {
    mpRemoveDice([id])
  }, [mpRemoveDice])

  const clearAll = useCallback(() => {
    // Read the live store, not the hook-closure snapshot: callers (saved-roll
    // execution) capture their wait-predicates from getState(), and a die
    // spawned between render commit and this call would otherwise diverge the
    // remove set from the awaited clear condition.
    const { dice: liveDice, localPlayerId: livePlayerId } =
      useMultiplayerStore.getState()
    const myDiceIds = Array.from(liveDice.values())
      .filter((d) => d.ownerId === livePlayerId)
      .map((d) => d.id)
    if (myDiceIds.length > 0) {
      mpRemoveDice(myDiceIds)
    }
  }, [mpRemoveDice])

  const clearHistory = useCallback(() => {
    useDiceStore.getState().clearHistory()
  }, [])

  return {
    mode: 'multiplayer',
    roll,
    addDie,
    addGenericDie,
    removeDie,
    clearAll,
    rollHistory,
    clearHistory,
    multiplayer: localPlayerId && roomId ? {
      players,
      localPlayerId,
      roomId,
      connectionStatus,
    } : null,
  }
}
