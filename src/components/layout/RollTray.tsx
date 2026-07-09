import { useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { parseInventoryDieDragPayload } from '../../lib/inventoryDrag'
import type { DiceShape } from '../../types/diceShape'

export interface RollTrayDie {
  id: string
  type: DiceShape
  inventoryDieId?: string
  displayName?: string
  setId?: string
  rarity?: string
  ownerName?: string
}

interface RollTrayProps {
  dice: RollTrayDie[]
  isVisible: boolean
  onAddGenericDie: (type: DiceShape) => void
  onAddSpecificDie: (type: DiceShape, inventoryDieId: string) => void
  onRemoveDie: (id: string) => void
  onClearAll: () => void
  onOpenInventory: () => void
}

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

export function RollTray({
  dice,
  isVisible,
  onAddGenericDie,
  onAddSpecificDie,
  onRemoveDie,
  onClearAll,
  onOpenInventory,
}: RollTrayProps) {
  const { currentTheme } = useTheme()
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [isDropActive, setIsDropActive] = useState(false)

  useEffect(() => {
    setOrderedIds((currentOrder) => {
      const liveIds = new Set(dice.map(die => die.id))
      const preserved = currentOrder.filter(id => liveIds.has(id))
      const added = dice.map(die => die.id).filter(id => !preserved.includes(id))
      return [...preserved, ...added]
    })
  }, [dice])

  const orderedDice = useMemo(() => {
    const diceById = new Map(dice.map(die => [die.id, die]))
    return orderedIds
      .map(id => diceById.get(id))
      .filter((die): die is RollTrayDie => Boolean(die))
  }, [dice, orderedIds])

  const rollExpression = useMemo(() => formatRollExpression(orderedDice), [orderedDice])
  const hasDice = orderedDice.length > 0

  const moveDie = (id: string, offset: -1 | 1) => {
    setOrderedIds((currentOrder) => {
      const index = currentOrder.indexOf(id)
      const nextIndex = index + offset
      if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) {
        return currentOrder
      }

      const nextOrder = [...currentOrder]
      const [movedId] = nextOrder.splice(index, 1)
      nextOrder.splice(nextIndex, 0, movedId)
      return nextOrder
    })
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDropActive(false)

    const payload = parseInventoryDieDragPayload(event.dataTransfer)
    if (!payload) return

    onAddSpecificDie(payload.type, payload.inventoryDieId)
  }

  return (
    <aside
      className="fixed left-3 right-3 z-[55] md:left-1/2 md:right-auto md:w-[min(760px,calc(100vw-2rem))] md:-translate-x-1/2"
      style={{
        bottom: '92px',
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
      aria-label="Roll tray"
    >
      <div
        className="rounded-lg p-3 shadow-lg"
        style={{
          backgroundColor: 'rgba(31, 41, 55, 0.86)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${isDropActive ? currentTheme.tokens.colors.accent : 'rgba(251, 146, 60, 0.24)'}`,
          color: currentTheme.tokens.colors.text.primary,
        }}
        onDragEnter={() => setIsDropActive(true)}
        onDragLeave={() => setIsDropActive(false)}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={handleDrop}
        data-testid="roll-tray-drop-zone"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Roll Tray</h2>
              <span
                className="rounded px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: currentTheme.tokens.colors.text.secondary,
                }}
              >
                {orderedDice.length}
              </span>
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: currentTheme.tokens.colors.text.secondary }}>
              {rollExpression}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-1.5">
            {DICE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => onAddGenericDie(type)}
                className="h-8 rounded-md px-2 text-xs font-semibold"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: currentTheme.tokens.colors.text.primary,
                  border: `1px solid ${currentTheme.tokens.colors.text.muted}`,
                }}
                aria-label={`Add generic ${type.toUpperCase()} to tray`}
              >
                +{type.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={onOpenInventory}
              className="h-8 rounded-md px-3 text-xs font-semibold"
              style={{
                backgroundColor: currentTheme.tokens.colors.accent,
                color: currentTheme.tokens.colors.text.primary,
              }}
            >
              Inventory
            </button>
          </div>
        </div>

        {hasDice ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Selected dice">
            {orderedDice.map((die, index) => {
              const label = getTrayDieLabel(die)
              return (
                <article
                  key={die.id}
                  className="min-h-[112px] w-[140px] shrink-0 rounded-md p-2"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.22)',
                    border: `1px solid ${die.inventoryDieId ? currentTheme.tokens.colors.accent : 'rgba(255, 255, 255, 0.18)'}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{label}</div>
                      <div className="mt-0.5 text-xs" style={{ color: currentTheme.tokens.colors.text.secondary }}>
                        {die.inventoryDieId ? 'Owned die' : 'Generic die'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveDie(die.id)}
                      className="h-7 w-7 rounded text-sm font-bold"
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.18)',
                        color: '#fecaca',
                      }}
                      aria-label={`Remove ${label}`}
                    >
                      x
                    </button>
                  </div>

                  <div className="mt-2 text-xs" style={{ color: currentTheme.tokens.colors.text.muted }}>
                    {die.type.toUpperCase()}
                    {die.rarity ? ` · ${die.rarity}` : ''}
                    {die.ownerName ? ` · ${die.ownerName}` : ''}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => moveDie(die.id, -1)}
                      disabled={index === 0}
                      className="h-7 rounded text-xs font-semibold disabled:opacity-40"
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: currentTheme.tokens.colors.text.primary,
                      }}
                      aria-label={`Move ${label} left`}
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDie(die.id, 1)}
                      disabled={index === orderedDice.length - 1}
                      className="h-7 rounded text-xs font-semibold disabled:opacity-40"
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: currentTheme.tokens.colors.text.primary,
                      }}
                      aria-label={`Move ${label} right`}
                    >
                      Right
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div
            className="mt-3 rounded-md px-3 py-4 text-center text-sm"
            style={{
              backgroundColor: isDropActive ? 'rgba(251, 146, 60, 0.18)' : 'rgba(0, 0, 0, 0.18)',
              color: currentTheme.tokens.colors.text.secondary,
              border: `1px dashed ${isDropActive ? currentTheme.tokens.colors.accent : currentTheme.tokens.colors.text.muted}`,
            }}
          >
            Roll tray is empty
          </div>
        )}

        {hasDice && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onClearAll}
              className="h-8 rounded-md px-3 text-xs font-semibold"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.16)',
                color: '#fecaca',
                border: '1px solid rgba(239, 68, 68, 0.35)',
              }}
            >
              Clear Tray
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

function getTrayDieLabel(die: RollTrayDie) {
  return die.inventoryDieId ? die.displayName ?? die.type.toUpperCase() : die.type.toUpperCase()
}

function formatRollExpression(dice: RollTrayDie[]) {
  if (dice.length === 0) return 'No dice selected'

  const genericCounts = new Map<DiceShape, number>()
  const specificLabels: string[] = []

  for (const die of dice) {
    if (die.inventoryDieId) {
      specificLabels.push(die.displayName ?? die.type.toUpperCase())
    } else {
      genericCounts.set(die.type, (genericCounts.get(die.type) ?? 0) + 1)
    }
  }

  const genericLabels = Array.from(genericCounts.entries())
    .sort((a, b) => DICE_TYPES.indexOf(a[0]) - DICE_TYPES.indexOf(b[0]))
    .map(([type, count]) => `${count}${type}`)

  return [...genericLabels, ...specificLabels].join(' + ')
}
