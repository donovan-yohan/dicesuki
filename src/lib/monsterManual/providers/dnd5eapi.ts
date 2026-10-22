import type { Creature } from '../types'
export function validateFiveESource(c: Creature, data: unknown): void {
  const raw = data as { index?: string; name?: string; url?: string; actions?: unknown[] }
  if (!raw || raw.index !== c.source.sourceId || raw.name !== c.name || raw.url !== `/api/2014/monsters/${c.source.sourceId}` || !Array.isArray(raw.actions)) throw new Error('Source changed or invalid 5e identity')
  if (new URL(c.source.url).hostname !== 'www.dnd5eapi.co' || c.source.license !== 'CC BY 4.0') throw new Error('Invalid 5e source/license')
}
