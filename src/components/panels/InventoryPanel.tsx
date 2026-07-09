/**
 * Inventory Panel
 *
 * Main panel for viewing and managing the player's dice collection.
 */

import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useInventoryStore } from '../../store/useInventoryStore'
import type { DiceShape } from '../../types/diceShape'
import type { DieRarity, InventoryDie } from '../../types/inventory'
import { useTheme } from '../../contexts/ThemeContext'
import type { Theme } from '../../themes/tokens'
import { BottomSheet } from './BottomSheet'

interface InventoryPanelProps {
  isOpen: boolean
  onClose: () => void
  onSpawnDie?: (dieType: string, inventoryDieId?: string) => void
}

type StatusFilter = 'all' | 'favorites' | 'recent'
type SortOption = 'date' | 'name' | 'rarity' | 'set' | 'rolls'

const DICE_SHAPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
const RARITY_DISPLAY: DieRarity[] = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common']
const VISIBLE_DICE_BATCH_SIZE = 24
const RECENT_ROLL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const INVENTORY_DICE_DRAG_TYPE = 'application/dicesuki-inventory-die'

const rarityOrder: Record<DieRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
}

export function InventoryPanel({ isOpen, onClose, onSpawnDie }: InventoryPanelProps) {
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

  const { currentTheme } = useTheme()
  const { dice, getDevDice, removeAllDevDice } = useInventoryStore()
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
    if (selectedDie && !dice.some(die => die.id === selectedDie.id)) {
      setSelectedDie(null)
    }
  }, [dice, selectedDie])

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

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Dice Collection">
      <div
        className="space-y-5"
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

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {visibleDice.map(die => (
                <InventoryDieCard
                  key={die.id}
                  die={die}
                  theme={currentTheme}
                  onSelect={() => setSelectedDie(die)}
                  onSpawn={onSpawnDie ? () => handleSpawnDie(die) : undefined}
                />
              ))}
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

      {selectedDie && (
        <DieDetailDialog
          die={selectedDie}
          theme={currentTheme}
          onClose={() => setSelectedDie(null)}
          onSpawn={onSpawnDie ? () => {
            handleSpawnDie(selectedDie)
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
}

function InventoryDieCard({ die, theme, onSelect, onSpawn }: InventoryDieCardProps) {
  const rarityColor = getRarityColor(die.rarity, theme)

  return (
    <article
      className="group relative overflow-hidden rounded-lg"
      style={{
        backgroundColor: theme.tokens.colors.surface,
        border: `1px solid ${rarityColor}`,
      }}
      draggable
      onDragStart={(event) => handleInventoryDieDragStart(event, die)}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full p-3 text-left"
        aria-label={`Inspect ${die.name}`}
      >
        <div
          className="relative aspect-square w-full overflow-hidden rounded-md"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.28)',
            border: `1px solid ${rarityColor}`,
          }}
        >
          <InventoryDicePreview die={die} />
          <div className="absolute left-2 top-2 flex gap-1">
            {die.isFavorite && <Badge label="Fav" theme={theme} />}
            {die.isLocked && <Badge label="Lock" theme={theme} />}
          </div>
          {die.isDev && (
            <div className="absolute right-2 top-2">
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
            onClick={onSpawn}
            className="h-9 w-full rounded-md text-sm font-semibold transition-colors"
            style={{
              backgroundColor: theme.tokens.colors.accent,
              color: theme.tokens.colors.text.primary,
            }}
            aria-label={`Add ${die.name} to table`}
          >
            Add
          </button>
        </div>
      )}
    </article>
  )
}

