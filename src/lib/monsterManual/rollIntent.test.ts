import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { compileIntent, parseRecipe } from './rollIntent'
import registry from '../../../scripts/monster-manual/registry.json'

const creature = (system: string, name: string) => catalog.find(c => c.system === system && c.name === name)!

describe('source-backed monster intents', () => {
  it('retains the original eight and adds one pinned PF caster with unique identities', () => {
    expect(catalog).toHaveLength(9)
    expect(new Set(catalog.map(c => c.id)).size).toBe(9)
    for (const system of ['5e', 'pf2e']) {
      for (const kind of ['npc', 'monster']) expect(catalog.filter(c => c.system === system && c.kind === kind && c.source.sourceId !== 'JFmFuoOzCwc3hA1H')).toHaveLength(2)
    }
    for (const c of catalog) {
      expect(c.source.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(c.source.url).toMatch(/^https:\/\//)
      expect(c.id).toContain(c.source.revision)
      const original = registry.find(r => r.id === c.id)!
      expect(c.source).toMatchObject({ url: original.url, sha256: original.sha256, sourceId: original.sourceId, revision: original.version })
      expect(c.actions.every(a => a.pointer.startsWith('/'))).toBe(true)
      expect(c.saves.every(s => s.pointer.startsWith('/'))).toBe(true)
    }
  })
  it('keeps guard alternative damage exclusive', () => {
    const c = creature('5e', 'Guard')
    const a = c.actions[0]
    expect(compileIntent(c, { role: 'damage', actionId: a.id, componentId: a.damage[0].id }).dice[0].type).toBe('d6')
    const twoHands = compileIntent(c, { role: 'damage', actionId: a.id, componentId: a.damage[1].id })
    expect(twoHands.dice).toHaveLength(1)
    expect(twoHands.dice[0].type).toBe('d8')
    expect(twoHands.flatBonus).toBe(1)
  })
  it('applies 5e advantage bonus once with native keep semantics', () => {
    const c = creature('5e', 'Young Red Dragon')
    const a = c.actions.find(a => a.name === 'Bite')!
    const roll = compileIntent(c, { role: 'attack', actionId: a.id, mode: 'advantage' })
    expect(roll.flatBonus).toBe(10)
    expect(roll.dice[0]).toMatchObject({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'highest', perDieBonus: 0 })
    expect(a.damage.map(d => d.type)).toEqual(['piercing', 'fire'])
  })
  it('keeps breath DC informational and own Dexterity save +4', () => {
    const c = creature('5e', 'Young Red Dragon')
    const breath = c.actions.find(a => a.name === 'Fire Breath')!
    expect(breath.target).toContain('DC 17')
    expect(compileIntent(c, { role: 'damage', actionId: breath.id, componentId: breath.damage[0].id }).dice[0].quantity).toBe(16)
    expect(compileIntent(c, { role: 'own-save', saveId: 'dex' }).flatBonus).toBe(4)
    expect(() => compileIntent(c, { role: 'attack', actionId: breath.id })).toThrow()
  })
  it('uses Priest own Wisdom +3 instead of spell DC 13', () => {
    expect(compileIntent(creature('5e', 'Priest'), { role: 'own-save', saveId: 'wis' }).flatBonus).toBe(3)
  })
  it('retains spider conditional poison and Strength check', () => {
    const c = creature('5e', 'Giant Spider')
    expect(c.actions[0].damage[1]).toMatchObject({ timing: 'conditional', type: 'poison', recipe: { count: 2, sides: 8, bonus: 0 } })
    expect(c.actions[1].target).toContain('Strength check DC 12')
    expect(c.actions[1].damage).toHaveLength(0)
  })
  it('applies PF agile and ordinary MAP per selected strike', () => {
    const c = creature('pf2e', 'Giant Scorpion')
    const pincer = c.actions.find(a => a.name === 'Pincer')!
    const stinger = c.actions.find(a => a.name === 'Stinger')!
    expect([1, 2, 3].map(ordinal => compileIntent(c, { role: 'attack', actionId: pincer.id, ordinal }).flatBonus)).toEqual([11, 7, 3])
    expect([1, 2, 3].map(ordinal => compileIntent(c, { role: 'attack', actionId: stinger.id, ordinal }).flatBonus)).toEqual([11, 6, 1])
    expect(compileIntent(c, { role: 'own-save', saveId: 'fortitude' }).flatBonus).toBe(12)
  })
  it('keeps persistent and constant acid separate without fake constant dice', () => {
    const c = creature('pf2e', 'Apothecary')
    const a = c.actions.find(a => a.name === 'Acid Flask')!
    expect(a.damage.map(d => d.timing)).toEqual(['immediate', 'persistent', 'splash'])
    expect(() => compileIntent(c, { role: 'damage', actionId: a.id, componentId: a.damage[0].id })).toThrow()
    expect(compileIntent(c, { role: 'damage', actionId: a.id, componentId: a.damage[1].id }).dice[0].type).toBe('d6')
  })
  it('rejects unknown IDs, cross-system options and unsupported multiattack', () => {
    const c = creature('5e', 'Young Red Dragon')
    expect(() => compileIntent(c, { role: 'attack', actionId: 'missing' })).toThrow()
    expect(() => compileIntent(c, { role: 'attack', actionId: c.actions[0].id })).toThrow()
    expect(() => compileIntent(c, { role: 'own-save', saveId: 'dex', ordinal: 2 })).toThrow()
    expect(() => compileIntent(creature('pf2e', 'Guard'), { role: 'own-save', saveId: 'will', mode: 'advantage' })).toThrow()
  })
  it('parses bounded whole dice recipes and rejects executable/oversized formulas', () => {
    expect(parseRecipe('2d10 + 6')).toEqual({ count: 2, sides: 10, bonus: 6 })
    expect(parseRecipe('1')).toEqual({ count: 0, sides: 6, bonus: 1 })
    for (const value of ['31d6', '1d100', '1d6;alert(1)', '@Damage[1d6]', '0d6', '1d6+Infinity', '1d6+2d8']) expect(() => parseRecipe(value)).toThrow()
  })
})
