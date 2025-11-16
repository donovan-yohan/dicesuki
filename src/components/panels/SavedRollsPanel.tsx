/**
 * Saved Rolls Panel
 *
 * Main panel for managing saved/favorite dice rolls.
 * Shows list of saved rolls with search/filter and creation UI.
 */

import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { SavedRollCard } from './saved-rolls/SavedRollCard'
import { RollBuilder } from './saved-rolls/RollBuilder'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { SavedRoll } from '../../types/savedRolls'
import { executeSavedRoll } from '../../lib/rollEngine'
import { useDiceStore } from '../../store/useDiceStore'
import { useTheme } from '../../contexts/ThemeContext'

interface SavedRollsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SavedRollsPanel({ isOpen, onClose }: SavedRollsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'builder'>('list')
  const [editingRoll, setEditingRoll] = useState<SavedRoll | null>(null)

  const { currentTheme } = useTheme()

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

  const { addDice, removeAllDice } = useDiceManagerStore()

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

    // Clear existing dice
    removeAllDice()

    // Spawn dice for each entry in the roll
    roll.dice.forEach((entry) => {
      // Spawn the number of dice specified in quantity
      for (let i = 0; i < entry.quantity; i++) {
        addDice(entry.type, currentTheme.id)
      }
    })

    // Execute the roll calculation
    const result = executeSavedRoll(roll)

    // Store the result in the dice store
    const diceStore = useDiceStore.getState()
    const totalDiceCount = roll.dice.reduce((sum, entry) => sum + entry.quantity, 0)
    diceStore.startRoll(totalDiceCount)

    // Record the result
    // For now, we'll create individual dice results
    let diceIndex = 0
    result.diceResults.forEach((diceResult) => {
      // Each diceResult has multiple individual rolls
      diceResult.rolls.forEach((singleRoll) => {
        if (singleRoll.wasKept) {
          diceStore.recordDiceResult(
            `saved-${roll.id}-${diceIndex++}`,
            singleRoll.value,
            diceResult.diceType
          )
        }
      })
    })

    // Close the panel after spawning dice
    onClose()
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
        id: crypto.randomUUID(),
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
        // Builder View
        <RollBuilder
          initialRoll={editingRoll || undefined}
          onSave={handleSaveRoll}
          onCancel={handleCancelBuilder}
        />
      )}
    </BottomSheet>
  )
}
