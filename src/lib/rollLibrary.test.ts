import { describe, it, expect } from 'vitest'
import { catalog } from './monsterManual/catalog'
import { buildCreatureKit, validateKit, validateKitRoll } from './rollLibrary'

describe('complete saved creature snapshots', () => {
  it('derives every supported card and variants for all eight sources', () => {
    const totals = { '5e': [9, 8, 10, 12], pf2e: [9, 9, 8, 7] }
    for (const system of ['5e', 'pf2e'] as const) {
      const creatures = catalog.filter(c => c.system === system && c.source.sourceId !== 'JFmFuoOzCwc3hA1H')
      expect(creatures.map(c => buildCreatureKit(c).cards.length)).toEqual(totals[system])
      for (const c of creatures) {
        const kit = buildCreatureKit(c)
        expect(validateKit(JSON.parse(JSON.stringify(kit)))).toEqual(kit)
        expect(kit.provenance.source).toEqual(c.source)
        expect(kit.cards.filter(x => x.role === 'own-save').length).toBe(system === '5e' ? 6 : 3)
        for (const card of kit.cards) {
          expect(card.variants.length).toBe(card.role === 'attack' || (card.role === 'own-save' && system === '5e') ? 3 : 1)
          for (const v of card.variants) expect(v.roll.dice[0].perDieBonus).toBe(0)
        }
      }
    }
  })
  it('retains exact save oracles, MAP, mixed damage, constants and DC notes', () => {
    const five = catalog.filter(c => c.system === '5e').map(buildCreatureKit)
    expect(five.map(k => k.cards.filter(c => c.role === 'own-save').map(c => c.variants[0].roll.flatBonus))).toEqual([[1,1,1,0,0,0],[0,0,1,1,3,1],[2,3,1,-4,0,-3],[6,4,9,2,4,8]])
    const guard = buildCreatureKit(catalog.find(c => c.system === 'pf2e' && c.name === 'Guard')!)
    const agile = guard.cards.find(c => c.role === 'attack' && /fist/i.test(c.label))!
    expect(agile.variants.map(v => v.roll.flatBonus)).toEqual([7,3,-1])
    const apothecary = buildCreatureKit(catalog.find(c => c.name === 'Apothecary')!)
    expect(apothecary.constants).toHaveLength(2)
    expect(apothecary.cards.some(c => c.label.includes('persistent'))).toBe(true)
    expect(five[3].cards.filter(c => c.role === 'damage').map(c => c.label).join(' ')).toMatch(/fire/)
    expect(five[2].notes.join(' ')).toMatch(/DC/)
  })
  it('rejects executable extensions, unsafe URLs and out-of-bounds or malformed persisted templates', () => {
    const kit = buildCreatureKit(catalog[0])
    for (const mutate of [
      (k: typeof kit) => { k.cards[0].variants[0].roll.dice[0].quantity = 31 },
      (k: typeof kit) => { k.provenance.source.url = 'javascript:alert(1)' },
      (k: typeof kit) => { k.cards[0].variants[0].roll.dice[0].exploding = { on: 'max' } },
      (k: typeof kit) => { k.cards[0].variants[0].roll.flatBonus = NaN },
      (k: typeof kit) => { k.cards[0].variants[0].roll.dice[0].perDieBonus = 4 },
    ]) { const changed = structuredClone(kit); mutate(changed); expect(() => validateKit(changed)).toThrow() }
  })
})

describe('strict persisted enums',()=>{
 it.each([['attack'],['damage'],['own-save'],{toString:()=> 'attack'},null,7,true].map(value=>({value})))('rejects non-string role $value',({value})=>{
  const kit=JSON.parse(JSON.stringify(buildCreatureKit(catalog[0])));kit.cards[0].role=value;expect(()=>validateKit(kit)).toThrow()
 })
 it('rejects a coercible keep-mode array before returning a typed template',()=>{
  const kit=buildCreatureKit(catalog.find(c=>c.system==='5e')!);const roll=JSON.parse(JSON.stringify(kit.cards[0].variants[1].roll));roll.dice[0].keepMode=['highest'];expect(()=>validateKitRoll(roll)).toThrow()
 })
})

it('new kits contain mechanics without app-added support boilerplate',()=>{
 for(const c of catalog){
  const kit=buildCreatureKit(c)
  expect([...kit.notes,...kit.constants,...kit.cards.map(c=>c.target??'')].join(' ')).not.toMatch(/informational only|not automated|resolve manually|resolve requirements|normal damage only|automation.*unsupported|not included in ordinary/i)
 }
 const priest=buildCreatureKit(catalog.find(c=>c.name==='Priest')!)
 expect(priest.notes.join(' ')).toContain('extra damage increases by 1d6 for each level above 1st')
 expect(priest.notes.join(' ')).toContain('3rd level (2 slots): dispel magic, spirit guardians')
})
