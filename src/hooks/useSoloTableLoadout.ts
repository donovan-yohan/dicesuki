import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useInventoryStore } from '../store/useInventoryStore'
import { SOLO_WORKER_SERVER_URL, useMultiplayerStore } from '../store/useMultiplayerStore'
import { getInventoryHydration, subscribeInventoryHydration } from '../lib/dataSync'
import { encodeSoloTable, readSoloTable, resolveSoloTableDie, type SoloTableDie } from '../lib/soloTableLoadout'
import type { DiceShape } from '../lib/geometries'

// A scope change may render before SoloRoom's reconnect effect. Never adopt its old worker.
const socketScopes = new WeakMap<object, string>()

export function currentSoloTableScope(): string | null {
  const auth = useAuthStore.getState()
  if (auth.status === 'loading') return null
  if (auth.status === 'guest') return 'dicesuki-solo-table:v1:guest'
  return auth.user?.id ? `dicesuki-solo-table:v1:user:${auth.user.id}` : null
}

/** Solo route lifetime owns hydration. Room maps and physics never hydrate from storage. */
export function useSoloTableLoadout(addStandardDie: (shape: DiceShape) => string | null) {
  const scope = useAuthStore(currentSoloTableScope)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!scope) return
    let active = true
    let socket: ReturnType<typeof useMultiplayerStore.getState>['socket'] = null
    let player: string | null = null
    let sending = false
    let refused = false
    let waiting: string[] | null = null
    let baseline: string | null = null
    let lastRaw: string | null = null
    let fresh = false
    let bootstrapGeneration: number | null = null
    let deferredSocket: object | null = null
    const unresolvedOwned = new Map<string, SoloTableDie>()
    let bootstrapError: ReturnType<typeof useMultiplayerStore.getState>['roomActionError'] = null
    const belongs = () => active && currentSoloTableScope() === scope
    const observe = () => {
      if (!belongs()) return
      const state = useMultiplayerStore.getState()
      if (state.serverUrl !== SOLO_WORKER_SERVER_URL || state.roomId !== 'solo'
        || state.connectionStatus !== 'connected' || !state.localPlayerId || !state.engineConfig || !state.socket) {
        socket = null
        waiting = null
        baseline = null
        return
      }
      const claimedScope = socketScopes.get(state.socket)
      if (claimedScope && claimedScope !== scope) return
      socketScopes.set(state.socket, scope)
      if (sending) return
      if (state.socket !== socket || player !== state.localPlayerId) {
        const saved = readSoloTable(scope)
        const auth = useAuthStore.getState()
        const hydration = getInventoryHydration()
        const needsOwned = auth.status !== 'guest' && saved.dice?.some(die => die.presentation.inventoryDieId)
        // Only owned restores wait; fresh, explicit-empty and theme-only tables
        // remain instant/offline. Pending is not evidence that a copy is missing.
        if (needsOwned && hydration.userId === auth.user?.id && hydration.status === 'pending') {
          if (state.dice.size === 0 && state.pendingSpawnRollBarriers.size === 0) deferredSocket = state.socket
          return
        }
        const resumeDeferred = deferredSocket === state.socket
        deferredSocket = null
        socket = state.socket
        player = state.localPlayerId
        bootstrapGeneration = needsOwned ? hydration.generation : null
        unresolvedOwned.clear()
        waiting = []
        baseline = null
        refused = false
        bootstrapError = state.roomActionError
        setError(null)
        lastRaw = saved.raw
        fresh = saved.dice === null && !saved.rejected
        const localDice = [...state.dice.values()].filter(die => die.ownerId === player)
        waiting = [...state.pendingSpawnRollBarriers.keys()]
        // Never replay into a pre-existing room. If THIS empty worker was held
        // for inventory, keep edits accepted during that wait and append restore.
        if (resumeDeferred || (localDice.length === 0 && state.pendingSpawnRollBarriers.size === 0)) {
          if (resumeDeferred && (localDice.length > 0 || waiting.length > 0)) fresh = true
          sending = true
          try {
            if (saved.dice === null) {
              const id = addStandardDie('d20')
              if (id) waiting.push(id)
              else refused = true
            } else {
              const inventoryState = useInventoryStore.getState()
              const ownershipResolved = auth.status === 'guest'
                || (hydration.userId === auth.user?.id && hydration.status === 'ready')
              const inventory = auth.status === 'guest'
                ? (inventoryState.serverCopiesActive ? inventoryState.localDice : inventoryState.dice)
                : ownershipResolved ? inventoryState.dice.filter(die => die.serverCopyMetadata) : []
              const unavailable = new Set([
                ...state.pendingInventoryDieIds,
                ...localDice.flatMap(die => die.presentation?.inventoryDieId ? [die.presentation.inventoryDieId] : []),
              ])
              for (const die of saved.dice) {
                if (!belongs() || useMultiplayerStore.getState().socket !== socket
                  || getInventoryHydration().generation !== hydration.generation) return
                const id = state.spawnDice(die.shape, resolveSoloTableDie(die, inventory, unavailable))
                if (id) {
                  waiting.push(id)
                  // An offline/basic stand-in is playable, not permission to
                  // erase the requested copy on a later unrelated table edit.
                  if (!ownershipResolved && die.presentation.inventoryDieId) unresolvedOwned.set(id, die)
                }
                else { refused = true; break }
              }
            }
          } catch {
            refused = true
          } finally {
            sending = false
          }
          if (refused) setError('Could not restore every die. Try again to reload your saved table.')
        }
      }
      if (refused || !waiting || !belongs()) return
      // A replacement sync incarnation cannot inherit this worker's ownership
      // receipt or arm a queued old bootstrap ACK. Reconnect owns restoration.
      if (bootstrapGeneration !== null && getInventoryHydration().generation !== bootstrapGeneration) return
      const live = useMultiplayerStore.getState()
      if (baseline === null && waiting.length > 0 && live.roomActionError && live.roomActionError !== bootstrapError) {
        refused = true
        setError('Could not restore every die. Try again to reload your saved table.')
        return
      }
      if (live.socket !== socket || waiting.some(id => live.dice.get(id)?.ownerId !== player)) return
      const dice: SoloTableDie[] = [...live.dice.values()]
        .filter(die => die.ownerId === player)
        .map(die => unresolvedOwned.get(die.id) ?? { shape: die.diceType, presentation: die.presentation ?? {} })
      let encoded: string
      try { encoded = encodeSoloTable(dice) } catch { return }
      if (baseline === null) {
        baseline = encoded
        waiting = []
        // Passive fallback/restoration must never replace corrupt or lossy saved bytes.
        if (!fresh) return
      } else if (encoded === baseline) return
      baseline = encoded
      try {
        // Do not overwrite a newer/rejected external edit from a stale tab.
        if (localStorage.getItem(scope) !== lastRaw) return
        localStorage.setItem(scope, encoded)
        lastRaw = encoded
      } catch {
        // Blocked/quota storage must not prevent ordinary local play.
      }
    }
    const unsubscribe = useMultiplayerStore.subscribe(observe)
    const unsubscribeHydration = subscribeInventoryHydration(observe)
    observe()
    return () => { active = false; unsubscribe(); unsubscribeHydration() }
  }, [scope, addStandardDie])
  return { scope, error }
}
