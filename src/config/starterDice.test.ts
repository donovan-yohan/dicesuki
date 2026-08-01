/**
 * Drift guard for the starter-inventory split (PO decision 2026-07-27, brief
 * `docs/exec-plans/active/2026-07-28-my-dice-rolls-rework.md` (d)).
 *
 * The two halves used to be one thing: the client seeded 23 local
 * `source: 'starter'` instances that mirrored the server's
 * `ensure_starter_entitlements` allowlist, and the old version of this file
 * asserted the two lists matched.
 *
 * They are deliberately no longer symmetric:
 *
 * - The CLIENT seeds nothing. The default inventory is empty and basic dice
 *   (`src/lib/basicDice.ts`) are the infinite playable floor.
 * - The SERVER contract is untouched. `ensure_starter_entitlements` still grants
 *   the same 8 catalog items, existing `dice_copies` rows stay valid, and
 *   migration 0021's pull-prepare path still calls it (it "may not charge for a
 *   fixed starter item the caller was already owed").
 *
 * So this file now guards BOTH sides of that asymmetry: the RPC allowlist is
 * frozen, and no client code may quietly start seeding it again.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIBLE_CATALOG } from '../lib/collectibleCatalog'
import { useInventoryStore } from '../store/useInventoryStore'
// Vite `?raw` imports hand us the exact source text, so the guard inspects what
// ships rather than a re-export. (`vite/client` types these as `string`.)
import starterDiceSrc from './starterDice.ts?raw'
import inventoryStoreSrc from '../store/useInventoryStore.ts?raw'
import sceneSrc from '../components/Scene.tsx?raw'

/**
 * The catalog items `ensure_starter_entitlements` grants, frozen. Changing this
 * list means changing what every account is owed server-side, which is a
 * migration and an economy decision — never a side effect of a client edit.
 */
const SERVER_STARTER_ITEM_IDS = [
  'adventurer-starter/d10/common@1',
  'adventurer-starter/d12/common@1',
  'adventurer-starter/d20/common@1',
  'adventurer-starter/d4/common@1',
  'adventurer-starter/d8/common@1',
  'devil-set/devil-d6@1',
  'materials-lab/rubber-d20@1',
  'materials-lab/steel-d20@1',
] as const

let migrationSql = ''

beforeAll(async () => {
  migrationSql = await readFile(resolve(
    process.cwd(),
    'supabase/migrations/0004_collectible_catalog.sql',
  ), 'utf8')
})

describe('server starter entitlements are unchanged', () => {
  it('still grants exactly the 8-item fixed allowlist', () => {
    const rpc = migrationSql.match(
      /create or replace function public\.ensure_starter_entitlements\(\)[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    expect(rpc, 'ensure_starter_entitlements must still exist').not.toBe('')

    const serverOwnedItemIds = [...rpc.matchAll(/\('([^']+@1)'\)/g)].map(match => match[1])

    expect(serverOwnedItemIds.sort()).toEqual([...SERVER_STARTER_ITEM_IDS])
  })
})

describe('the client seeds no starter inventory', () => {
  beforeEach(() => {
    localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('exports no STARTER_DICE list to seed from', () => {
    expect(starterDiceSrc).not.toMatch(/export const STARTER_DICE\s*[:=]/)
  })

  it('has no seeding action on the inventory store', () => {
    expect(inventoryStoreSrc).not.toMatch(/STARTER_DICE/)
    expect(inventoryStoreSrc).not.toMatch(/initializeStarterDice/)
    expect(sceneSrc).not.toMatch(/initializeStarterDice/)
  })

  it('leaves a fresh inventory empty, which is a valid playable state', () => {
    expect(useInventoryStore.getState().dice).toEqual([])
    expect(useInventoryStore.getState().localDice).toEqual([])
  })

  it('keeps an authenticated empty copy read empty instead of falling back', () => {
    // The retired fallback re-seeded 23 starter instances whenever the retained
    // local inventory was empty. Signed-in players with no copies must now see
    // exactly nothing, because basics cover playability.
    expect(useInventoryStore.getState().syncServerCopies({}, COLLECTIBLE_CATALOG)).toBe(true)

    expect(useInventoryStore.getState().serverCopiesActive).toBe(true)
    expect(useInventoryStore.getState().dice).toEqual([])

    useInventoryStore.getState().clearServerCopies()
    expect(useInventoryStore.getState().dice).toEqual([])
  })
})
