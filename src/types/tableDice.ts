import type { DiceShape } from './diceShape'

export interface TableDieSummary {
  id: string
  type: DiceShape
  inventoryDieId?: string
  displayName?: string
  setId?: string
  rarity?: string
  ownerName?: string
}
