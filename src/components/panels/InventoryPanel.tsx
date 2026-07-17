/**
 * Inventory Panel
 *
 * Main panel for viewing and managing the player's dice collection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { INVENTORY_DIE_DRAG_TYPE, serializeInventoryDieDragPayload } from '../../lib/inventoryDrag'
import type { DiceShape } from '../../types/diceShape'
import type { DieRarity, InventoryDie } from '../../types/inventory'
import { useTheme } from '../../contexts/ThemeContext'
import type { Theme } from '../../themes/tokens'
import { BottomSheet } from './BottomSheet'
import { HeroDieInspector } from './HeroDieInspector'
import { SharedInventoryDicePreviewCanvas } from './SharedInventoryDicePreviewCanvas'

interface InventoryPanelProps {
  isOpen: boolean
  onClose: () => void
  onSpawnDie?: (dieType: string, inventoryDieId?: string) => void
  onInventoryDragStateChange?: (isDragging: boolean) => void
}

type StatusFilter = 'all' | 'favorites' | 'recent'
type SortOption = 'date' | 'name' | 'rarity' | 'set' | 'rolls'

const DICE_SHAPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
const RARITY_DISPLAY: DieRarity[] = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common']
const VISIBLE_DICE_BATCH_SIZE = 24
const RECENT_ROLL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const rarityOrder: Record<DieRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
}

export function InventoryPanel({ isOpen, onClose, onSpawnDie, onInventoryDragStateChange }: InventoryPanelProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [shapeFilter, setShapeFilter] = useState<'all' | DiceShape>('all')
  const [rarityFilter, setRarityFilter] = useState<'all' | DieRarity>('all')
  const [setFilter, setSetFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('date')
  const [visibleCount, setVisibleCount] = useState(VISIBLE_DICE_BATCH_SIZE)
  const [selectedDie, setSelectedDie] = useState<InventoryDie | null>(null)
  const [hasHydratedInventory, setHasHydratedInventory] = useState(() => (
    useInventoryStore.persist.hasHydrated()
  ))
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewSlotRefs = useRef<Map<string, HTMLElement>>(new Map())

  const { currentTheme } = useTheme()
  const { dice, getDevDice, removeAllDevDice } = useInventoryStore()

  // Inventory dice currently on the local player's table (spawned or in-flight), so
  // a card can show "Added" + a disabled button instead of "Add". Selected as raw
  // pieces and memoized into a Set so the reference is stable across renders.
  const tableDice = useMultiplayerStore((s) => s.dice)
  const pendingInventoryDieIds = useMultiplayerStore((s) => s.pendingInventoryDieIds)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const onTableInventoryIds = useMemo(() => {
    const ids = new Set<string>(pendingInventoryDieIds)
    for (const die of tableDice.values()) {
      const invId = die.presentation?.inventoryDieId
      if (invId && (!localPlayerId || die.ownerId === localPlayerId)) ids.add(invId)
    }
    return ids
  }, [tableDice, pendingInventoryDieIds, localPlayerId])
  const devDice = getDevDice()
  const hasDevDice = devDice.length > 0

  const availableSets = useMemo(() => {
    return Array.from(new Set(dice.map(die => die.setId))).sort((a, b) => a.localeCompare(b))
  }, [dice])

  const availableTags = useMemo(() => {
    return Array.from(new Set(dice.flatMap(die => die.tags ?? []))).sort((a, b) => a.localeCompare(b))
  }, [dice])

  const favoriteCount = useMemo(() => dice.filter(die => die.isFavorite).length, [dice])
  const recentCount = useMemo(() => dice.filter(die => isRecentlyRolled(die)).length, [dice])

  const filteredDice = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return dice
      .filter(die => {
        if (statusFilter === 'favorites' && !die.isFavorite) return false
        if (statusFilter === 'recent' && !isRecentlyRolled(die)) return false
        if (shapeFilter !== 'all' && die.type !== shapeFilter) return false
        if (rarityFilter !== 'all' && die.rarity !== rarityFilter) return false
        if (setFilter !== 'all' && die.setId !== setFilter) return false
        if (tagFilter !== 'all' && !(die.tags ?? []).includes(tagFilter)) return false

        if (!query) return true

        return [
          die.name,
          die.type,
          die.setId,
          die.rarity,
          die.description ?? '',
          die.id,
          ...(die.tags ?? []),
        ].some(value => value.toLowerCase().includes(query))
      })
      .sort((a, b) => sortInventoryDice(a, b, sortBy))
  }, [dice, rarityFilter, searchQuery, setFilter, shapeFilter, sortBy, statusFilter, tagFilter])

  const visibleDice = useMemo(() => {
    return filteredDice.slice(0, visibleCount)
  }, [filteredDice, visibleCount])
  const proceduralPreviewDice = useMemo(
    () => visibleDice.filter(die => !die.customAsset?.thumbnailUrl),
    [visibleDice],
  )
  const selectedInventoryDie = useMemo(() => {
    if (!selectedDie) return null
    return dice.find(die => die.id === selectedDie.id) ?? null
  }, [dice, selectedDie])

  const hasMoreDice = visibleDice.length < filteredDice.length
  const hasActiveFilters =
    statusFilter !== 'all' ||
    shapeFilter !== 'all' ||
    rarityFilter !== 'all' ||
    setFilter !== 'all' ||
    tagFilter !== 'all' ||
    searchQuery.trim().length > 0

  useEffect(() => {
    setVisibleCount(VISIBLE_DICE_BATCH_SIZE)
  }, [rarityFilter, searchQuery, setFilter, shapeFilter, sortBy, statusFilter, tagFilter])

  useEffect(() => {
    const unsubscribe = useInventoryStore.persist.onFinishHydration(() => {
      setHasHydratedInventory(true)
    })

    setHasHydratedInventory(useInventoryStore.persist.hasHydrated())

    return unsubscribe
  }, [])

  useEffect(() => {
    if (selectedDie && !selectedInventoryDie) {
      setSelectedDie(null)
    }
  }, [selectedDie, selectedInventoryDie])

  const handleRemoveDevDice = async () => {
    if (confirm(`Remove all ${devDice.length} dev/test dice?`)) {
      await removeAllDevDice()
    }
  }

  const clearFilters = () => {
    setStatusFilter('all')
    setShapeFilter('all')
    setRarityFilter('all')
    setSetFilter('all')
    setTagFilter('all')
    setSearchQuery('')
  }

  const handleSpawnDie = (die: InventoryDie) => {
    onSpawnDie?.(die.type, die.id)
  }

  const registerPreviewSlot = useCallback((dieId: string, element: HTMLElement | null) => {
    if (element) {
      previewSlotRefs.current.set(dieId, element)
    } else {
      previewSlotRefs.current.delete(dieId)
    }
  }, [])

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Dice Collection">
      <div
        className="space-y-5 pb-52 md:pb-0"
        style={{
          color: currentTheme.tokens.colors.text.primary,
        }}
      >
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2
              className="text-2xl font-bold"
              style={{ color: currentTheme.tokens.colors.accent }}
            >
              Dice Collection
            </h2>
            <p className="mt-1 text-sm" style={{ color: currentTheme.tokens.colors.text.secondary }}>
              {dice.length} {dice.length === 1 ? 'owned die' : 'owned dice'} · {filteredDice.length} matching
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasDevDice && (
              <button
                type="button"
                onClick={handleRemoveDevDice}
                className="h-9 rounded-md px-3 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                }}
              >
                Remove Dev Dice ({devDice.length})
              </button>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 rounded-md px-3 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: currentTheme.tokens.colors.surface,
                  color: currentTheme.tokens.colors.text.secondary,
                  border: `1px solid ${currentTheme.tokens.colors.text.muted}`,
                }}
              >
                Clear Filters
              </button>
            )}
          </div>
        </header>

        <div
          className="grid gap-3 rounded-lg p-3 md:grid-cols-[minmax(220px,1fr)_minmax(140px,0.6fr)_minmax(140px,0.6fr)]"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.18)',
            border: `1px solid ${currentTheme.tokens.colors.text.muted}`,
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal">
            <span style={{ color: currentTheme.tokens.colors.text.secondary }}>Search</span>
            <input
              type="text"
              placeholder="Name, set, tag, or id"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-10 rounded-md px-3 text-sm outline-none"
              style={{
                backgroundColor: currentTheme.tokens.colors.surface,
                color: currentTheme.tokens.colors.text.primary,
                border: `1px solid ${currentTheme.tokens.colors.text.muted}`,
              }}
            />
          </label>

          <FilterSelect
            label="Shape"
            value={shapeFilter}
            onChange={(value) => setShapeFilter(value as 'all' | DiceShape)}
            theme={currentTheme}
            ariaLabel="Filter by shape"
          >
            <option value="all">All Shapes</option>
            {DICE_SHAPES.map(shape => (
              <option key={shape} value={shape}>{shape.toUpperCase()}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Rarity"
            value={rarityFilter}
            onChange={(value) => setRarityFilter(value as 'all' | DieRarity)}
            theme={currentTheme}
            ariaLabel="Filter by rarity"
          >
            <option value="all">All Rarities</option>
            {RARITY_DISPLAY.map(rarity => (
              <option key={rarity} value={rarity}>{capitalize(rarity)}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Set"
            value={setFilter}
            onChange={setSetFilter}
            theme={currentTheme}
            ariaLabel="Filter by set"
          >
            <option value="all">All Sets</option>
            {availableSets.map(setId => (
              <option key={setId} value={setId}>{setId}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Tag"
            value={tagFilter}
            onChange={setTagFilter}
            theme={currentTheme}
            ariaLabel="Filter by tag"
          >
            <option value="all">All Tags</option>
            {availableTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Sort"
            value={sortBy}
            onChange={(value) => setSortBy(value as SortOption)}
            theme={currentTheme}
            ariaLabel="Sort dice"
          >
            <option value="date">Newest</option>
            <option value="name">Name</option>
            <option value="rarity">Rarity</option>
            <option value="set">Set</option>
            <option value="rolls">Most Rolled</option>
          </FilterSelect>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Inventory quick filters">
          <StatusButton
            label="All"
            count={dice.length}
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            theme={currentTheme}
          />
          <StatusButton
            label="Favorites"
            count={favoriteCount}
            active={statusFilter === 'favorites'}
            onClick={() => setStatusFilter('favorites')}
            theme={currentTheme}
          />
          <StatusButton
            label="Recent"
            count={recentCount}
            active={statusFilter === 'recent'}
            onClick={() => setStatusFilter('recent')}
            theme={currentTheme}
          />
        </div>

        {!hasHydratedInventory ? (
          <EmptyState
            title="Loading Dice"
            description="Restoring your dice collection."
            theme={currentTheme}
          />
        ) : dice.length === 0 ? (
          <EmptyState
            title="No Dice Yet"
            description="Your dice collection will appear here after you acquire dice."
            theme={currentTheme}
          />
        ) : filteredDice.length === 0 ? (
          <EmptyState
            title="No Matching Dice"
            description="Adjust filters or search to find another die."
            theme={currentTheme}
            action={hasActiveFilters ? <button type="button" onClick={clearFilters} className="mt-4 rounded-md px-4 py-2 text-sm font-semibold" style={{ backgroundColor: currentTheme.tokens.colors.accent, color: currentTheme.tokens.colors.text.primary }}>Clear Filters</button> : null}
          />
        ) : (
          <section className="space-y-4" aria-label="Inventory dice grid">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm" style={{ color: currentTheme.tokens.colors.text.secondary }}>
                Showing {visibleDice.length} of {filteredDice.length} dice
              </p>
            </div>

            <div ref={previewHostRef} className="relative">
              {proceduralPreviewDice.length > 0 && (
                <SharedInventoryDicePreviewCanvas
                  dice={proceduralPreviewDice}
                  hostRef={previewHostRef}
                  slotRefs={previewSlotRefs}
                />
              )}
              <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {visibleDice.map(die => (
                  <InventoryDieCard
                    key={die.id}
                    die={die}
                    theme={currentTheme}
                    onSelect={() => setSelectedDie(die)}
                    onSpawn={onSpawnDie ? () => handleSpawnDie(die) : undefined}
                    isOnTable={onTableInventoryIds.has(die.id)}
                    onDragStateChange={onInventoryDragStateChange}
                    registerPreviewSlot={registerPreviewSlot}
                  />
                ))}
              </div>
            </div>

            {hasMoreDice && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount(count => count + VISIBLE_DICE_BATCH_SIZE)}
                  className="rounded-md px-5 py-2 text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: currentTheme.tokens.colors.surface,
                    color: currentTheme.tokens.colors.text.primary,
                    border: `1px solid ${currentTheme.tokens.colors.text.muted}`,
                  }}
                >
                  Show {Math.min(VISIBLE_DICE_BATCH_SIZE, filteredDice.length - visibleDice.length)} More
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {selectedInventoryDie && (
        <HeroDieInspector
          die={selectedInventoryDie}
          theme={currentTheme}
          onClose={() => setSelectedDie(null)}
          onSpawn={onSpawnDie ? () => {
            handleSpawnDie(selectedInventoryDie)
            setSelectedDie(null)
            onClose()
          } : undefined}
        />
      )}
    </BottomSheet>
  )
}

interface FilterSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  theme: Theme
  ariaLabel: string
  children: ReactNode
}

function FilterSelect({ label, value, onChange, theme, ariaLabel, children }: FilterSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal">
      <span style={{ color: theme.tokens.colors.text.secondary }}>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md px-3 text-sm outline-none"
        style={{
          backgroundColor: theme.tokens.colors.surface,
          color: theme.tokens.colors.text.primary,
          border: `1px solid ${theme.tokens.colors.text.muted}`,
        }}
      >
        {children}
      </select>
    </label>
  )
}

interface StatusButtonProps {
  label: string
  count: number
  active: boolean
  onClick: () => void
  theme: Theme
}

function StatusButton({ label, count, active, onClick, theme }: StatusButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="h-9 shrink-0 rounded-md px-3 text-sm font-semibold transition-colors"
      style={{
        backgroundColor: active ? theme.tokens.colors.accent : theme.tokens.colors.surface,
        color: active ? theme.tokens.colors.text.primary : theme.tokens.colors.text.secondary,
        border: `1px solid ${active ? theme.tokens.colors.accent : theme.tokens.colors.text.muted}`,
      }}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  )
}

interface InventoryDieCardProps {
  die: InventoryDie
  theme: Theme
  onSelect: () => void
  onSpawn?: () => void
  isOnTable?: boolean
  onDragStateChange?: (isDragging: boolean) => void
  registerPreviewSlot: (dieId: string, element: HTMLElement | null) => void
}

function InventoryDieCard({
  die,
  theme,
  onSelect,
  onSpawn,
  isOnTable = false,
  onDragStateChange,
  registerPreviewSlot,
}: InventoryDieCardProps) {
  const rarityColor = getRarityColor(die.rarity, theme)

  return (
    <article
      className="group relative scroll-mb-56 overflow-hidden rounded-lg md:scroll-mb-0"
      style={{
        backgroundColor: theme.tokens.colors.surface,
        border: `1px solid ${rarityColor}`,
      }}
      draggable
      onDragStart={(event) => {
        onDragStateChange?.(true)
        handleInventoryDieDragStart(event, die)
      }}
      onDragEnd={() => onDragStateChange?.(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full scroll-mb-56 p-3 text-left md:scroll-mb-0"
        aria-label={`Inspect ${die.name}`}
      >
        <div
          className="relative aspect-square w-full overflow-hidden rounded-md"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.28)',
            border: `1px solid ${rarityColor}`,
          }}
        >
          {die.customAsset?.thumbnailUrl ? (
            <img
              src={die.customAsset.thumbnailUrl}
              alt={`${die.name} preview`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              data-testid="dice-thumbnail"
            />
          ) : (
            <div
              ref={(element) => registerPreviewSlot(die.id, element)}
              data-testid="dice-preview"
              data-preview-id={die.id}
              role="img"
              aria-label={`${die.name} 3D preview`}
              className="absolute inset-0"
            />
          )}
          <div className="absolute left-2 top-2 z-20 flex gap-1">
            {die.isFavorite && <Badge label="Fav" theme={theme} />}
            {die.isLocked && <Badge label="Lock" theme={theme} />}
          </div>
          {die.isDev && (
            <div className="absolute right-2 top-2 z-20">
              <Badge label="DEV" theme={theme} tone="danger" />
            </div>
          )}
        </div>

        <div className="mt-3 min-h-[86px]">
          <div className="truncate text-sm font-semibold" style={{ color: theme.tokens.colors.text.primary }}>
            {die.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs" style={{ color: theme.tokens.colors.text.secondary }}>
            <span>{die.type.toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span style={{ color: rarityColor }}>{capitalize(die.rarity)}</span>
          </div>
          <div className="mt-1 truncate text-xs" style={{ color: theme.tokens.colors.text.muted }}>
            {die.setId}
          </div>
          {die.tags && die.tags.length > 0 && (
            <div className="mt-2 flex min-h-[20px] flex-wrap gap-1">
              {die.tags.slice(0, 2).map(tag => (
                <span
                  key={tag}
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: theme.tokens.colors.text.secondary,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {onSpawn && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={isOnTable ? undefined : onSpawn}
            disabled={isOnTable}
            className="h-9 w-full rounded-md text-sm font-semibold transition-colors"
            style={{
              backgroundColor: isOnTable ? theme.tokens.colors.surface : theme.tokens.colors.accent,
              color: isOnTable ? theme.tokens.colors.text.muted : theme.tokens.colors.text.primary,
              cursor: isOnTable ? 'not-allowed' : 'pointer',
              opacity: isOnTable ? 0.6 : 1,
            }}
            aria-label={isOnTable ? `${die.name} is on the table` : `Add ${die.name} to table`}
          >
            {isOnTable ? 'Added' : 'Add'}
          </button>
        </div>
      )}
    </article>
  )
}

function Badge({
  label,
  theme,
  tone = 'default',
}: {
  label: string
  theme: Theme
  tone?: 'default' | 'danger'
}) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{
        backgroundColor: tone === 'danger' ? '#dc2626' : 'rgba(0, 0, 0, 0.62)',
        color: tone === 'danger' ? '#ffffff' : theme.tokens.colors.text.primary,
      }}
    >
      {label}
    </span>
  )
}

interface EmptyStateProps {
  title: string
  description: string
  theme: Theme
  action?: ReactNode
}

function EmptyState({ title, description, theme, action }: EmptyStateProps) {
  return (
    <div
      className="rounded-lg px-4 py-12 text-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.18)',
        border: `1px solid ${theme.tokens.colors.text.muted}`,
        color: theme.tokens.colors.text.secondary,
      }}
    >
      <div className="text-xl font-semibold" style={{ color: theme.tokens.colors.text.primary }}>
        {title}
      </div>
      <p className="mx-auto mt-2 max-w-sm text-sm">
        {description}
      </p>
      {action}
    </div>
  )
}

function sortInventoryDice(a: InventoryDie, b: InventoryDie, sortBy: SortOption) {
  switch (sortBy) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'rarity':
      return rarityOrder[b.rarity] - rarityOrder[a.rarity] || b.acquiredAt - a.acquiredAt
    case 'set':
      return a.setId.localeCompare(b.setId) || a.name.localeCompare(b.name)
    case 'rolls':
      return b.stats.timesRolled - a.stats.timesRolled || b.acquiredAt - a.acquiredAt
    case 'date':
    default:
      return b.acquiredAt - a.acquiredAt
  }
}

function isRecentlyRolled(die: InventoryDie) {
  if ((die.recentRollValues?.length ?? 0) > 0) return true
  if (!die.lastRolledAt) return false
  return Date.now() - die.lastRolledAt <= RECENT_ROLL_WINDOW_MS
}

function handleInventoryDieDragStart(event: DragEvent<HTMLElement>, die: InventoryDie) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(INVENTORY_DIE_DRAG_TYPE, serializeInventoryDieDragPayload({
    inventoryDieId: die.id,
    type: die.type,
    name: die.name,
  }))
  event.dataTransfer.setData('text/plain', die.id)
}

function getRarityColor(rarity: DieRarity, theme: Theme): string {
  const rarityColors: Record<DieRarity, string> = {
    common: theme.tokens.colors.text.secondary,
    uncommon: '#1eff00',
    rare: '#0070dd',
    epic: '#a335ee',
    legendary: '#ff8000',
    mythic: '#e6cc80',
  }
  return rarityColors[rarity]
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
