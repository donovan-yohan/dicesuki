import { describe, expect, it } from 'vitest'
import { creatureNotes, creatureText } from './creatureCopy'
import legacyPriest from '../../test/fixtures/legacyPriestKit.json'
import { validateKit } from '../rollLibrary'

describe('v1 presentation compatibility', () => {
  it('keeps the real legacy Priest source mechanics and all saved bytes', () => {
    const before = JSON.stringify(legacyPriest)
    const kit = validateKit(legacyPriest)
    const notes = creatureNotes(kit.notes).join('\n')
    expect(notes).not.toMatch(/informational only|not automated|resolve manually|normal damage only/i)
    expect(notes).toContain('As a bonus action, the priest can expend a spell slot')
    expect(notes).toContain('extra 10 (3d6) radiant damage')
    expect(notes).toContain('This benefit lasts until the end of the turn.')
    expect(notes).toContain('extra damage increases by 1d6 for each level above 1st')
    expect(notes).toContain('spell save DC 13, +5 to hit with spell attacks')
    expect(notes).toContain('3rd level (2 slots): dispel magic, spirit guardians')
    expect(JSON.stringify(legacyPriest)).toBe(before)
  })
  it('retains recharge, conditions, damage constants, effect names and conditional bonuses', () => {
    expect(creatureText('Web: Target is restrained. Recharge 5–6; resolve manually.')).toBe('Web: Target is restrained. Recharge 5–6.')
    expect(creatureText('Constrict · requires a grabbed creature; resolve requirements/basic save manually.')).toBe('Constrict · requires a grabbed creature.')
    expect(creatureText('Acid · splash: 1 (no dice; resolve manually)')).toBe('Acid · splash: 1')
    expect(creatureText('Strike · reach-10. Traits/resources resolve manually; normal damage only. Effects: grab; resolve manually.')).toContain('Effects: grab.')
    expect(creatureText('+1 circumstance bonus on saves versus poisons only; not included in ordinary own-save rolls. Apply manually when appropriate. Persistent acid rolls are manual; no automatic recurrence or splash adjudication.')).toBe('+1 circumstance bonus on saves versus poisons only')
    expect(creatureText('Target: Fortitude save DC 18 · venom stages/conditions resolve manually')).toBe('Target: Fortitude save DC 18 · venom stages/conditions')
  })
  it('does not strip source prose by generic keywords or mutate input arrays', () => {
    const source = ['Consult the manual. Resolve the DC 13 save after taking 3d6 radiant damage.', 'The target is restrained until it escapes.']
    expect(creatureNotes(source)).toEqual(source)
    expect(source).toHaveLength(2)
  })
})
