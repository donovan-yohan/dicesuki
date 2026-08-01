/**
 * Saved Rolls Panel
 *
 * Main panel for managing saved/favorite dice rolls.
 * Shows list of saved rolls with search/filter and creation UI.
 */

import { useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { BottomSheet } from './BottomSheet'
import { SavedRollCard } from './saved-rolls/SavedRollCard'
import { RollBuilder } from './saved-rolls/RollBuilder'
import { useDiceBackend } from '../../contexts/DiceBackendContext'
import type { TableDieSummary } from '../../types/tableDice'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import { useDiceStore, ActiveSavedRoll } from '../../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../../store/useMultiplayerStore'
import { createClientId } from '../../lib/clientId'
import { expandDiceEntrySources, getRollDiceCount } from '../../lib/rollSources'
import { ROLL_DICE_CAPACITY_MESSAGE, ROOM_DICE_CAPACITY } from '../../config/roomCapacity'
import {
  isPercentileEntry,
  percentileOnesPresentation,
  percentileTensPresentation,
  PERCENTILE_TENS_SHAPE,
} from '../../lib/percentileRolls'
import { SavedRoll } from '../../types/savedRolls'

const ROOM_ACK_TIMEOUT_MS = 5_000

function sameIdSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((id) => actual.includes(id))
}

