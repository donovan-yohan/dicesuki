import imported from '../../generated/monsterManual.json'
import type { Creature } from './types'

export const catalog: readonly Creature[] = imported as Creature[]
export const systemLabels = { '5e': '5e · SRD 5.1 (2014)', pf2e: 'PF2e · Remaster' } as const
export const providerLabels = { dnd5eapi: '5e SRD API', 'foundry-pf2e': 'Foundry PF2e data' } as const
