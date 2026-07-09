import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import type { DiceShape } from '../lib/geometries'
import { createDicePresentationMetadata } from '../lib/dicePresentation'
import { selectRandomAvailableDie } from '../lib/diceSelection'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'
import { useInventoryStore } from '../store/useInventoryStore'

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
  const dice = useMultiplayerStore((s) => s.dice)

  const rollHistory = useDiceStore((s) => s.rollHistory)

  const addDie = useCallback((type: DiceShape, inventoryDieId?: string) => {
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
      return
    }

    if (inventoryDie && inUseInventoryIds.has(inventoryDie.id)) {
      console.warn(`[useMultiplayerDiceBackend] Die "${inventoryDie.name}" is already on the table`)
      return
    }

    if (!inventoryDieId && inventoryCandidates.length > 0 && !inventoryDie) {
      console.warn(`[useMultiplayerDiceBackend] All ${type.toUpperCase()} dice are already on the table`)
      return
    }

    spawnDice(inventoryDie?.type ?? type, inventoryDie ? createDicePresentationMetadata(inventoryDie) : undefined)
  }, [spawnDice])

  const addGenericDie = useCallback((type: DiceShape) => {
    useDiceStore.getState().clearActiveSavedRoll()
    spawnDice(type)
  }, [spawnDice])

  const removeDie = useCallback((id: string) => {
    mpRemoveDice([id])
  }, [mpRemoveDice])

  const clearAll = useCallback(() => {
    const myDiceIds = Array.from(dice.values())
      .filter((d) => d.ownerId === localPlayerId)
      .map((d) => d.id)
    if (myDiceIds.length > 0) {
      mpRemoveDice(myDiceIds)
    }
  }, [dice, localPlayerId, mpRemoveDice])

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
