/**
 * Inventory Panel
 *
 * Main panel for viewing and managing player's dice collection.
 * Shows grid of owned dice with filtering, sorting, and search.
 */

import { useState, useMemo } from 'react'
import { BottomSheet } from './BottomSheet'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useTheme } from '../../contexts/ThemeContext'
import { InventoryDie, DieRarity } from '../../types/inventory'

interface InventoryPanelProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = 'all' | 'sets' | 'rarity' | 'favorites'
type SortOption = 'name' | 'rarity' | 'set' | 'date'

export function InventoryPanel({ isOpen, onClose }: InventoryPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('date')
  const [selectedDie, setSelectedDie] = useState<InventoryDie | null>(null)

  const { currentTheme } = useTheme()
  const { dice } = useInventoryStore()

  // Filter and sort dice
  const displayedDice = useMemo(() => {
    let filtered = dice

    // Apply tab filter
    if (activeTab === 'favorites') {
      filtered = dice.filter(d => d.isFavorite)
    }
    // For 'sets' and 'rarity', we'll group them later
    // For now, 'all' shows everything

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(die =>
        die.name.toLowerCase().includes(query) ||
        die.type.toLowerCase().includes(query) ||
        die.setId.toLowerCase().includes(query) ||
        die.rarity.toLowerCase().includes(query)
      )
    }

    // Apply sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'rarity': {
          const rarityOrder: Record<DieRarity, number> = {
            common: 0,
            uncommon: 1,
            rare: 2,
            epic: 3,
            legendary: 4,
            mythic: 5
          }
          return rarityOrder[b.rarity] - rarityOrder[a.rarity]
        }
        case 'set':
          return a.setId.localeCompare(b.setId)
        case 'date':
        default:
          return b.acquiredAt - a.acquiredAt
      }
    })

    return sorted
  }, [dice, activeTab, searchQuery, sortBy])

  // Separate favorites (only for 'all' tab)
  const { favoriteDice, otherDice } = useMemo(() => {
    if (activeTab !== 'all') return { favoriteDice: [], otherDice: [] }
    return {
      favoriteDice: displayedDice.filter(d => d.isFavorite),
      otherDice: displayedDice.filter(d => !d.isFavorite)
    }
  }, [activeTab, displayedDice])

  // Group by set for 'sets' tab
  const diceBySet = useMemo(() => {
    if (activeTab !== 'sets') return {}

    const grouped: Record<string, InventoryDie[]> = {}
    displayedDice.forEach(die => {
      if (!grouped[die.setId]) {
        grouped[die.setId] = []
      }
      grouped[die.setId].push(die)
    })
    return grouped
  }, [activeTab, displayedDice])

  // Group by rarity for 'rarity' tab
  const diceByRarity = useMemo((): Record<DieRarity, InventoryDie[]> => {
    const grouped: Record<DieRarity, InventoryDie[]> = {
      common: [],
      uncommon: [],
      rare: [],
      epic: [],
      legendary: [],
      mythic: []
    }

    if (activeTab !== 'rarity') return grouped

    displayedDice.forEach(die => {
      grouped[die.rarity].push(die)
    })
    return grouped
  }, [activeTab, displayedDice])

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Dice Collection">
      <div
        className="p-4 md:p-6"
        style={{
          color: currentTheme.tokens.colors.text.primary,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-2xl font-bold"
            style={{ color: currentTheme.tokens.colors.accent }}
          >
            Dice Collection
          </h2>
          <div className="text-sm" style={{ color: currentTheme.tokens.colors.text.secondary }}>
            {dice.length} {dice.length === 1 ? 'die' : 'dice'}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {(['all', 'sets', 'rarity', 'favorites'] as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg whitespace-nowrap transition-all"
              style={{
                backgroundColor: activeTab === tab
                  ? currentTheme.tokens.colors.accent
                  : currentTheme.tokens.colors.surface,
                color: activeTab === tab
                  ? currentTheme.tokens.colors.text.primary
                  : currentTheme.tokens.colors.text.secondary
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Search and Sort */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="Search dice..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg"
            style={{
              backgroundColor: currentTheme.tokens.colors.surface,
              color: currentTheme.tokens.colors.text.primary,
              border: `1px solid ${currentTheme.tokens.colors.text.muted}`
            }}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="px-4 py-2 rounded-lg"
            style={{
              backgroundColor: currentTheme.tokens.colors.surface,
              color: currentTheme.tokens.colors.text.primary,
              border: `1px solid ${currentTheme.tokens.colors.text.muted}`
            }}
          >
            <option value="date">Date Added</option>
            <option value="name">Name</option>
            <option value="rarity">Rarity</option>
            <option value="set">Set</option>
          </select>
        </div>

        {/* Content */}
        {dice.length === 0 ? (
          // Empty state
          <div
            className="text-center py-12"
            style={{ color: currentTheme.tokens.colors.text.secondary }}
          >
            <div className="text-6xl mb-4">🎲</div>
            <h3 className="text-xl font-semibold mb-2">No Dice Yet</h3>
            <p className="text-sm">
              Your dice collection will appear here.
              <br />
              Start by crafting or acquiring new dice!
            </p>
          </div>
        ) : activeTab === 'sets' ? (
          // Sets view - grouped by set
          <div className="space-y-6">
            {Object.entries(diceBySet).map(([setId, setDice]) => (
              <div key={setId}>
                <h3
                  className="text-lg font-semibold mb-3"
                  style={{ color: currentTheme.tokens.colors.text.primary }}
                >
                  {setId} ({setDice.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {setDice.map(die => (
                    <DieCardPlaceholder
                      key={die.id}
                      die={die}
                      onClick={() => setSelectedDie(die)}
                      theme={currentTheme}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'rarity' ? (
          // Rarity view - grouped by rarity
          <div className="space-y-6">
            {(['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'] as DieRarity[]).map(rarity => {
              const rarityDice = diceByRarity[rarity]
              if (rarityDice.length === 0) return null

              return (
                <div key={rarity}>
                  <h3
                    className="text-lg font-semibold mb-3 capitalize"
                    style={{ color: getRarityColor(rarity, currentTheme) }}
                  >
                    {rarity} ({rarityDice.length})
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {rarityDice.map((die: InventoryDie) => (
                      <DieCardPlaceholder
                        key={die.id}
                        die={die}
                        onClick={() => setSelectedDie(die)}
                        theme={currentTheme}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          // All/Favorites view - simple grid
          <div className="space-y-6">
            {/* Favorites section (if viewing all and there are favorites) */}
            {activeTab === 'all' && favoriteDice.length > 0 && (
              <div>
                <h3
                  className="text-lg font-semibold mb-3"
                  style={{ color: currentTheme.tokens.colors.accent }}
                >
                  ⭐ Favorites ({favoriteDice.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {favoriteDice.map(die => (
                    <DieCardPlaceholder
                      key={die.id}
                      die={die}
                      onClick={() => setSelectedDie(die)}
                      theme={currentTheme}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other dice */}
            {(activeTab === 'favorites' ? favoriteDice : otherDice).length > 0 && (
              <div>
                {activeTab === 'all' && otherDice.length > 0 && (
                  <h3
                    className="text-lg font-semibold mb-3"
                    style={{ color: currentTheme.tokens.colors.text.primary }}
                  >
                    All Dice ({otherDice.length})
                  </h3>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {(activeTab === 'favorites' ? favoriteDice : otherDice).map(die => (
                    <DieCardPlaceholder
                      key={die.id}
                      die={die}
                      onClick={() => setSelectedDie(die)}
                      theme={currentTheme}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state for favorites tab */}
            {activeTab === 'favorites' && favoriteDice.length === 0 && (
              <div
                className="text-center py-12"
                style={{ color: currentTheme.tokens.colors.text.secondary }}
              >
                <div className="text-6xl mb-4">⭐</div>
                <h3 className="text-xl font-semibold mb-2">No Favorites Yet</h3>
                <p className="text-sm">
                  Mark dice as favorites to see them here!
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Die Detail Modal (placeholder) */}
      {selectedDie && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setSelectedDie(null)}
        >
          <div
            className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold">{selectedDie.name}</h3>
              <button
                onClick={() => setSelectedDie(null)}
                className="text-2xl hover:text-red-500"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <p>Type: {selectedDie.type}</p>
              <p>Rarity: <span style={{ color: getRarityColor(selectedDie.rarity, currentTheme) }}>{selectedDie.rarity}</span></p>
              <p>Set: {selectedDie.setId}</p>
              {selectedDie.isLocked && <p>🔒 Locked</p>}
              {selectedDie.isFavorite && <p>⭐ Favorite</p>}
              <p className="pt-2 border-t border-gray-700">
                Total Rolls: {selectedDie.stats.timesRolled}
              </p>
            </div>
            <div className="mt-4 text-xs text-gray-500">
              <p>Acquired: {new Date(selectedDie.acquiredAt).toLocaleDateString()}</p>
              <p>ID: {selectedDie.id}</p>
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

// ============================================================================
// Placeholder Die Card (will be replaced with proper component)
// ============================================================================

interface DieCardPlaceholderProps {
  die: InventoryDie
  onClick: () => void
  theme: any
}

function DieCardPlaceholder({ die, onClick, theme }: DieCardPlaceholderProps) {
  return (
    <button
      onClick={onClick}
      className="relative p-4 rounded-lg transition-all hover:scale-105"
      style={{
        backgroundColor: theme.tokens.colors.surface,
        border: `2px solid ${getRarityColor(die.rarity, theme)}`,
        color: theme.tokens.colors.text.primary
      }}
    >
      {/* Lock indicator */}
      {die.isLocked && (
        <div className="absolute top-2 right-2 text-xs">🔒</div>
      )}

      {/* Favorite indicator */}
      {die.isFavorite && (
        <div className="absolute top-2 left-2 text-xs">⭐</div>
      )}

      {/* 3D Preview placeholder */}
      <div
        className="w-full aspect-square mb-2 rounded flex items-center justify-center text-4xl"
        style={{
          backgroundColor: 'rgba(0,0,0,0.2)',
          border: `1px solid ${getRarityColor(die.rarity, theme)}`
        }}
      >
        🎲
      </div>

      {/* Die info */}
      <div className="text-left">
        <div className="font-semibold text-sm truncate">{die.name}</div>
        <div className="text-xs opacity-75">{die.type.toUpperCase()}</div>
        <div
          className="text-xs font-semibold mt-1"
          style={{ color: getRarityColor(die.rarity, theme) }}
        >
          {die.rarity}
        </div>
        <div className="text-xs opacity-50 mt-1">{die.setId}</div>

        {/* Assignment indicator */}
        {die.assignedToRolls.length > 0 && (
          <div className="text-xs mt-2 opacity-75">
            📋 Assigned: {die.assignedToRolls.length}
          </div>
        )}
      </div>
    </button>
  )
}

// ============================================================================
// Helper Functions
// ============================================================================

function getRarityColor(rarity: DieRarity, theme: any): string {
  const rarityColors: Record<DieRarity, string> = {
    common: theme.tokens.colors.text.secondary,
    uncommon: '#1eff00',
    rare: '#0070dd',
    epic: '#a335ee',
    legendary: '#ff8000',
    mythic: '#e6cc80'
  }
  return rarityColors[rarity]
}
