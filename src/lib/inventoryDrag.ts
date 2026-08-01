import { INVENTORY_DICE_SHAPES, type DiceShape } from '../types/diceShape'

export const INVENTORY_DIE_DRAG_TYPE = 'application/dicesuki-inventory-die'

export interface InventoryDieDragPayload {
  inventoryDieId: string
  type: DiceShape
  name: string
}

export function serializeInventoryDieDragPayload(payload: InventoryDieDragPayload) {
  return JSON.stringify(payload)
}

export function parseInventoryDieDragPayload(dataTransfer: DataTransfer): InventoryDieDragPayload | null {
  const rawPayload = dataTransfer.getData(INVENTORY_DIE_DRAG_TYPE)
  if (!rawPayload) return null

  try {
    const parsed = JSON.parse(rawPayload) as Partial<InventoryDieDragPayload>
    if (!parsed.inventoryDieId || !isDiceShape(parsed.type) || !parsed.name) {
      return null
    }
    return {
      inventoryDieId: parsed.inventoryDieId,
      type: parsed.type,
      name: parsed.name,
    }
  } catch {
    return null
  }
}

/**
 * Only OWNABLE shapes can be dragged out of the inventory. The percentile tens
 * die (`d10tens`) is an engine-only shape — it is never minted or owned — so it
 * is deliberately absent here (see `INVENTORY_DICE_SHAPES`).
 */
function isDiceShape(value: unknown): value is DiceShape {
  return typeof value === 'string'
    && (INVENTORY_DICE_SHAPES as readonly string[]).includes(value)
}