function waitForRoomState(
  description: string,
  predicate: (state: ReturnType<typeof useMultiplayerStore.getState>) => boolean,
  timeoutMs = ROOM_ACK_TIMEOUT_MS,
): Promise<void> {
  const evaluate = (state: ReturnType<typeof useMultiplayerStore.getState>) => {
    if (state.roomActionError) throw new Error(state.roomActionError.message)
    return predicate(state)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe()
      if (error) reject(error)
      else resolve()
    }
    const check = (state: ReturnType<typeof useMultiplayerStore.getState>) => {
      try {
        if (evaluate(state)) finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for the room to ${description}.`)),
      timeoutMs,
    )
    unsubscribe = useMultiplayerStore.subscribe(check)
    check(useMultiplayerStore.getState())
  })
}

function waitForSavedRollSpawns(
  requestedIds: string[],
  ownerId: string,
  timeoutMs = ROOM_ACK_TIMEOUT_MS,
): Promise<void> {
  return waitForRoomState('spawn every saved-roll die', (state) => requestedIds.every((id) => {
    const die = state.dice.get(id)
    return die !== undefined && die.ownerId === ownerId
  }), timeoutMs)
}

interface SavedRollsPanelProps {
  isOpen: boolean
  onClose: () => void
  tableDice?: TableDieSummary[]
}

export function SavedRollsPanel({ isOpen, onClose, tableDice = [] }: SavedRollsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'builder'>('list')
  const [editingRoll, setEditingRoll] = useState<SavedRoll | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  // Hard reentrancy latch: state updates commit asynchronously, so a rapid
  // pre-commit double-tap could re-enter before isExecuting renders true.
  const executingRef = useRef(false)
  const backend = useDiceBackend()

  const {
    savedRolls,
    addRoll,
    updateRoll,
    deleteRoll,
    toggleFavorite,
    markRollAsUsed,
    getAllTags,
    searchRolls,
    getRollsByTag,
  } = useSavedRollsStore()

  // Get filtered rolls
  const filteredRolls = (() => {
    if (searchQuery) {
      return searchRolls(searchQuery)
    }
    if (selectedTag) {
      return getRollsByTag(selectedTag)
    }
    return savedRolls
  })()

  // Separate favorites from others
  const favoriteRolls = filteredRolls.filter(r => r.isFavorite)
  const otherRolls = filteredRolls.filter(r => !r.isFavorite)

  const allTags = getAllTags()

  // Execute a saved roll
  async function handleRoll(roll: SavedRoll) {
    if (executingRef.current) return
    executingRef.current = true
    setExecutionError(null)
    setIsExecuting(true)

    const room = useMultiplayerStore.getState()
    const ownerId = backend.multiplayer?.localPlayerId ?? room.localPlayerId
    if (!ownerId || room.connectionStatus !== 'connected') {
      setExecutionError('The room is not connected. Reconnect and try again.')
      executingRef.current = false
      setIsExecuting(false)
      return
    }

    const existingOwnedIds = Array.from(room.dice.values())
      .filter((die: MultiplayerDie) => die.ownerId === ownerId)
      .map((die) => die.id)

    // Capacity guard. `clearAll` only removes our own dice, so other players'
    // dice keep occupying the room — budget against what will actually be free.
    // Fail here with readable copy rather than clearing the table and taking a
    // server-side DICE_LIMIT rejection mid-spawn.
    const foreignDiceCount = room.dice.size - existingOwnedIds.length
    const availableCapacity = Math.max(0, ROOM_DICE_CAPACITY - foreignDiceCount)
    const requestedDiceCount = getRollDiceCount(roll.dice)
    if (requestedDiceCount > availableCapacity) {
      setExecutionError(
        foreignDiceCount > 0
          ? `Only ${availableCapacity} of the room's ${ROOM_DICE_CAPACITY} dice are free — "${roll.name}" needs ${requestedDiceCount}.`
          : `${ROLL_DICE_CAPACITY_MESSAGE}. "${roll.name}" needs ${requestedDiceCount} — edit it to continue.`,
      )
      executingRef.current = false
      setIsExecuting(false)
      return
    }

    const requested: Array<{ id: string; bonus: number }> = []

    try {
      room.clearRoomActionError()
      useDiceStore.getState().clearAllDieStates()
      backend.clearAll()
      await waitForRoomState('clear the current table', (state) => (
        existingOwnedIds.every((id) => !state.dice.has(id))
      ))

      for (const entry of roll.dice) {
        const isPercentile = isPercentileEntry(entry)

        for (const source of expandDiceEntrySources(entry)) {
          // A percentile die is really a PAIR: one tens die (00-90) spawned
          // first, then the ones d10. Both are ordinary room dice; the pairing
          // rides along in each die's `presentation` block so it survives table
          // edits, reaches remote players and outlives a refresh
          // (src/lib/percentileRolls.ts).
          const pairId = isPercentile ? `pct_${nanoid(10)}` : null
          if (pairId) {
            const tensId = backend.addGenericDie(
              PERCENTILE_TENS_SHAPE,
              percentileTensPresentation(pairId),
            )
            if (!tensId) {
              const actionError = useMultiplayerStore.getState().roomActionError
              throw new Error(actionError?.message ?? 'Could not spawn D100.')
            }
            // The tens half carries no bonus — a per-die bonus applies once, to
            // the COMBINED value, and is attached to the ones die below.
            requested.push({ id: tensId, bonus: 0 })
          }

          const onesPresentation = pairId ? percentileOnesPresentation(pairId) : undefined
          const id = source.kind === 'specific'
            ? backend.addDie(entry.type, source.dieId, onesPresentation)
            : backend.addGenericDie(entry.type, onesPresentation)
          if (!id) {
            const actionError = useMultiplayerStore.getState().roomActionError
            throw new Error(
              actionError?.message
                ?? `Could not spawn ${isPercentile ? 'D100' : entry.type.toUpperCase()}.`,
            )
          }
          requested.push({ id, bonus: entry.perDieBonus })
        }
      }

      if (requested.length === 0) {
        throw new Error('This saved roll has no dice to roll.')
      }

      const requestedIds = requested.map(({ id }) => id)
      await waitForSavedRollSpawns(requestedIds, ownerId)

      const perDieBonuses = new Map<string, number>()
      requested.forEach(({ id, bonus }) => {
        if (bonus !== 0) perDieBonuses.set(id, bonus)
      })
      const activeSavedRoll: ActiveSavedRoll = {
        name: roll.name,
        flatBonus: roll.flatBonus,
        perDieBonuses,
      }
      useDiceStore.getState().setActiveSavedRoll(activeSavedRoll)

      const rollSequence = useMultiplayerStore.getState().rollStartedSequence
      backend.roll()
      await waitForRoomState('start the saved roll', (state) => (
        state.rollStartedSequence > rollSequence
        && sameIdSet(state.lastRollStartedDiceIds, requestedIds)
      ))

      markRollAsUsed(roll.id)
      onClose()
    } catch (error) {
      useDiceStore.getState().clearActiveSavedRoll()
      setExecutionError(error instanceof Error ? error.message : 'Could not execute the saved roll.')
    } finally {
      executingRef.current = false
      setIsExecuting(false)
    }
  }

  function handleEdit(roll: SavedRoll) {
    setEditingRoll(roll)
    setView('builder')
  }

  function handleDelete(roll: SavedRoll) {
    if (confirm(`Delete "${roll.name}"?`)) {
      deleteRoll(roll.id)
    }
  }

  function handleCreateNew() {
    setEditingRoll(null)
    setView('builder')
  }

  function handleSaveRoll(rollData: Omit<SavedRoll, 'id' | 'createdAt'>) {
    if (editingRoll) {
      // Update existing roll
      updateRoll(editingRoll.id, rollData)
    } else {
      // Create new roll
      addRoll({
        ...rollData,
        id: createClientId('roll'),
        createdAt: Date.now(),
      })
    }
    setEditingRoll(null)
    setView('list')
  }

  function handleCancelBuilder() {
    setEditingRoll(null)
    setView('list')
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="My Dice Rolls"
      desktopClassName="lg:mx-auto lg:max-w-5xl"
    >
      {view === 'list' ? (
        // List View
        <>
          {executionError && (
            <div
              role="alert"
              className="mb-4 rounded-lg px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#fecaca',
              }}
            >
              {executionError}
            </div>
          )}
          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search rolls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 rounded-lg"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(249, 135, 151, 0.3)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Tag filters */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedTag(null)}
                className="px-3 py-1 rounded-full text-sm transition-all"
                style={{
                  backgroundColor: selectedTag === null
                    ? 'var(--color-accent)'
                    : 'rgba(255, 255, 255, 0.1)',
                  color: selectedTag === null
                    ? '#ffffff'
                    : 'var(--color-text-secondary)',
                }}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className="px-3 py-1 rounded-full text-sm transition-all"
                  style={{
                    backgroundColor: selectedTag === tag
                      ? 'var(--color-accent)'
                      : 'rgba(255, 255, 255, 0.1)',
                    color: selectedTag === tag
                      ? '#ffffff'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Create new button */}
          <button
            onClick={handleCreateNew}
            className="w-full py-3 px-4 rounded-lg font-semibold mb-4 transition-all"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: '#ffffff',
            }}
          >
            ✨ Create New Roll
          </button>

          {/* Favorites section */}
          {favoriteRolls.length > 0 && (
            <>
              <h3
                className="text-sm font-semibold mb-2"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                ⭐ Favorites
              </h3>
              {favoriteRolls.map((roll) => (
                <SavedRollCard
                  key={roll.id}
                  roll={roll}
                  onRoll={handleRoll}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onToggleFavorite={() => toggleFavorite(roll.id)}
                  disabled={isExecuting}
                />
              ))}
            </>
          )}

          {/* Other rolls section */}
          {otherRolls.length > 0 && (
            <>
              {favoriteRolls.length > 0 && (
                <h3
                  className="text-sm font-semibold mb-2 mt-4"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  All Rolls
                </h3>
              )}
              {otherRolls.map((roll) => (
                <SavedRollCard
                  key={roll.id}
                  roll={roll}
                  onRoll={handleRoll}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onToggleFavorite={() => toggleFavorite(roll.id)}
                  disabled={isExecuting}
                />
              ))}
            </>
          )}

          {/* Empty state */}
          {filteredRolls.length === 0 && (
            <div
              className="text-center py-8"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {searchQuery || selectedTag ? (
                <p>No rolls found matching your search.</p>
              ) : (
                <>
                  <p className="text-4xl mb-2">🎲</p>
                  <p>No saved rolls yet.</p>
                  <p className="text-sm mt-1">Create your first custom roll!</p>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        // Builder View
        <RollBuilder
          initialRoll={editingRoll || undefined}
          tableDice={tableDice}
          onSave={handleSaveRoll}
          onCancel={handleCancelBuilder}
        />
      )}
    </BottomSheet>
  )
}
