import type { Creature, Intent } from './types'
import type { SavedRoll } from '../../types/savedRolls'
import type { SavedRollBackend } from '../savedRollExecution'
import { executePhysicalSavedRoll } from '../savedRollExecution'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useDiceStore } from '../../store/useDiceStore'
import { compileIntent } from './rollIntent'

// Session admission survives panel close/reopen and pre-render double activation.
let starting = false
export function quickActionState(): 'ready' | 'rolling' | 'disconnected' {
  const room = useMultiplayerStore.getState()
  if (!room.localPlayerId || room.connectionStatus !== 'connected') return 'disconnected'
  const dice = useDiceStore.getState()
  if (starting || dice.savedRollWavesPending || (dice.savedRollExecution && !dice.savedRollExecution.signal.aborted)
    || room.pendingLocalRolls.length || room.pendingInventoryDieIds.size || room.pendingSpawnRollBarriers.size
    || Array.from(room.dice.values()).some(d => d.ownerId === room.localPlayerId && d.isRolling)) return 'rolling'
  return 'ready'
}
export async function executeMonsterIntent(c: Creature, intent: Intent, backend: SavedRollBackend, onBase: () => void): Promise<void> {
  return executeAdmittedRoll(compileIntent(c, intent), backend, onBase)
}
export async function executeAdmittedRoll(roll: SavedRoll, backend: SavedRollBackend, onBase: () => void): Promise<void> {
  const state = quickActionState()
  if (state !== 'ready') throw new Error(state === 'disconnected' ? 'Room not connected. Reconnect to roll.' : 'Your dice are still rolling.')
  starting = true
  let tableReplacementStarted = false
  const admittedBackend: SavedRollBackend = {
    ...backend,
    clearAll: () => {
      // Native capacity validation precedes this boundary. From here its old
      // settled state has been cleared; never restore a stale previous plan.
      tableReplacementStarted = true
      backend.clearAll()
    },
  }
  try {
    await executePhysicalSavedRoll(roll, { backend: admittedBackend, ownerId: useMultiplayerStore.getState().localPlayerId!, onBaseWaveStarted: onBase })
  } catch (error) {
    if (tableReplacementStarted) useDiceStore.getState().clearActiveSavedRoll()
    throw error
  } finally { starting = false }
}
