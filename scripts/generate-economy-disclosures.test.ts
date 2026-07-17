import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildEconomyDisclosure,
  generateEconomyDisclosures,
  validateEconomyContract,
  validateNoRuntimeEconomyConsumers,
} from './generate-economy-disclosures.js'

const root = path.resolve(import.meta.dirname, '..')
const sourcePath = path.join(
  root,
  'economy/contracts/editions/0001-broad-rarity-showcase.json',
)
const catalogPath = path.join(root, 'src/generated/collectibleCatalog.json')
const temporaryDirectories: string[] = []

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function write(rootDir: string, filePath: string, value: string) {
  const target = path.join(rootDir, filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function fixtureRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-economy-'))
  temporaryDirectories.push(directory)
  write(
    directory,
    'src/generated/collectibleCatalog.json',
    fs.readFileSync(catalogPath, 'utf8'),
  )
  write(
    directory,
    'economy/contracts/editions/0001-broad-rarity-showcase.json',
    fs.readFileSync(sourcePath, 'utf8'),
  )
  return directory
}

let contract: ReturnType<typeof readJson>
let catalog: ReturnType<typeof readJson>

beforeEach(() => {
  contract = readJson(sourcePath)
  catalog = readJson(catalogPath)
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('versioned economy contract', () => {
  it('generates exact rarity, named-item, guarantee, and cadence disclosures', () => {
    expect(() => validateEconomyContract(contract, catalog, path.basename(sourcePath))).not.toThrow()
    const disclosure = buildEconomyDisclosure(
      contract,
      catalog,
      'economy/contracts/editions/0001-broad-rarity-showcase.json',
    )

    expect(disclosure.purpose).toBe('simulation-only')
    expect(disclosure.runtimeConsumption).toBe('forbidden')
    expect(disclosure.currency).toMatchObject({
      singlePullCost: 160,
      tenPullCost: 1600,
      balanceClasses: ['paid', 'promotional'],
    })
    expect(disclosure.paidRandom.rarityProbabilities.map(entry => [
      entry.rarity,
      entry.weightUnits,
      entry.probability.exact,
    ])).toEqual([
      ['common', 50, { numerator: 1, denominator: 2 }],
      ['uncommon', 28, { numerator: 7, denominator: 25 }],
      ['rare', 14, { numerator: 7, denominator: 50 }],
      ['epic', 5, { numerator: 1, denominator: 20 }],
      ['legendary', 3, { numerator: 3, denominator: 100 }],
    ])
    expect(disclosure.paidRandom.itemProbabilities).toHaveLength(45)
    expect(disclosure.paidRandom.itemProbabilities[0]).toMatchObject({
      catalogItemId: 'adventurer-starter/d10/common@1',
      probability: { exact: { numerator: 1, denominator: 24 } },
    })
    expect(disclosure.paidRandom.rareOrBetterBaseProbability.exact).toEqual({
      numerator: 11,
      denominator: 50,
    })
    expect(disclosure.paidRandom.guarantees.rareOrBetterTenPull).toMatchObject({
      windowPulls: 10,
      windowScope: 'purchased-ten-pull-batch',
      singlePullBehavior: 'does-not-advance-or-satisfy-window',
      rollingBehavior: 'does-not-carry-between-purchases',
      reset: 'after-each-purchased-ten-pull-batch',
      minimumRarity: 'rare',
      trigger: 'replace-final-pull-if-window-misses',
      replacementDistribution: 'base-weights-conditioned-on-minimum-rarity',
    })
    expect(disclosure.paidRandom.guarantees.selectedFeatured).toMatchObject({
      hardGuaranteePull: 30,
      trigger: 'replace-pull-at-counter-if-selected-not-awarded',
      lossPath: 'none',
      counterScope: 'banner-family',
      carryFamilyId: 'broad-rarity-showcase',
    })
    expect(disclosure.paidRandom.guarantees.selectedFeatured.baseProbabilities)
      .toHaveLength(6)
    expect(disclosure.paidRandom.guarantees.selectedFeatured.baseProbabilities[0])
      .toMatchObject({ probability: { exact: { numerator: 1, denominator: 200 } } })
    expect(disclosure.paidRandom.rareOrBetterReplacementProbabilities)
      .toMatchObject({
        distribution: 'base-weights-conditioned-on-minimum-rarity',
        rarityProbabilities: [
          { rarity: 'rare', probability: { exact: { numerator: 7, denominator: 11 } } },
          { rarity: 'epic', probability: { exact: { numerator: 5, denominator: 22 } } },
          { rarity: 'legendary', probability: { exact: { numerator: 3, denominator: 22 } } },
        ],
      })
    expect(disclosure.paidRandom.rareOrBetterReplacementProbabilities.itemProbabilities[0])
      .toMatchObject({ probability: { exact: { numerator: 7, denominator: 99 } } })
    expect(disclosure.paidRandom.excludedRarities).toEqual(['mythic'])
    expect(disclosure.freeCadence).toMatchObject({
      dailyBank: { capacityDays: 7, streakLoss: false },
      weeklyStarBudget: { periodDays: 7, totalAmount: 1600 },
      weeklyUnownedEvergreen: {
        intervalDays: 7,
        rewardCount: 1,
        eligibleRarities: ['common', 'uncommon'],
        whenAllOwned: 'no-item',
      },
    })
    expect(disclosure.freeCadence.weeklyUnownedEvergreen.catalogItemIds).toHaveLength(24)
    expect(disclosure.duplicateConversion.amountByRarity).toEqual({
      common: 1,
      uncommon: 3,
      rare: 8,
      epic: 20,
      legendary: 50,
      mythic: 0,
    })
    expect(disclosure.acquisitionPolicy.randomOnly).toBe(false)
  })

  it('rejects malformed weights, empty pools, fractions, and canonical rarity mismatches', () => {
    const wrongSum = clone(contract)
    wrongSum.banner.paidRandom.tiers[0].weightUnits = 49
    expect(() => validateEconomyContract(wrongSum, catalog)).toThrow(/weights total 99/)

    const emptyPool = clone(contract)
    emptyPool.banner.paidRandom.tiers[0].items = []
    expect(() => validateEconomyContract(emptyPool, catalog)).toThrow(/at least one item/)

    const fractional = clone(contract)
    fractional.currency.singlePullCost = 160.5
    expect(() => validateEconomyContract(fractional, catalog)).toThrow(/fixed-scale safe integers/)

    const wrongRarity = clone(contract)
    wrongRarity.banner.paidRandom.tiers[0].items[0].catalogItemId =
      'void-crystal/d10/legendary@1'
    expect(() => validateEconomyContract(wrongRarity, catalog)).toThrow(/is not common/)
  })

  it('rejects mythic paid-random entries and inaccessible or lossy featured guarantees', () => {
    const mythic = clone(contract)
    mythic.banner.paidRandom.tiers[4].rarity = 'mythic'
    mythic.banner.paidRandom.tiers[4].items = [{
      catalogItemId: 'infernal-obsidian/d10/mythic@1',
      weightUnits: 1,
    }]
    expect(() => validateEconomyContract(mythic, catalog)).toThrow(/Excluded rarity mythic/)

    const inaccessible = clone(contract)
    inaccessible.banner.guarantees.selectedFeatured.featuredCatalogItemIds = [
      'infernal-obsidian/d10/mythic@1',
    ]
    expect(() => validateEconomyContract(inaccessible, catalog)).toThrow(/inaccessible/)

    const lossy = clone(contract)
    lossy.banner.guarantees.selectedFeatured.lossPath = 'fifty-fifty'
    expect(() => validateEconomyContract(lossy, catalog)).toThrow(/50\/50 loss path/)
  })

  it('rejects off-by-one guarantees and family carry that cannot preserve progress', () => {
    const shortWindow = clone(contract)
    shortWindow.banner.guarantees.rareOrBetterTenPull.windowPulls = 9
    expect(() => validateEconomyContract(shortWindow, catalog)).toThrow(/ten-pull window/)

    const ambiguousReplacement = clone(contract)
    ambiguousReplacement.banner.guarantees.rareOrBetterTenPull.replacementDistribution = 'reroll'
    expect(() => validateEconomyContract(ambiguousReplacement, catalog)).toThrow(
      /condition the disclosed base weights/,
    )

    const rollingSingles = clone(contract)
    rollingSingles.banner.guarantees.rareOrBetterTenPull.windowScope =
      'any-ten-consecutive-pulls'
    expect(() => validateEconomyContract(rollingSingles, catalog)).toThrow(
      /scoped to one purchased ten-pull batch/,
    )

    const participatingSingles = clone(contract)
    participatingSingles.banner.guarantees.rareOrBetterTenPull.singlePullBehavior =
      'advances-window'
    expect(() => validateEconomyContract(participatingSingles, catalog)).toThrow(
      /Single pulls must not advance or satisfy/,
    )

    const rollingPurchases = clone(contract)
    rollingPurchases.banner.guarantees.rareOrBetterTenPull.rollingBehavior =
      'carry-between-purchases'
    expect(() => validateEconomyContract(rollingPurchases, catalog)).toThrow(
      /must not roll across purchases/,
    )

    const hitOnlyReset = clone(contract)
    hitOnlyReset.banner.guarantees.rareOrBetterTenPull.reset = 'on-guarantee-hit'
    expect(() => validateEconomyContract(hitOnlyReset, catalog)).toThrow(
      /reset after every purchased ten-pull batch/,
    )

    const zeroPity = clone(contract)
    zeroPity.banner.guarantees.selectedFeatured.hardGuaranteePull = 0
    expect(() => validateEconomyContract(zeroPity, catalog)).toThrow(/integer from 1/)

    const wrongFeaturedBoundary = clone(contract)
    wrongFeaturedBoundary.banner.guarantees.selectedFeatured.trigger = 'after-counter'
    expect(() => validateEconomyContract(wrongFeaturedBoundary, catalog)).toThrow(
      /replace the pull at the disclosed hard counter/,
    )

    const wrongFamily = clone(contract)
    wrongFamily.banner.guarantees.selectedFeatured.carryFamilyId = 'another-family'
    expect(() => validateEconomyContract(wrongFamily, catalog)).toThrow(/match banner.familyId/)
  })

  it('requires a coherent seven-day bank, unowned pool, and explicit shard value for every rarity', () => {
    const wrongBudget = clone(contract)
    wrongBudget.freeCadence.weeklyStarBudget.totalAmount = 1599
    expect(() => validateEconomyContract(wrongBudget, catalog)).toThrow(/components total 1600/)

    const wrongEvergreen = clone(contract)
    wrongEvergreen.freeCadence.weeklyUnownedEvergreen.catalogItemIds[0] =
      'void-crystal/d10/legendary@1'
    expect(() => validateEconomyContract(wrongEvergreen, catalog)).toThrow(/ineligible rarity/)

    const missingShardTier = clone(contract)
    delete missingShardTier.duplicateConversion.amountByRarity.mythic
    expect(() => validateEconomyContract(missingShardTier, catalog)).toThrow(
      /Duplicate conversion rarities must contain exactly/,
    )

    const negativeShards = clone(contract)
    negativeShards.duplicateConversion.amountByRarity.common = -1
    expect(() => validateEconomyContract(negativeShards, catalog)).toThrow(/integer from 0/)
  })

  it('requires visible deterministic named-item alternatives without implementing them', () => {
    const randomOnly = clone(contract)
    randomOnly.acquisitionPolicy.randomOnly = true
    expect(() => validateEconomyContract(randomOnly, catalog)).toThrow(/cannot be the only/)

    const missingCrafting = clone(contract)
    missingCrafting.acquisitionPolicy.requiredNamedItemRoutes = ['direct-purchase']
    expect(() => validateEconomyContract(missingCrafting, catalog)).toThrow(
      /deterministic-shard-crafting, direct-purchase/,
    )
  })
})

describe('economy disclosure publication boundary', () => {
  it('writes only missing artifacts and rejects drift in an existing immutable disclosure', () => {
    const directory = fixtureRoot()
    const first = generateEconomyDisclosures({ rootDir: directory, writeNew: true })
    expect(first.generated).toEqual(['economy/disclosures/0001-broad-rarity-showcase.json'])
    expect(() => generateEconomyDisclosures({ rootDir: directory })).not.toThrow()

    const disclosurePath = path.join(
      directory,
      'economy/disclosures/0001-broad-rarity-showcase.json',
    )
    fs.appendFileSync(disclosurePath, '\n')
    expect(() => generateEconomyDisclosures({ rootDir: directory, writeNew: true })).toThrow(
      /append a new version instead/,
    )
  })

  it.each([
    [
      'frontend',
      'src/economyRuntime.ts',
      "import config from '../economy/contracts/editions/0001-broad-rarity-showcase.json'\n",
    ],
    [
      'server adapter',
      'server/src/economy_runtime.rs',
      'const CONTRACT: &str = include_str!("../../economy/contracts/editions/0001-broad-rarity-showcase.json");\n',
    ],
    [
      'shared Rust core',
      'server/core/src/economy_runtime.rs',
      'const DISCLOSURE: &str = include_str!("../../../economy/disclosures/0001-broad-rarity-showcase.json");\n',
    ],
    [
      'WASM room core',
      'server/wasm/src/economy_runtime.rs',
      'const CONTRACT: &str = include_str!("../../../economy/contracts/editions/0001-broad-rarity-showcase.json");\n',
    ],
  ])('rejects %s consumption of simulation-only economy data', (_label, filePath, source) => {
    const directory = fixtureRoot()
    write(directory, filePath, source)
    expect(() => validateNoRuntimeEconomyConsumers(directory)).toThrow(/cannot be imported/)
  })
})
