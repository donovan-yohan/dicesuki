import type { Creature } from '../types'
export function validatePfSource(c: Creature, data: unknown): void {
  const raw = data as { _id?: string; name?: string; type?: string; system?: { details?: { publication?: { license?: string; remaster?: boolean; title?: string } } }; items?: unknown[] }
  const publication = raw?.system?.details?.publication
  if (!raw || raw._id !== c.source.sourceId || raw.name !== c.name || raw.type !== 'npc' || publication?.license !== 'ORC' || !publication.remaster || publication.title !== c.source.publication || !Array.isArray(raw.items)) throw new Error('Source changed or invalid PF2e identity/edition/license')
  if (!c.source.url.startsWith(`https://raw.githubusercontent.com/foundryvtt/pf2e/${c.source.revision}/packs/`)) throw new Error('Invalid PF2e source revision')
}
