import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import type { DiceShape } from '../lib/geometries'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'

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

  // inventoryDieId is local-only; multiplayer spawns are server-authoritative
  const addDie = useCallback((type: DiceShape, _inventoryDieId?: string) => {
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
