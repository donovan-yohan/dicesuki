import { useCallback } from 'react'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import { useTheme } from '../contexts/ThemeContext'
import type { DiceShape } from '../lib/geometries'
import { spawnDiceFromToolbar, spawnSpecificDie } from '../lib/diceSpawner'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useDiceStore } from '../store/useDiceStore'

/**
 * Local (single-player) implementation of the dice backend.
 *
 * The roll() action is a no-op here — Scene.tsx still handles
 * the actual physics impulse via diceRefs. This hook just provides
 * the unified interface for UI components.
 *
 * @param onRoll - callback that Scene.tsx provides to trigger physics roll
 */
export function useLocalDiceBackend(onRoll: () => void): DiceBackendState {
  const rollHistory = useDiceStore((s) => s.rollHistory)
  const { currentTheme } = useTheme()

  const addDie = useCallback((type: DiceShape, inventoryDieId?: string) => {
    useDiceStore.getState().clearActiveSavedRoll()

    const result = inventoryDieId
      ? spawnSpecificDie(inventoryDieId, type, currentTheme.id)
      : spawnDiceFromToolbar(type, currentTheme.id)

    if (!result.success) {
      console.warn(`[useLocalDiceBackend] Failed to spawn die: ${result.error}`)
    }
  }, [currentTheme.id])

  const removeDie = useCallback((id: string) => {
    const store = useDiceStore.getState()
    store.removeDieState(id)
    store.clearActiveSavedRoll()
    useDiceManagerStore.getState().removeDice(id)
  }, [])

  const clearAll = useCallback(() => {
    const store = useDiceStore.getState()
    store.clearAllDieStates()
    store.clearActiveSavedRoll()
    useDiceManagerStore.getState().removeAllDice()
  }, [])

  const clearHistory = useCallback(() => {
    useDiceStore.getState().clearHistory()
  }, [])

  return {
    mode: 'local',
    roll: onRoll,
    addDie,
    removeDie,
    clearAll,
    rollHistory,
    clearHistory,
    multiplayer: null,
  }
}
