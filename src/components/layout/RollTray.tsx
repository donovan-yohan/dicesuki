import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

import { useTheme } from '../../contexts/ThemeContext'
import { parseInventoryDieDragPayload } from '../../lib/inventoryDrag'
import { ROLL_TRAY_DIE_DRAG_TYPE, serializeRollTrayDieDragPayload } from '../../lib/rollTrayDrag'
import { useDragStore } from '../../store/useDragStore'
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
  onAddSpecificDie: (type: DiceShape, inventoryDieId: string) => void
  onRemoveDie: (id: string) => void
  onInspectDie?: (inventoryDieId: string) => void
}

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

export function RollTray({
  dice,
  isVisible,
  onAddSpecificDie,
  onRemoveDie,
  onInspectDie,
}: RollTrayProps) {
  const { currentTheme } = useTheme()
  const setDraggedDiceId = useDragStore((state) => state.setDraggedDiceId)
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

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDropActive(false)

    const payload = parseInventoryDieDragPayload(event.dataTransfer)
    if (!payload) return

    onAddSpecificDie(payload.type, payload.inventoryDieId)
  }

  const startTrayDieDrag = (event: DragEvent<HTMLElement>, die: RollTrayDie) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', die.id)
    event.dataTransfer.setData(ROLL_TRAY_DIE_DRAG_TYPE, serializeRollTrayDieDragPayload(die.id))
    setDraggedDiceId(die.id)
  }

  const finishTrayDieDrag = () => {
    setDraggedDiceId(null)
  }

  const handleTrayDieKeyDown = (event: KeyboardEvent<HTMLElement>, die: RollTrayDie) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onRemoveDie(die.id)
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && die.inventoryDieId && onInspectDie) {
      event.preventDefault()
      onInspectDie(die.inventoryDieId)
    }
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
        <div className="flex items-center justify-between gap-3">
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
        </div>

        {hasDice ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Selected dice">
            {orderedDice.map((die) => {
              const label = getTrayDieLabel(die)
              const canInspect = Boolean(die.inventoryDieId && onInspectDie)

              return (
                <article
                  key={die.id}
                  tabIndex={0}
                  draggable
                  onDragStart={(event) => startTrayDieDrag(event, die)}
                  onDragEnd={finishTrayDieDrag}
                  onClick={() => {
                    if (die.inventoryDieId && onInspectDie) {
                      onInspectDie(die.inventoryDieId)
                    }
                  }}
                  onKeyDown={(event) => handleTrayDieKeyDown(event, die)}
                  className="min-h-[88px] w-[132px] shrink-0 rounded-md p-2 outline-none transition-colors focus:ring-2"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.22)',
                    border: `1px solid ${die.inventoryDieId ? currentTheme.tokens.colors.accent : 'rgba(255, 255, 255, 0.18)'}`,
                    cursor: canInspect ? 'pointer' : 'grab',
                  }}
                  aria-label={`${label} tray die`}
                  data-testid="roll-tray-die"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{label}</div>
                    <div className="mt-0.5 text-xs" style={{ color: currentTheme.tokens.colors.text.secondary }}>
                      {die.inventoryDieId ? 'Owned die' : 'Generic die'}
                    </div>
                  </div>

                  <div className="mt-3 text-xs" style={{ color: currentTheme.tokens.colors.text.muted }}>
                    {die.type.toUpperCase()}
                    {die.rarity ? ` · ${die.rarity}` : ''}
                    {die.ownerName ? ` · ${die.ownerName}` : ''}
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
