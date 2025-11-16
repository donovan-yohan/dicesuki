/**
 * Saved Rolls Panel
 *
 * Main panel for managing saved/favorite dice rolls.
 * Shows list of saved rolls with search/filter and creation UI.
 */

import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { SavedRollCard } from './saved-rolls/SavedRollCard'
import { useSavedRollsStore, createNewRoll, saveCurrentRoll } from '../../store/useSavedRollsStore'
import { SavedRoll } from '../../types/savedRolls'
import { executeSavedRoll } from '../../lib/rollEngine'
import { useDiceStore } from '../../store/useDiceStore'

interface SavedRollsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SavedRollsPanel({ isOpen, onClose }: SavedRollsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'builder'>('list')

  const {
    savedRolls,
    currentlyEditing,
    deleteRoll,
    toggleFavorite,
    markRollAsUsed,
    startEditing,
    stopEditing,
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
  function handleRoll(roll: SavedRoll) {
    console.log('Executing saved roll:', roll.name)

    // Mark as used
    markRollAsUsed(roll.id)

    // Execute the roll
    const result = executeSavedRoll(roll)

    // Store the result in the dice store
    // TODO: This needs to be updated to store the full breakdown
    // For now, we'll just use the total
    const diceStore = useDiceStore.getState()
    diceStore.startRoll(roll.dice.length)

    // Record each dice entry as a result
    // This is a simplified version - will be enhanced later
    result.diceResults.forEach((diceResult, idx) => {
      diceStore.recordDiceResult(
        `saved-${roll.id}-${idx}`,
        diceResult.subtotal,
        diceResult.diceType
      )
    })

    // Close the panel after rolling
    onClose()
  }

  function handleEdit(roll: SavedRoll) {
    startEditing(roll)
    setView('builder')
  }

  function handleDelete(roll: SavedRoll) {
    if (confirm(`Delete "${roll.name}"?`)) {
      deleteRoll(roll.id)
    }
  }

  function handleCreateNew() {
    createNewRoll()
    setView('builder')
  }

  function handleSaveBuilder() {
    saveCurrentRoll()
    setView('list')
  }

  function handleCancelBuilder() {
    stopEditing()
    setView('list')
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="My Dice Rolls">
      {view === 'list' ? (
        // List View
        <>
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
                border: '1px solid rgba(251, 146, 60, 0.3)',
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
        // Builder View - Placeholder for now
        <div>
          <div className="mb-4">
            <p
              className="text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Roll Builder UI coming soon...
            </p>
            {currentlyEditing && (
              <p
                className="text-sm mt-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Editing: {currentlyEditing.name}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSaveBuilder}
              className="flex-1 py-2 px-4 rounded-lg font-semibold"
              style={{
                backgroundColor: 'var(--color-accent)',
                color: '#ffffff',
              }}
            >
              Save
            </button>
            <button
              onClick={handleCancelBuilder}
              className="flex-1 py-2 px-4 rounded-lg font-semibold"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
