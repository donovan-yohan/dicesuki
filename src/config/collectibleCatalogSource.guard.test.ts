/**
 * Authoring guards for `collectibleCatalogSource.json`.
 *
 * The catalog generator and `check:collectible-catalog` prove the *shape* of an
 * authored set: valid enums, unique keys, canonical ordering. They cannot prove
 * that a set is *legible*, that its declared PBR is what the renderer will
 * actually apply, or that its `vfx` ids refer to anything. Those are content
 * rules, and every one below is a rule the Dice Content Wave 1 concept document
 * (docs/exec-plans/active/2026-08-03-dice-content-wave-1.md) derived from
 * verified engine behavior. This file is where a future set that breaks one of
 * them fails.
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../themes/contrast'
import { resolveDiceMaterial } from '../lib/diceMaterial'
import catalogSource from './collectibleCatalogSource.json'

interface AuthoredAppearance {
  baseColor: string
  accentColor: string
  material: string
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
}

interface AuthoredVariant {
  appearance: AuthoredAppearance
  vfx: Record<string, string>
}

interface AuthoredSet {
  id: string
  name: string
  theme: { colorPalette: string[]; materialType: string; visualStyle: string }
  rarityVariants: Record<string, AuthoredVariant>
  setBonus?: unknown
}

const sets = catalogSource.configuredSets as unknown as AuthoredSet[]

/**
 * Sets published before the wave-1 authoring rules existed. Their appearance is
 * frozen catalog history (a repaint would need a new contract version), so they
 * are exempted by id rather than by weakening the rule. Nothing may be added
 * here: a new set that cannot meet the rule is a set that needs a different
 * colour or a baked texture.
 */
const PRE_RULE_SETS = new Set([
  'adventurer-starter',
  'lucky-bronze',
  'dragon-jade',
  'celestial-gold',
  'void-crystal',
  'infernal-obsidian',
])

/**
 * The complete vfx vocabulary in use. Every field is inert today — there is no
 * particle system, trail renderer, critical-animation registry, or sound router
 * reading them — so a novel id is dead weight that promises an effect the
 * engine will not deliver and grows the surface a future VFX slice must
 * implement. Extend this only in the slice that implements the effect.
 */
const VFX_VOCABULARY: Record<string, Set<string>> = {
  trailEffect: new Set([
    'sparkles',
    'dragon-scales',
    'golden-sparkles',
    'void-particles',
    'flame-trail',
  ]),
  impactEffect: new Set([
    'jade-shatter',
    'light-burst',
    'reality-crack',
    'infernal-explosion',
  ]),
  rollSound: new Set([
    'metal_light',
    'stone_mystical',
    'metal_divine',
    'crystal_ethereal',
    'obsidian_demonic',
  ]),
  criticalAnimation: new Set([
    'dragon-roar',
    'celestial-beam',
    'void-collapse',
    'hellfire-eruption',
  ]),
}

function variants(set: AuthoredSet) {
  return Object.entries(set.rarityVariants).map(([rarity, variant]) => ({
    label: `${set.id}/${rarity}`,
    ...variant,
  }))
}

const currentSets = sets.filter(set => !PRE_RULE_SETS.has(set.id))

describe('configured collectible set authoring rules', () => {
  it('freezes the exemption list, so a new set cannot opt itself out', () => {
    // The two strongest rules below run over `currentSets`, i.e. everything not
    // exempted. Without this assertion the whole file is bypassable by adding
    // one id to PRE_RULE_SETS — including the roster check, which is derived
    // from the same filter and so cannot notice. Pinning the list turns that
    // bypass into a failing test a reviewer has to look at.
    expect([...PRE_RULE_SETS].sort()).toEqual([
      'adventurer-starter',
      'celestial-gold',
      'dragon-jade',
      'infernal-obsidian',
      'lucky-bronze',
      'void-crystal',
    ])
  })

  it('covers the wave-1 roster, so the rules below are not vacuously true', () => {
    expect(currentSets.map(set => set.id).sort()).toEqual([
      'abyssal-glass',
      'amberfall',
      'ashvow',
      'bogwood-reliquary',
      'stormglass',
      'ten-thousand-folds',
      'verdigris-vigil',
    ])
  })

  it('keeps every base colour legible under the hardcoded white numerals', () => {
    // Collectible faces draw bold white numerals (EMBOSSED_GLYPH_STYLE); the
    // authored accentColor reaches no renderer. A pale body is therefore
    // unreadable no matter what accent it declares, which is why pale premium
    // materials (moonstone, ivory, howlite) cannot ship procedurally at all.
    const measured = currentSets.flatMap(set =>
      variants(set).map(variant => [
        variant.label,
        Number(contrastRatio(variant.appearance.baseColor, '#ffffff').toFixed(2)),
      ] as const),
    )

    for (const [label, ratio] of measured) {
      expect.soft(ratio, `${label} baseColor vs #ffffff`).toBeGreaterThanOrEqual(4.5)
    }
    expect(measured.length).toBe(7)
  })

  it('declares the PBR the renderer will actually apply', () => {
    // resolveDiceMaterial derives roughness/metalness from the material string
    // alone and the tray passes the resolved values, never the authored ones.
    // Authoring anything else renders identically and misleads the next author.
    for (const set of currentSets) {
      for (const variant of variants(set)) {
        const resolved = resolveDiceMaterial('d6', variant.appearance.material)
        expect(
          {
            roughness: variant.appearance.roughness,
            metalness: variant.appearance.metalness,
          },
          `${variant.label} authored PBR`,
        ).toEqual({ roughness: resolved.roughness, metalness: resolved.metalness })
      }
    }
  })

  it('spends only vfx ids that already exist, across every published set', () => {
    for (const set of sets) {
      for (const variant of variants(set)) {
        for (const [field, value] of Object.entries(variant.vfx)) {
          const vocabulary = VFX_VOCABULARY[field]
          expect(vocabulary, `${variant.label} declares unknown vfx field ${field}`)
            .toBeDefined()
          expect([...(vocabulary ?? [])], `${variant.label}.${field}`).toContain(value)
        }
      }
    }
  })

  it('keeps a set body in the material its theme claims', () => {
    for (const set of sets) {
      for (const variant of variants(set)) {
        expect(variant.appearance.material, `${variant.label} material`)
          .toBe(set.theme.materialType)
      }
    }
  })

  it('declares no new set-completion bonus', () => {
    // DieSet.setBonus is the shape Japan's Consumer Affairs Agency prohibited as
    // kompu gacha in 2012: collect N distinct randomly-obtained items to unlock
    // a further prize. The one legacy declaration is inert (zero consumers).
    // Wiring set completion up at all needs a non-gacha path to the reward and a
    // PO decision first, so no new set may declare one.
    expect(sets.filter(set => set.setBonus !== undefined).map(set => set.id))
      .toEqual(['infernal-obsidian'])
  })
})
