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
const catalogPath = path.join(root, 'src/generated/collectibleCatalog.json')
const edition = JSON.parse(fs.readFileSync(editionPath, 'utf8'))
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

function createVersionBumpFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-production-economy-'))
  temporaryDirectories.push(rootDir)
  write(
    rootDir,
    'src/generated/collectibleCatalog.json',
    fs.readFileSync(catalogPath, 'utf8'),
  )
  write(
    rootDir,
    'economy/production/editions/0001-earned-collection.json',
    fs.readFileSync(editionPath, 'utf8'),
  )
  write(
    rootDir,
    'supabase/migrations/0009_earned_economy_ledger.sql',
    fs.readFileSync(path.join(root, 'supabase/migrations/0009_earned_economy_ledger.sql'), 'utf8'),
  )

  const nextEdition = clone(edition)
  nextEdition.edition = 2
  nextEdition.editionId = 'earned-collection@2'
  nextEdition.migration = '0010_earned_economy_tuning.sql'
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
  write(rootDir, 'economy/production/editions/0002-earned-collection.json', source)
  write(
    rootDir,
    'supabase/migrations/0010_earned_economy_tuning.sql',
    `do $seed$\n` +
      `declare\n` +
      `  expected_config constant jsonb :=\n` +
      `-- BEGIN EARNED ECONOMY EDITION 0002\n` +
      `$edition$\n${source}$edition$::jsonb\n` +
      `-- END EARNED ECONOMY EDITION 0002\n` +
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
  it('validates the immutable edition and its exact migration anchor', () => {
    const result = validateProductionEconomy({ rootDir: root })
    expect(result.editions).toHaveLength(1)
    expect(result.editions[0]).toMatchObject({
      fileName: '0001-earned-collection.json',
      sha256: productionEditionSha256(edition),
    })
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
    expect(result.editions).toHaveLength(2)
    expect(result.editions[1]).toMatchObject({
      fileName: '0002-earned-collection.json',
      edition: nextEdition,
      sha256,
    })
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
