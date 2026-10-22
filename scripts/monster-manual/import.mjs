// Only reviewed allowlisted revisions may enter the imported mechanical catalog.
// Run: node scripts/monster-manual/import.mjs --online
// Or:  node scripts/monster-manual/import.mjs --evidence <Tako source-evidence directory>
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const registry = JSON.parse(await readFile(new URL('./registry.json', import.meta.url), 'utf8'))
const evidenceIndex = process.argv.indexOf('--evidence')
if (!process.argv.includes('--online') && evidenceIndex < 0) throw new Error('Choose --online or --evidence directory')
function recipe(value) {
  const match = /^(\d+)d(4|6|8|10|12|20)(?:\s*([+-])\s*(\d+))?$/.exec(value.trim())
  if (!match) {
    if (/^\d{1,3}$/.test(value)) return { count: 0, sides: 6, bonus: Number(value) }
    throw new Error(`Unsupported dice recipe: ${value}`)
  }
  const count = Number(match[1]), bonus = Number(match[4] ?? 0) * (match[3] === '-' ? -1 : 1)
  if (count < 1 || count > 30 || Math.abs(bonus) > 100) throw new Error('Recipe outside physical bounds')
  return { count, sides: Number(match[2]), bonus }
}
const abilities = [['str','Strength','strength'],['dex','Dexterity','dexterity'],['con','Constitution','constitution'],['int','Intelligence','intelligence'],['wis','Wisdom','wisdom'],['cha','Charisma','charisma']]
const records = []
for (const row of registry) {
  const bytes = evidenceIndex >= 0
    ? await readFile(resolve(process.argv[evidenceIndex + 1], row.evidenceFile))
    : Buffer.from(await (async () => {
      const response = await fetch(row.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${row.url}`)
      return response.arrayBuffer()
    })())
  if (bytes.length > 262144 || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Unreviewed source revision: ${row.name}`)
  const raw = JSON.parse(bytes.toString('utf8'))
  const is5e = row.system === '5e'
  if ((is5e ? raw.index : raw._id) !== row.sourceId || raw.name !== row.name) throw new Error('Source identity mismatch')
  if (!is5e && (raw.system.details.publication.license !== 'ORC' || raw.system.details.publication.remaster !== true)) throw new Error('Wrong PF edition/license')
  const c = {
    id: row.id, key: `${row.system}:${row.edition}:${row.provider}:${row.sourceId}`,
    name: row.name, system: row.system, edition: is5e ? 'SRD 5.1 (2014)' : 'Remaster',
    provider: row.provider, kind: row.kind,
    source: { sourceId: row.sourceId, url: row.url, revision: row.version, sha256: row.sha256,
      importedAt: row.importedAt, publication: is5e ? 'System Reference Document 5.1' : raw.system.details.publication.title,
      license: is5e ? 'CC BY 4.0' : 'ORC',
      licenseUrl: is5e ? 'https://creativecommons.org/licenses/by/4.0/' : '/licenses/monster-manual/ORC_License_FINAL.pdf',
      noticeUrl: is5e ? '/licenses/monster-manual/5e-attribution.txt' : '/licenses/monster-manual/pf2e-attribution.txt' },
    actions: [], saves: [], notes: [], overrides: [],
  }
  const override = (pointer, fragment) => {
    const actual = pointer.split('/').slice(1).reduce((o, k) => o[k], raw)
    if (typeof actual !== 'string' || !actual.includes(fragment)) throw new Error(`Reviewed fragment missing: ${pointer}`)
    c.overrides.push({ pointer, fragment })
  }
  if (is5e) {
    c.saves = abilities.map(([id, name, field]) => {
      const index = raw.proficiencies.findIndex(p => p.proficiency.index === `saving-throw-${id}`)
      return { id, name, bonus: index < 0 ? Math.floor((raw[field] - 10) / 2) : raw.proficiencies[index].value,
        pointer: index < 0 ? `/${field}` : `/proficiencies/${index}/value` }
    })
    for (const [i, a] of raw.actions.entries()) {
      const pointer = `/actions/${i}`
      const action = { id: `action-${i}`, name: a.name, traits: [], damage: [], pointer, note: a.desc ?? '' }
      if (Number.isInteger(a.attack_bonus)) action.attackBonus = a.attack_bonus
      if (a.dc) action.target = `Target: ${abilities.find(x => x[0] === a.dc.dc_type.index)?.[1] ?? a.dc.dc_type.name} save DC ${a.dc.dc_value} · ${a.dc.success_type} on success`
      for (const [j, d] of (a.damage ?? []).entries()) {
        const components = d.from?.options ?? [d]
        for (const [k, part] of components.entries()) action.damage.push({
          id: `${j}-${k}`, type: part.damage_type.index, timing: 'immediate', recipe: recipe(part.damage_dice),
          ...(d.from ? { choice: part.notes === 'Two handed' ? 'Two-handed melee' : 'One-handed / thrown' } : {}),
          pointer: d.from ? `${pointer}/damage/${j}/from/options/${k}` : `${pointer}/damage/${j}`,
        })
      }
      if (row.sourceId === 'giant-spider' && i === 0) {
        override(`${pointer}/desc`, 'DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one.')
        action.damage.push({ id: 'conditional-poison', type: 'poison', timing: 'conditional', recipe: recipe('2d8'), pointer: `${pointer}/desc` })
        action.target = 'Target: Constitution save DC 11 · conditional poison; half on success'
      }
      if (row.sourceId === 'giant-spider' && i === 1) {
        override(`${pointer}/desc`, 'DC 12 Strength check')
        action.target = 'Target: Strength check DC 12 · escape web (not a save)'
      }
      if (a.usage) action.note += ` Recharge ${a.usage.min_value}–6.`
      c.actions.push(action)
    }
    for (const [i, a] of (raw.special_abilities ?? []).entries()) c.actions.push({ id: `ability-${i}`, name: a.name,
      traits: [], damage: [], pointer: `/special_abilities/${i}`, note: a.desc })
  } else {
    c.saves = Object.entries(raw.system.saves).map(([id, s]) => ({ id, name: id[0].toUpperCase() + id.slice(1), bonus: s.value, pointer: `/system/saves/${id}/value` }))
    for (const [i, a] of raw.items.entries()) {
      if (!['melee', 'action'].includes(a.type)) continue
      const pointer = `/items/${i}`
      const action = { id: a._id, name: a.name, traits: a.system.traits.value, damage: [], pointer,
        note: a.type === 'melee' ? `Strike${a.system.traits.value.length ? ` · ${a.system.traits.value.join(', ')}` : ''}.` : '' }
      if (a.type === 'melee') {
        action.attackBonus = a.system.bonus.value
        action.damage = Object.entries(a.system.damageRolls).map(([id, d]) => ({ id, type: d.damageType, timing: d.category ?? 'immediate', recipe: recipe(d.damage), pointer: `${pointer}/system/damageRolls/${id}` }))
        if (a.system.attackEffects?.value?.length) action.note += ` Effects: ${a.system.attackEffects.value.join(', ')}.`
      }
      if (row.sourceId === 'BWm17BRQYGMLqtNe' && a._id === '5PDURAzo537r6kje') {
        override(`${pointer}/system/description/value`, '@Damage[(1d6+4)[bludgeoning]], @Check[fortitude|dc:20|basic]')
        action.damage = [{ id: 'constrict', type: 'bludgeoning', timing: 'conditional', recipe: recipe('1d6+4'), pointer: `${pointer}/system/description/value` }]
        action.target = 'Target: Fortitude save DC 20 · basic save'
        action.note = 'Constrict · requires a grabbed creature.'
      }
      if (row.sourceId === 'BWm17BRQYGMLqtNe' && a._id === 'WuUxcHe2LEnb3BVQ') {
        override(`${pointer}/system/description/value`, '@Check[fortitude|dc:18]')
        action.target = 'Target: Fortitude save DC 18 · venom stages/conditions'
      }
      c.actions.push(action)
    }
    // Reviewed primary weapon strikes first; source IDs, never UI name branches.
    if (row.sourceId === 'Aktz95gNNzfAiTzk') {
      const order = ['UWagoDkGXzULZ0i4', 'G5iBcxxzOecJApLi', 'i6RGiBt0UOTBg3go']
      c.actions.sort((a, b) => (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)))
    }
    if (row.sourceId === 'h4gPulyY9uzkAbyo') c.notes.push('+1 circumstance bonus on saves versus poisons only.')
  }
  records.push(c)
  console.log(`${row.name} ${row.system}: reviewed hash/identity PASS`)
}
if (records.length !== 8 || new Set(records.map(c => c.id)).size !== 8) throw new Error('Roster identity failed')
for (const system of ['5e', 'pf2e']) for (const kind of ['npc', 'monster']) if (records.filter(c => c.system === system && c.kind === kind).length !== 2) throw new Error('Roster count failed')
await writeFile('src/generated/monsterManual.json', JSON.stringify(records, null, 2) + '\n')
console.log('Eight-entry import PASS')
