import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  productionEditionSha256,
  validateProductionEconomy,
  validateProductionEdition,
} from './validate-production-economy.js'

const root = process.cwd()
const editionPath = path.join(
  root,
  'economy/production/editions/0001-earned-collection.json',
)
const edition0002Path = path.join(
  root,
  'economy/production/editions/0002-earned-collection.json',
)
const edition0003Path = path.join(
  root,
  'economy/production/editions/0003-earned-collection.json',
)
const catalogPath = path.join(root, 'src/generated/collectibleCatalog.json')
const edition = JSON.parse(fs.readFileSync(editionPath, 'utf8'))
const edition0002 = JSON.parse(fs.readFileSync(edition0002Path, 'utf8'))
const edition0003 = JSON.parse(fs.readFileSync(edition0003Path, 'utf8'))
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const temporaryDirectories: string[] = []

function clone<T>(value: T): T {
  return structuredClone(value)
}

function write(rootDir: string, filePath: string, value: string) {
  const target = path.join(rootDir, filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

// Mirror of the published lineage in a scratch root, so a test may tamper with
// a byte of it without touching the repository's real, immutable history.
function createPublishedFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-production-economy-'))
  temporaryDirectories.push(rootDir)
  write(
    rootDir,
    'src/generated/collectibleCatalog.json',
    fs.readFileSync(catalogPath, 'utf8'),
  )
  for (const [editionFile, migrationFile] of [
    ['0001-earned-collection.json', '0009_earned_economy_ledger.sql'],
    ['0002-earned-collection.json', '0030_earned_economy_rare_pity_10.sql'],
    ['0003-earned-collection.json', '0032_earned_economy_dice_content_wave_1.sql'],
  ]) {
    write(
      rootDir,
      `economy/production/editions/${editionFile}`,
      fs.readFileSync(path.join(root, 'economy/production/editions', editionFile), 'utf8'),
    )
    write(
      rootDir,
      `supabase/migrations/${migrationFile}`,
      fs.readFileSync(path.join(root, 'supabase/migrations', migrationFile), 'utf8'),
    )
  }
  return rootDir
}

function createVersionBumpFixture() {
  const rootDir = createPublishedFixture()

  const nextEdition = clone(edition)
  nextEdition.edition = 4
  nextEdition.editionId = 'earned-collection@4'
  nextEdition.migration = '0033_earned_economy_tuning.sql'
  nextEdition.decisionSource = {
    studyId: 'candidate-b-live-tuning@1',
    selectedCandidateId: 'retuned-costs-and-pity@1',
  }
  nextEdition.acquisition.currency.singlePullCost = 200
  nextEdition.acquisition.currency.tenPullCost = 2000
  nextEdition.acquisition.banner.bannerId = 'earned-collection-002'
  nextEdition.acquisition.banner.tiers[0].weightUnits = 70
  nextEdition.acquisition.banner.tiers[1].weightUnits = 24
  nextEdition.acquisition.banner.tiers[2].weightUnits = 5
  nextEdition.acquisition.banner.guarantees.rareOrBetter.hardGuaranteePull = 9
  nextEdition.acquisition.banner.guarantees.epicOrBetter.hardGuaranteePull = 30
  nextEdition.acquisition.banner.guarantees.selectedFeaturedUnowned.hardGuaranteePull = 24
  nextEdition.rewards.weeklyAuthoritativeRolls.rewardPerCompletedRoll.amount = 200
  nextEdition.rewards.weeklyAuthoritativeRolls.maximumPeriodReward = 2000
  nextEdition.duplicateConversion.amountByTier = {
    standard: 3,
    rare: 10,
    epic: 25,
    signature: 60,
    community: 60,
  }

  const source = `${JSON.stringify(nextEdition, null, 2)}\n`
  const sha256 = productionEditionSha256(nextEdition)
  write(rootDir, 'economy/production/editions/0004-earned-collection.json', source)
  write(
    rootDir,
    'supabase/migrations/0033_earned_economy_tuning.sql',
    `do $seed$\n` +
      `declare\n` +
      `  expected_config constant jsonb :=\n` +
      `-- BEGIN EARNED ECONOMY EDITION 0004\n` +
      `$edition$\n${source}$edition$::jsonb\n` +
      `-- END EARNED ECONOMY EDITION 0004\n` +
      `  ;\n` +
      `  expected_sha256 constant text := '${sha256}';\n` +
      `begin\n` +
      `  null;\n` +
      `end;\n` +
      `$seed$;\n`,
  )
  return { rootDir, nextEdition, sha256 }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('production economy contract', () => {
  it('validates every immutable edition and its exact migration anchor', () => {
    const result = validateProductionEconomy({ rootDir: root })
    expect(result.editions).toHaveLength(3)
    expect(result.editions[0]).toMatchObject({
      fileName: '0001-earned-collection.json',
      sha256: productionEditionSha256(edition),
    })
    expect(result.editions[1]).toMatchObject({
      fileName: '0002-earned-collection.json',
      sha256: productionEditionSha256(edition0002),
    })
    expect(result.editions[1].edition.migration).toBe(
      '0030_earned_economy_rare_pity_10.sql',
    )
    expect(result.editions[2]).toMatchObject({
      fileName: '0003-earned-collection.json',
      sha256: productionEditionSha256(edition0003),
    })
    expect(result.editions[2].edition.migration).toBe(
      '0032_earned_economy_dice_content_wave_1.sql',
    )
  })

  it('appends edition 0002 as the pull-10 rare guarantee edition of record', () => {
    expect(edition0002.editionId).toBe('earned-collection@2')
    expect(edition0002.acquisition.banner.guarantees).toMatchObject({
      rareOrBetter: { hardGuaranteePull: 10 },
      epicOrBetter: { hardGuaranteePull: 25 },
      selectedFeaturedUnowned: { hardGuaranteePull: 20 },
    })

    // Only the rare boundary and the append-only identity may differ from the
    // frozen edition 0001 source.
    const rebased = clone(edition0002)
    rebased.edition = edition.edition
    rebased.editionId = edition.editionId
    rebased.migration = edition.migration
    rebased.acquisition.banner.guarantees.rareOrBetter.hardGuaranteePull =
      edition.acquisition.banner.guarantees.rareOrBetter.hardGuaranteePull
    expect(rebased).toEqual(edition)

    const drifted = clone(edition0002)
    drifted.acquisition.banner.guarantees.rareOrBetter.hardGuaranteePull = 8
    expect(() => validateProductionEdition(
      drifted,
      catalog,
      '0002-earned-collection.json',
    )).toThrow(/rareOrBetter production boundary/)

    const rewritten = clone(edition0002)
    rewritten.acquisition.banner.tiers[0].catalogItemIds.reverse()
    rewritten.rewards.newCollectorPassport.eligibleCatalogItemIds.reverse()
    expect(() => validateProductionEdition(
      rewritten,
      catalog,
      '0002-earned-collection.json',
    )).toThrow(/Production edition 0002 must retain its frozen Candidate B source/)
  })

  it('appends edition 0003 as the wave-1 pool edition of record', () => {
    expect(edition0003.editionId).toBe('earned-collection@3')

    // Only pool membership and the append-only identity may differ from the
    // frozen edition 0002 source: weights, costs, and every guarantee boundary
    // are byte-identical.
    const rebased = clone(edition0003)
    rebased.edition = edition0002.edition
    rebased.editionId = edition0002.editionId
    rebased.migration = edition0002.migration
    for (const [index, tier] of rebased.acquisition.banner.tiers.entries()) {
      tier.catalogItemIds = edition0002.acquisition.banner.tiers[index].catalogItemIds
    }
    rebased.acquisition.banner.guarantees.selectedFeaturedUnowned.catalogItemIds =
      edition0002.acquisition.banner.guarantees.selectedFeaturedUnowned.catalogItemIds
    expect(rebased).toEqual(edition0002)

    const poolSizes = Object.fromEntries(
      edition0003.acquisition.banner.tiers.map(
        (tier: { tierId: string; catalogItemIds: string[] }) =>
          [tier.tierId, tier.catalogItemIds.length],
      ),
    )
    expect(poolSizes).toEqual({ standard: 24, rare: 27, epic: 18, signature: 12 })

    // ten-thousand-folds is reserved as the premium banner's featured
    // candidate; the 0.6% featured rate-up only works while it stays out of
    // every standard-banner pool.
    const pooledIds = edition0003.acquisition.banner.tiers.flatMap(
      (tier: { catalogItemIds: string[] }) => tier.catalogItemIds,
    )
    expect(pooledIds.filter((id: string) => id.startsWith('ten-thousand-folds/')))
      .toEqual([])

    const shrunkPool = clone(edition0003)
    shrunkPool.acquisition.banner.tiers[1].catalogItemIds.pop()
    expect(() => validateProductionEdition(
      shrunkPool,
      catalog,
      '0003-earned-collection.json',
    )).toThrow(/Production edition 0003 must retain its frozen Candidate B source/)

    const reweighted = clone(edition0003)
    reweighted.acquisition.banner.tiers[2].weightUnits = 6
    reweighted.acquisition.banner.tiers[0].weightUnits = 70
    expect(() => validateProductionEdition(
      reweighted,
      catalog,
      '0003-earned-collection.json',
    )).toThrow(/Tier 0 must be standard\/0\/72/)

    // The selected-featured pool must stay exactly the signature tier, or the
    // 20-pull guarantee could award a die the tier cannot otherwise produce.
    const detachedFeatured = clone(edition0003)
    detachedFeatured.acquisition.banner.guarantees.selectedFeaturedUnowned
      .catalogItemIds = ['stormglass/d10/legendary@1']
    expect(() => validateProductionEdition(
      detachedFeatured,
      catalog,
      '0003-earned-collection.json',
    )).toThrow(/selected featured pool/)
  })

  it('rejects a migration whose anchor drifts from its published edition', () => {
    const migrationPath = 'supabase/migrations/0032_earned_economy_dice_content_wave_1.sql'

    const tamperedHash = createPublishedFixture()
    const original = fs.readFileSync(path.join(tamperedHash, migrationPath), 'utf8')
    const publishedSha = productionEditionSha256(edition0003)
    expect(original).toContain(publishedSha)
    write(
      tamperedHash,
      migrationPath,
      original.replace(
        new RegExp(`expected_sha256 constant text :=\\s*'${publishedSha}'`),
        `expected_sha256 constant text :=\n    '${'0'.repeat(64)}'`,
      ),
    )
    expect(() => validateProductionEconomy({ rootDir: tamperedHash }))
      .toThrow(/migration source hash differs from its production edition/)

    // A migration that seeds a different pool than the edition it claims is the
    // failure the embedded block exists to catch.
    const tamperedBlock = createPublishedFixture()
    write(
      tamperedBlock,
      migrationPath,
      original.replace(
        '"ashvow/d10/rare@1",',
        '"ashvow/d10/rare@1",\n            "ashvow/d10/rare@1",',
      ),
    )
    expect(() => validateProductionEconomy({ rootDir: tamperedBlock }))
      .toThrow(/migration edition JSON differs from its source edition/)

    // The unmodified mirror still validates, so the two failures above are the
    // tampering and not the fixture.
    expect(() => validateProductionEconomy({ rootDir: createPublishedFixture() }))
      .not.toThrow()
  })

  it('freezes selected Candidate B rates, guarantees, and earned-only boundaries', () => {
    expect(edition.acquisition).toMatchObject({
      phase: 'earned-only',
      realMoneyEnabled: false,
      checkoutEnabled: false,
      currency: {
        currencyId: 'stars',
        balanceBucket: 'promotional',
        singlePullCost: 160,
        tenPullCost: 1600,
      },
      banner: {
        tiers: [
          { tierId: 'standard', weightUnits: 72 },
          { tierId: 'rare', weightUnits: 23 },
          { tierId: 'epic', weightUnits: 4 },
          { tierId: 'signature', weightUnits: 1 },
        ],
        guarantees: {
          rareOrBetter: { hardGuaranteePull: 8 },
          epicOrBetter: { hardGuaranteePull: 25 },
          selectedFeaturedUnowned: { hardGuaranteePull: 20 },
        },
      },
    })
    expect(edition.rewards).toMatchObject({
      weeklyAuthoritativeRolls: {
        authoritativeCompletedRollTarget: 10,
        rewardPerCompletedRoll: { amount: 160, balanceBucket: 'promotional' },
        maximumPeriodReward: 1600,
        streakLoss: false,
        missedDayPenalty: false,
      },
      newCollectorPassport: {
        durationWeeks: 12,
        whenAllOwned: { amount: 2, currencyId: 'dust' },
        afterWeekTwelve: 'completed-no-further-claims',
      },
      communityDie: {
        intervalWeeks: 4,
        claimMode: 'direct-claim',
        whenAllOwned: { amount: 50, currencyId: 'dust' },
      },
    })
    expect(edition.duplicateConversion.amountByTier).toEqual({
      standard: 2,
      rare: 8,
      epic: 20,
      signature: 50,
      community: 50,
    })
  })

  it('rejects economic drift and future catalog leakage', () => {
    const wrongWeights = clone(edition)
    wrongWeights.acquisition.banner.tiers[0].weightUnits = 71
    wrongWeights.acquisition.banner.tiers[1].weightUnits = 24
    expect(() => validateProductionEdition(wrongWeights, catalog, 'fixture.json'))
      .toThrow(/standard\/0\/72/)

    const coerciveCadence = clone(edition)
    coerciveCadence.rewards.weeklyAuthoritativeRolls.streakLoss = true
    expect(() => validateProductionEdition(coerciveCadence, catalog, 'fixture.json'))
      .toThrow(/non-coercive/)

    const perpetualPassport = clone(edition)
    perpetualPassport.rewards.newCollectorPassport.afterWeekTwelve = 'repeat-forever'
    expect(() => validateProductionEdition(perpetualPassport, catalog, 'fixture.json'))
      .toThrow(/finite/)

    const unknownItem = clone(edition)
    unknownItem.acquisition.banner.tiers[0].catalogItemIds[0] = 'future-set/d20/common@2'
    expect(() => validateProductionEdition(unknownItem, catalog, 'fixture.json'))
      .toThrow(/unknown catalog item/)
  })

  it('freezes edition 0001 while accepting an appended schema-v1 tuning edition', () => {
    const reorderedEdition0001 = clone(edition)
    reorderedEdition0001.acquisition.banner.tiers[0].catalogItemIds.reverse()
    reorderedEdition0001.rewards.newCollectorPassport.eligibleCatalogItemIds.reverse()
    expect(() => validateProductionEdition(reorderedEdition0001, catalog, 'fixture.json'))
      .toThrow(/frozen Candidate B source/)

    const { rootDir, nextEdition, sha256 } = createVersionBumpFixture()
    const result = validateProductionEconomy({ rootDir })
    expect(result.editions).toHaveLength(4)
    expect(result.editions[3]).toMatchObject({
      fileName: '0004-earned-collection.json',
      edition: nextEdition,
      sha256,
    })
  })

  it('leaves a none soft-pity config unaffected on later schema-v1 editions', () => {
    const { nextEdition } = createVersionBumpFixture()
    expect(() => validateProductionEdition(
      nextEdition,
      catalog,
      '0004-earned-collection.json',
    )).not.toThrow()
  })

  it('accepts a linear soft-pity base matching the signature tier weight fraction', () => {
    const { nextEdition } = createVersionBumpFixture()
    nextEdition.acquisition.banner.guarantees.selectedFeaturedUnowned.softPity = {
      model: 'linear-rate-ramp',
      startPull: 12,
      perPullIncrement: 0.005,
      baseFeaturedRate: 0.01,
    }
    expect(() => validateProductionEdition(
      nextEdition,
      catalog,
      '0004-earned-collection.json',
    )).not.toThrow()
  })

  it('rejects a linear soft-pity base disagreeing with the signature tier weight fraction', () => {
    const { nextEdition } = createVersionBumpFixture()
    nextEdition.acquisition.banner.guarantees.selectedFeaturedUnowned.softPity = {
      model: 'linear-rate-ramp',
      startPull: 12,
      perPullIncrement: 0.005,
      baseFeaturedRate: 0.006,
    }
    expect(() => validateProductionEdition(
      nextEdition,
      catalog,
      '0004-earned-collection.json',
    )).toThrow(/configured=0\.006.*derived=0\.01/)
  })

  it('rejects malformed linear soft-pity ramps on later schema-v1 editions', () => {
    const { nextEdition } = createVersionBumpFixture()
    const selected = nextEdition.acquisition.banner.guarantees.selectedFeaturedUnowned
    selected.softPity = {
      model: 'linear-rate-ramp',
      startPull: 12,
      perPullIncrement: 0.005,
    }
    expect(() => validateProductionEdition(nextEdition, catalog, '0004-earned-collection.json'))
      .toThrow(/must contain exactly/)

    selected.softPity = {
      model: 'linear-rate-ramp',
      startPull: selected.hardGuaranteePull,
      perPullIncrement: 0.005,
      baseFeaturedRate: 0.006,
    }
    expect(() => validateProductionEdition(nextEdition, catalog, '0004-earned-collection.json'))
      .toThrow(/below the selected hard guarantee/)

    selected.softPity = {
      model: 'linear-rate-ramp',
      startPull: 12,
      perPullIncrement: 0,
      baseFeaturedRate: 0.006,
    }
    expect(() => validateProductionEdition(nextEdition, catalog, '0004-earned-collection.json'))
      .toThrow(/positive finite number/)

    selected.softPity = {
      model: 'linear-rate-ramp',
      startPull: 1,
      perPullIncrement: 0.005,
      baseFeaturedRate: 0.006,
    }
    expect(() => validateProductionEdition(nextEdition, catalog, '0004-earned-collection.json'))
      .toThrow(/greater than 1/)

    selected.softPity = {
      model: 'linear-rate-ramp',
      startPull: 12,
      perPullIncrement: 0.005,
      baseFeaturedRate: 1,
    }
    expect(() => validateProductionEdition(nextEdition, catalog, '0004-earned-collection.json'))
      .toThrow(/probability between 0 and 1/)
  })

  it('routes both guarantee validators through soft-pity validation before the frozen SHA guard', () => {
    const rampedEdition0001 = clone(edition)
    rampedEdition0001.acquisition.banner.guarantees.selectedFeaturedUnowned.softPity = {
      model: 'linear-rate-ramp',
      startPull: 12,
      perPullIncrement: 0.005,
      baseFeaturedRate: 0.01,
    }
    expect(() => validateProductionEdition(rampedEdition0001, catalog, 'fixture.json'))
      .toThrow(/frozen Candidate B source/)

    rampedEdition0001.acquisition.banner.guarantees.selectedFeaturedUnowned.softPity.perPullIncrement = 0
    expect(() => validateProductionEdition(rampedEdition0001, catalog, 'fixture.json'))
      .toThrow(/positive finite number/)

    const validator = fs.readFileSync(
      path.join(root, 'scripts/validate-production-economy.js'),
      'utf8',
    )
    expect(validator.match(/validateSoftPity\(/g)).toHaveLength(3)
    expect(validator).not.toMatch(/selected\.softPity !== 'none'/)
  })

  it('does not consume simulator implementation as a production dependency', () => {
    const validator = fs.readFileSync(
      path.join(root, 'scripts/validate-production-economy.js'),
      'utf8',
    )
    expect(validator).not.toMatch(/from ['"].*economy-simulator/)
    expect(validator).not.toMatch(/from ['"].*simulations\//)
    expect(JSON.stringify(edition)).not.toContain('simulation-only')
  })
})
