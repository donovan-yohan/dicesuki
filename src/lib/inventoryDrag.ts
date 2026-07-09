import type { DiceShape } from '../types/diceShape'

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

function isDiceShape(value: unknown): value is DiceShape {
  return value === 'd4' ||
    value === 'd6' ||
    value === 'd8' ||
    value === 'd10' ||
    value === 'd12' ||
    value === 'd20'
}
