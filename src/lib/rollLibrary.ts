import type { SavedRoll } from '../types/savedRolls'
import type { Creature, Intent } from './monsterManual/types'
import { creatureNotes, creatureText } from './monsterManual/creatureCopy'
import { compileIntent } from './monsterManual/rollIntent'

export interface KitCard {
  id: string
  label: string
  role: Intent['role']
  target?: string
  variants: { id: string; label: string; roll: SavedRoll }[]
}
export interface CreatureKit {
  version: 1
  name: string
  provenance: Pick<Creature, 'id' | 'key' | 'system' | 'edition' | 'provider' | 'source'>
  cards: KitCard[]
  constants: string[]
  notes: string[]
}
export const LIBRARY_LIMITS = { groups: 50, instances: 50, cards: 128, name: 80, memberships: 1000, bytes: 2 * 1024 * 1024 }
export function buildCreatureKit(c: Creature): CreatureKit {
  const cards: KitCard[] = []
  const constants: string[] = []
  function add(id: string, label: string, intent: Intent, target?: string) {
    const modes = c.system === '5e' && intent.role !== 'damage' ? ['normal', 'advantage', 'disadvantage'] : []
    const variants = modes.length ? modes.map(mode => ({ id: mode, label: mode, roll: compileIntent(c, { ...intent, mode }) }))
      : c.system === 'pf2e' && intent.role === 'attack' ? [1, 2, 3].map(ordinal => ({ id: String(ordinal), label: `${ordinal === 3 ? '3rd+' : ordinal === 2 ? '2nd' : '1st'} attack`, roll: compileIntent(c, { ...intent, ordinal }) }))
        : [{ id: 'normal', label: 'Normal', roll: compileIntent(c, intent) }]
    cards.push({ id, label, role: intent.role, variants, ...(target ? {target: creatureText(target)} : {}) })
  }
  for (const a of c.actions) {
    if (a.attackBonus !== undefined) add(`attack:${a.id}`, a.name, { role: 'attack', actionId: a.id }, a.target)
    for (const d of a.damage) {
      const label = `${a.name} · ${d.type} · ${d.timing}${d.choice ? ` · ${d.choice}` : ''}`
      if (!d.recipe.count) constants.push(`${label}: ${d.recipe.bonus}`)
      else add(`damage:${a.id}:${d.id}`, label, { role: 'damage', actionId: a.id, componentId: d.id }, a.target)
    }
  }
  for (const s of c.saves) add(`save:${s.id}`, `${s.name} save`, { role: 'own-save', saveId: s.id })
  return validateKit({ version: 1, name: c.name, provenance: { id: c.id, key: c.key, system: c.system, edition: c.edition, provider: c.provider, source: { ...c.source } }, cards, constants,
    notes: creatureNotes([...c.notes, ...c.actions.flatMap(a => {
      const details = [a.target, a.note].filter((v): v is string => !!v)
      return details.length ? details.map(note => `${a.name}: ${note}`) : a.attackBonus === undefined && !a.damage.length ? [a.name] : []
    })]) })
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved kit object')
  return value as Record<string, unknown>
}
function exact(v: Record<string, unknown>, keys: string[]) {
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error('Unsupported saved kit field')
}
export function text(v: unknown, max = 500): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || Array.from(v).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) throw new Error('Invalid saved library text')
  return v
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new Error('Saved kit number outside bounds')
  return v
}
function array(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new Error('Saved kit array outside bounds')
  return v
}
function url(v: unknown, local = false): string {
  const s = text(v, 1000)
  if (local && /^\/licenses\/monster-manual\/[a-zA-Z0-9_.-]+$/.test(s)) return s
  const u = new URL(s)
  if (u.protocol !== 'https:' || u.username || u.password || !['www.dnd5eapi.co', 'raw.githubusercontent.com', 'creativecommons.org', 'paizo.com', '2e.aonprd.com', 'dnd5eapi.co'].includes(u.hostname)) throw new Error('Untrusted saved source URL')
  return s
}
/** Strict whitelist for compiled snapshot templates, never a general formula/macro parser. */
export function validateKitRoll(value: unknown): SavedRoll {
  const v = record(value)
  exact(v, ['id', 'createdAt', 'name', 'description', 'damageType', 'flatBonus', 'dice'])
  const entries = array(v.dice, 1)
  if (entries.length !== 1) throw new Error('Invalid saved kit dice')
  const d = record(entries[0]); exact(d, ['id', 'type', 'quantity', 'perDieBonus', 'rollCount', 'keepMode'])
  const type = text(d.type)
  if (!['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].includes(type)) throw new Error('Invalid saved kit die shape')
  const quantity = integer(d.quantity, 1, 30)
  if (d.perDieBonus !== 0) throw new Error('Saved kit bonuses must apply once')
  const dice: SavedRoll['dice'] = [{ id: text(d.id), type: type as SavedRoll['dice'][number]['type'], quantity, perDieBonus: 0 }]
  if (d.rollCount !== undefined) dice[0].rollCount = integer(d.rollCount, quantity, 30)
  if (d.keepMode !== undefined) {
    if (type !== 'd20' || quantity !== 1 || d.rollCount !== 2 || (typeof d.keepMode !== 'string' || !['highest', 'lowest'].includes(d.keepMode))) throw new Error('Invalid saved keep mode')
    dice[0].keepMode = d.keepMode as 'highest' | 'lowest'
  }
  if ((d.rollCount ?? quantity) !== quantity && d.keepMode === undefined) throw new Error('Missing saved keep rule')
  return { id: text(v.id), name: text(v.name), createdAt: integer(v.createdAt, 0, Number.MAX_SAFE_INTEGER), flatBonus: integer(v.flatBonus, -100, 100), dice,
    ...(v.description === undefined ? {} : { description: text(v.description, 2000) }), ...(v.damageType === undefined ? {} : { damageType: text(v.damageType) }) }
}
export function validateKit(value: unknown): CreatureKit {
  const v = record(value); exact(v, ['version','name','provenance','cards','constants','notes'])
  if (v.version !== 1) throw new Error('Unsupported saved kit version')
  const p = record(v.provenance); exact(p, ['id','key','system','edition','provider','source'])
  if (!((p.system === '5e' && p.provider === 'dnd5eapi') || (p.system === 'pf2e' && p.provider === 'foundry-pf2e'))) throw new Error('Invalid saved system/provider')
  const s = record(p.source); exact(s, ['sourceId','url','revision','sha256','importedAt','publication','license','licenseUrl','noticeUrl'])
  if (!/^[a-f0-9]{64}$/.test(String(s.sha256)) || !Number.isFinite(Date.parse(String(s.importedAt)))) throw new Error('Invalid saved source revision')
  const source: Creature['source'] = { sourceId: text(s.sourceId), url: url(s.url), revision: text(s.revision), sha256: text(s.sha256), importedAt: text(s.importedAt), publication: text(s.publication), license: text(s.license), licenseUrl: url(s.licenseUrl, true), noticeUrl: url(s.noticeUrl, true) }
  const seen = new Set<string>()
  const cards = array(v.cards, LIBRARY_LIMITS.cards).map(value => {
    const c = record(value); exact(c, ['id','label','role','variants','target'])
    const id = text(c.id); if (seen.has(id)) throw new Error('Duplicate saved card ID'); seen.add(id)
    if (typeof c.role !== 'string' || !['attack','damage','own-save'].includes(c.role)) throw new Error('Invalid saved card role')
    const variants = array(c.variants, 3).map(value => { const variant = record(value); exact(variant, ['id','label','roll']); return { id: text(variant.id), label: text(variant.label), roll: validateKitRoll(variant.roll) } })
    const expected = c.role === 'damage' || (c.role === 'own-save' && p.system === 'pf2e') ? ['normal'] : p.system === '5e' ? ['normal','advantage','disadvantage'] : ['1','2','3']
    if (variants.map(x => x.id).join('|') !== expected.join('|')) throw new Error('Invalid saved variants')
    for (const variant of variants) {
      const d = variant.roll.dice[0]
      if (c.role !== 'damage' && (d.type !== 'd20' || d.quantity !== 1)) throw new Error('Invalid saved d20 role')
      if (variant.id === 'advantage' || variant.id === 'disadvantage') {
        if (d.rollCount !== 2 || d.keepMode !== (variant.id === 'advantage' ? 'highest' : 'lowest')) throw new Error('Invalid saved advantage')
      } else if (d.keepMode || (d.rollCount !== undefined && d.rollCount !== d.quantity)) throw new Error('Invalid saved normal variant')
    }
    return { id, label: text(c.label), role: c.role as KitCard['role'], variants, ...(c.target === undefined ? {} : {target: text(c.target, 2000)}) }
  })
  if (!cards.length) throw new Error('Empty saved kit')
  return { version: 1, name: text(v.name, 80), provenance: { id: text(p.id), key: text(p.key), system: p.system as Creature['system'], edition: text(p.edition), provider: p.provider as Creature['provider'], source }, cards, constants: array(v.constants, 128).map(v => text(v, 2000)), notes: array(v.notes, 128).map(v => text(v, 8000)) }
}
