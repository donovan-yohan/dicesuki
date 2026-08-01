/**
 * Saved Rolls Panel
 *
 * Main panel for managing saved/favorite dice rolls.
 * Shows list of saved rolls with search/filter and creation UI.
 */

import { useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { SavedRollCard } from './saved-rolls/SavedRollCard'
import { RollBuilder } from './saved-rolls/RollBuilder'
import { useDiceBackend } from '../../contexts/DiceBackendContext'
import type { TableDieSummary } from '../../types/tableDice'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import { useDiceStore } from '../../store/useDiceStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { createClientId } from '../../lib/clientId'
import { executePhysicalSavedRoll } from '../../lib/savedRollExecution'
import { SavedRoll } from '../../types/savedRolls'

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
  // Survives the panel closing and reopening, unlike `isExecuting`.
  const wavesPending = useDiceStore((s) => s.savedRollWavesPending)

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

  /**
   * Execute a saved roll on the table.
   *
   * The latch is held for the whole sequence, not just the first wave: a roll
   * with reroll or exploding dice keeps spawning after the panel has closed,
   * and a second roll starting mid-sequence would corrupt its plan.
   */
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

    try {
      await executePhysicalSavedRoll(roll, {
        backend,
        ownerId,
        // Fired once the dice are actually rolling. Everything after this point
        // reports through the HUD notice instead of this panel's inline error.
        onBaseWaveStarted: () => {
          markRollAsUsed(roll.id)
          onClose()
        },
      })
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
          {/* Follow-up waves keep spawning after the panel closes. If the
              player reopens it mid-sequence the roll buttons are inert (the
              execution latch rejects reentry), so say why rather than looking
              broken. */}
          {wavesPending && (
            <div
              role="status"
              data-testid="saved-roll-waves-pending"
              className="mb-4 rounded-lg px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(249, 135, 151, 0.12)',
                border: '1px solid rgba(249, 135, 151, 0.3)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Still rolling — waiting for the follow-up dice to land.
            </div>
          )}
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
                  disabled={isExecuting || wavesPending}
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
                  disabled={isExecuting || wavesPending}
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
