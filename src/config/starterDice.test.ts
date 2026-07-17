import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { STARTER_DICE } from './starterDice'

let migrationSql = ''

beforeAll(async () => {
  migrationSql = await readFile(resolve(
    process.cwd(),
    'supabase/migrations/0004_collectible_catalog.sql',
  ), 'utf8')
})

describe('STARTER_DICE catalog mapping', () => {
  it('preserves the existing multi-die loadout distribution', () => {
    const countByType = Object.fromEntries(
      ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].map(type => [
        type,
        STARTER_DICE.filter(die => die.type === type).length,
      ]),
    )

    expect(STARTER_DICE).toHaveLength(23)
    expect(countByType).toEqual({ d4: 6, d6: 6, d8: 4, d10: 2, d12: 2, d20: 3 })
    expect(STARTER_DICE.filter(die => die.name.startsWith('Devil d6'))).toHaveLength(6)
  })

  it('gives every bundled/configured starter a descriptive catalog ref', () => {
    expect(STARTER_DICE.every(die => die.catalogRef)).toBe(true)
    expect(new Set(
      STARTER_DICE.filter(die => die.name.startsWith('Devil d6'))
        .map(die => die.catalogRef?.itemId),
    )).toEqual(new Set(['devil-set/devil-d6@1']))
  })

  it('uses bundled storage only for production GLTF assets', () => {
    const devilDice = STARTER_DICE.filter(die => die.name.startsWith('Devil d6'))
    expect(devilDice.every(die => die.customAsset?.storage === 'bundled')).toBe(true)
    expect(STARTER_DICE.filter(die => !die.name.startsWith('Devil d6'))
      .every(die => !die.customAsset)).toBe(true)
  })

  it('backs 23 local instances with the server-fixed 8-item ownership allowlist', () => {
    const localOwnedItemIds = new Set(STARTER_DICE.map(die => die.catalogRef!.itemId))

    const rpc = migrationSql.match(
      /create or replace function public\.ensure_starter_entitlements\(\)[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    const serverOwnedItemIds = new Set(
      [...rpc.matchAll(/\('([^']+@1)'\)/g)].map(match => match[1]),
    )

    expect(STARTER_DICE).toHaveLength(23)
    expect(localOwnedItemIds.size).toBe(8)
    expect([...serverOwnedItemIds].sort()).toEqual([...localOwnedItemIds].sort())
  })
})
