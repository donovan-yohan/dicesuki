import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import type { DiceShape } from '../lib/geometries'
import { createDicePresentationMetadata } from '../lib/dicePresentation'
import type { DicePresentationMetadata } from '../lib/multiplayerMessages'
import { selectRandomAvailableDie } from '../lib/diceSelection'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'
import { useInventoryStore } from '../store/useInventoryStore'

/**
 * Merge caller-supplied presentation fields over an inventory-derived block.
 *
 * Returns `undefined` when neither side has anything to say, so a generic
 * anonymous die still spawns with NO presentation block at all (Shared-ADR-005).
 */
function mergePresentation(
  base: DicePresentationMetadata | undefined,
  extras: Partial<DicePresentationMetadata> | undefined,
): DicePresentationMetadata | undefined {
  if (!extras || Object.keys(extras).length === 0) return base
  return { ...(base ?? {}), ...extras }
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

  const addDie = useCallback((
    type: DiceShape,
    inventoryDieId?: string,
    presentationExtras?: Partial<DicePresentationMetadata>,
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
    const inventoryDie = inventoryDieId
      ? inventoryStore.dice.find((die) => die.id === inventoryDieId)
      : selectRandomAvailableDie(inventoryCandidates, inUseInventoryIds)

    if (inventoryDieId && !inventoryDie) {
      console.warn(`[useMultiplayerDiceBackend] Inventory die ${inventoryDieId} not found; not spawning`)
      return null
    }

    if (inventoryDie && inUseInventoryIds.has(inventoryDie.id)) {
      console.warn(`[useMultiplayerDiceBackend] Die "${inventoryDie.name}" is already on the table`)
      return null
    }

    if (!inventoryDieId && inventoryCandidates.length > 0 && !inventoryDie) {
      console.warn(`[useMultiplayerDiceBackend] All ${type.toUpperCase()} dice are already on the table`)
      return null
    }

    return spawnDice(
      inventoryDie?.type ?? type,
      mergePresentation(
        inventoryDie ? createDicePresentationMetadata(inventoryDie) : undefined,
        presentationExtras,
      ),
    )
  }, [spawnDice])

  const addGenericDie = useCallback((
    type: DiceShape,
    presentationExtras?: Partial<DicePresentationMetadata>,
  ) => {
    useDiceStore.getState().clearActiveSavedRoll()
    return spawnDice(type, mergePresentation(undefined, presentationExtras))
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