function InventoryDicePreview({ die }: { die: InventoryDie }) {
  const baseColor = normalizeHexColor(die.appearance.baseColor, '#f8fafc')
  const accentColor = normalizeHexColor(die.appearance.accentColor, '#111827')
  const highlightColor = shiftHexColor(baseColor, 46)
  const shadowColor = shiftHexColor(baseColor, -54)
  const midColor = shiftHexColor(baseColor, -18)
  const gradientId = `inventory-die-gradient-${sanitizeSvgId(die.id)}`
  const shadowId = `inventory-die-shadow-${sanitizeSvgId(die.id)}`

  return (
    <svg
      data-testid="dice-preview"
      role="img"
      aria-label={`${die.name} preview`}
      className="inventory-dice-preview-svg h-full w-full"
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="22" y1="10" x2="98" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={highlightColor} />
          <stop offset="52%" stopColor={baseColor} />
          <stop offset="100%" stopColor={shadowColor} />
        </linearGradient>
        <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000000" floodOpacity="0.35" />
        </filter>
      </defs>

      <g className="inventory-dice-float" filter={`url(#${shadowId})`}>
        {renderPreviewShape(die.type, {
          gradientId,
          accentColor,
          highlightColor,
          baseColor,
          midColor,
          shadowColor,
        })}
      </g>
    </svg>
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

interface DieDetailDialogProps {
  die: InventoryDie
  theme: Theme
  onClose: () => void
  onSpawn?: () => void
}

function DieDetailDialog({ die, theme, onClose, onSpawn }: DieDetailDialogProps) {
  const rarityColor = getRarityColor(die.rarity, theme)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${die.name} details`}
        className="grid max-h-[88vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-lg p-4 md:grid-cols-[220px_1fr] md:p-5"
        style={{
          backgroundColor: theme.tokens.colors.surface,
          color: theme.tokens.colors.text.primary,
          border: `1px solid ${rarityColor}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="aspect-square overflow-hidden rounded-lg" style={{ backgroundColor: 'rgba(0, 0, 0, 0.28)' }}>
          <InventoryDicePreview die={die} />
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold">{die.name}</h3>
              <p className="mt-1 text-sm" style={{ color: theme.tokens.colors.text.secondary }}>
                {die.type.toUpperCase()} · <span style={{ color: rarityColor }}>{capitalize(die.rarity)}</span> · {die.setId}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-full text-lg"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: theme.tokens.colors.text.secondary,
              }}
              aria-label="Close die details"
            >
              x
            </button>
          </div>

          {die.description && (
            <p className="text-sm" style={{ color: theme.tokens.colors.text.secondary }}>
              {die.description}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <DetailStat label="Rolls" value={die.stats.timesRolled.toString()} theme={theme} />
            <DetailStat label="Highest" value={die.stats.highestRoll?.toString() ?? '-'} theme={theme} />
            <DetailStat label="Source" value={die.source} theme={theme} />
            <DetailStat label="Acquired" value={new Date(die.acquiredAt).toLocaleDateString()} theme={theme} />
          </dl>

          {die.tags && die.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {die.tags.map(tag => (
                <span
                  key={tag}
                  className="rounded px-2 py-1 text-xs"
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

          <p className="break-all text-xs" style={{ color: theme.tokens.colors.text.muted }}>
            ID: {die.id}
          </p>

          {onSpawn && (
            <button
              type="button"
              onClick={onSpawn}
              className="h-11 w-full rounded-md text-sm font-semibold"
              style={{
                backgroundColor: theme.tokens.colors.accent,
                color: theme.tokens.colors.text.primary,
              }}
            >
              Add to Table
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailStat({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.18)',
        border: `1px solid ${theme.tokens.colors.text.muted}`,
      }}
    >
      <dt className="text-xs uppercase tracking-normal" style={{ color: theme.tokens.colors.text.muted }}>
        {label}
      </dt>
      <dd className="mt-1 truncate font-semibold">{value}</dd>
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
  event.dataTransfer.setData(INVENTORY_DICE_DRAG_TYPE, JSON.stringify({
    inventoryDieId: die.id,
    type: die.type,
    name: die.name,
  }))
  event.dataTransfer.setData('text/plain', die.id)
}

interface PreviewShapeColors {
  gradientId: string
  accentColor: string
  highlightColor: string
  baseColor: string
  midColor: string
  shadowColor: string
}

function renderPreviewShape(shape: DiceShape, colors: PreviewShapeColors) {
  const fill = `url(#${colors.gradientId})`
  const stroke = colors.accentColor
  const strokeProps = {
    stroke,
    strokeWidth: 2.4,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  }

  switch (shape) {
    case 'd4':
      return (
        <>
          <polygon points="60,14 104,98 16,98" fill={fill} {...strokeProps} />
          <path d="M60 14 L60 98 M60 14 L38 98 M60 14 L82 98" fill="none" opacity="0.55" {...strokeProps} />
          <polygon points="60,14 82,98 60,98" fill={colors.highlightColor} opacity="0.22" />
        </>
      )
    case 'd6':
      return (
        <>
          <polygon points="60,12 100,35 60,58 20,35" fill={colors.highlightColor} {...strokeProps} />
          <polygon points="20,35 60,58 60,104 20,80" fill={colors.midColor} {...strokeProps} />
          <polygon points="100,35 60,58 60,104 100,80" fill={colors.shadowColor} {...strokeProps} />
          <path d="M60 12 L60 58 L60 104 M20 35 L60 58 L100 35" fill="none" opacity="0.42" {...strokeProps} />
        </>
      )
    case 'd8':
      return (
        <>
          <polygon points="60,10 106,60 60,110 14,60" fill={fill} {...strokeProps} />
          <path d="M60 10 L60 110 M14 60 L106 60 M60 10 L88 60 L60 110 L32 60 Z" fill="none" opacity="0.48" {...strokeProps} />
          <polygon points="60,10 106,60 60,60" fill={colors.highlightColor} opacity="0.28" />
        </>
      )
    case 'd10':
      return (
        <>
          <polygon points="60,8 96,34 92,80 60,112 28,80 24,34" fill={fill} {...strokeProps} />
          <path d="M60 8 L60 112 M24 34 L60 56 L96 34 M28 80 L60 56 L92 80" fill="none" opacity="0.5" {...strokeProps} />
          <polygon points="60,8 96,34 60,56 24,34" fill={colors.highlightColor} opacity="0.24" />
        </>
      )
    case 'd12':
      return (
        <>
          <polygon points="60,11 102,42 86,96 34,96 18,42" fill={fill} {...strokeProps} />
          <polygon points="60,32 82,48 74,77 46,77 38,48" fill="none" opacity="0.62" {...strokeProps} />
          <path d="M60 11 L60 32 M102 42 L82 48 M86 96 L74 77 M34 96 L46 77 M18 42 L38 48" fill="none" opacity="0.45" {...strokeProps} />
        </>
      )
    case 'd20':
      return (
        <>
          <polygon points="60,8 102,31 108,78 76,112 30,102 12,58 32,20" fill={fill} {...strokeProps} />
          <path d="M60 8 L58 58 L102 31 M58 58 L108 78 M58 58 L76 112 M58 58 L30 102 M58 58 L12 58 M58 58 L32 20 M32 20 L102 31 M12 58 L30 102 L76 112 L108 78" fill="none" opacity="0.48" {...strokeProps} />
          <polygon points="60,8 102,31 58,58 32,20" fill={colors.highlightColor} opacity="0.24" />
        </>
      )
  }
}

function sanitizeSvgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function normalizeHexColor(value: string | undefined, fallback: string) {
  if (!value) return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return fallback
}

function shiftHexColor(hex: string, amount: number) {
  const normalized = normalizeHexColor(hex, '#ffffff').slice(1)
  const value = Number.parseInt(normalized, 16)
  const r = clampColor((value >> 16) + amount)
  const g = clampColor(((value >> 8) & 0xff) + amount)
  const b = clampColor((value & 0xff) + amount)
  return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`
}

function clampColor(value: number) {
  return Math.max(0, Math.min(255, value))
}

function toHexPair(value: number) {
  return value.toString(16).padStart(2, '0')
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
