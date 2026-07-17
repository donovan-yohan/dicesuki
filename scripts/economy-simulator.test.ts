import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  candidateBProfile,
  carryCandidateBState,
  createSeededRng,
  generateEconomySimulationReports,
  initialCandidateBState,
  resolveCandidateBPull,
  validateSimulationScenario,
} from './economy-simulator.js'

const root = path.resolve(import.meta.dirname, '..')

function readJson(relativePath: string) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

const scenario = readJson('economy/simulations/scenarios/0001-candidate-a-vs-collection-first.json')
const catalog = readJson('src/generated/collectibleCatalog.json')
const contract = readJson('economy/contracts/editions/0001-broad-rarity-showcase.json')

function deterministicMiss(profile: ReturnType<typeof candidateBProfile>, _rng: unknown, minimumRank: number) {
  const tier = profile.tiers.find(entry => entry.rank >= minimumRank)!
  return { ...tier.items[0], reason: 'base' }
}

describe('economy simulator', () => {
  it('reproduces the committed fixed-seed report and its required decision outputs', () => {
    expect(generateEconomySimulationReports({ rootDir: root })).toMatchObject({
      count: 1,
      generated: [],
    })
    const report = readJson(scenario.reportArtifact)
    expect(report).toMatchObject({
      reportVersion: 1,
      scenarioId: 'candidate-a-vs-collection-first@1',
      purpose: 'simulation-only',
      runtimeConsumption: 'forbidden',
      contentThroughput: {
        perpetualWeeklyNewSkuPromise: {
          sustainable: false,
          decision: 'rejected',
        },
      },
    })
    expect(report.statisticalValidation.candidateA.passed).toBe(true)
    expect(report.statisticalValidation.candidateB.passed).toBe(true)
    expect(report.targetAcquisition.candidateA.selectedCost.capStars).toBe(4800)
    expect(report.targetAcquisition.candidateB.selectedCost.capStars).toBe(3200)
    expect(report.collectionCompletion.candidateB.completionCurve.at(-1)).toMatchObject({
      noEligibleStandardRewardProbabilityPpm: 1_000_000,
      noEligibleCommunityRewardProbabilityPpm: 1_000_000,
    })
    expect(report.disclosures.candidateB.baseRandom.itemProbabilities).toHaveLength(45)
    expect(report.alternatives.candidateB.directPurchase.priceStars).toBe(2400)
    expect(report.alternatives.candidateB.deterministicCrafting.costShards).toBe(250)
  }, 15_000)

  it('uses a deterministic uint32 seed and unbiased bounded integer selection', () => {
    const left = createSeededRng(147001)
    const right = createSeededRng(147001)
    expect(Array.from({ length: 32 }, () => left.randomInt(100)))
      .toEqual(Array.from({ length: 32 }, () => right.randomInt(100)))
    const values = Array.from({ length: 10_000 }, () => left.randomInt(7))
    expect(Math.min(...values)).toBe(0)
    expect(Math.max(...values)).toBe(6)
  })

  it('fires rolling guarantees at pulls 8, 20, and 25 without off-by-one errors', () => {
    const profile = candidateBProfile(scenario.candidateB)
    const owned = new Set<string>()
    const initial = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])

    const rareBefore = resolveCandidateBPull(
      profile,
      { ...initial, rareMisses: 6 },
      owned,
      deterministicMiss,
    )
    expect(rareBefore.result.reason).toBe('base')
    const rareAtEight = resolveCandidateBPull(
      profile,
      { ...initial, rareMisses: 7 },
      owned,
      deterministicMiss,
    )
    expect(rareAtEight.result).toMatchObject({ rank: 1, reason: 'rare-guarantee' })

    const selectedBefore = resolveCandidateBPull(
      profile,
      { ...initial, selectedMisses: 18 },
      owned,
      deterministicMiss,
    )
    expect(selectedBefore.result.reason).toBe('base')
    const selectedAtTwenty = resolveCandidateBPull(
      profile,
      { ...initial, rareMisses: 7, epicMisses: 24, selectedMisses: 19 },
      owned,
      deterministicMiss,
    )
    expect(selectedAtTwenty.result).toMatchObject({ rank: 3, reason: 'selected-guarantee' })

    const allFeaturedOwned = new Set<string>(profile.featuredIds)
    const epicBefore = resolveCandidateBPull(
      profile,
      { ...initial, epicMisses: 23 },
      allFeaturedOwned,
      deterministicMiss,
    )
    expect(epicBefore.result.reason).toBe('base')
    const epicAtTwentyFive = resolveCandidateBPull(
      profile,
      { ...initial, rareMisses: 7, epicMisses: 24 },
      allFeaturedOwned,
      deterministicMiss,
    )
    expect(epicAtTwentyFive.result).toMatchObject({ rank: 2, reason: 'epic-guarantee' })
  })

  it('carries pity only across explicitly compatible banners in the family', () => {
    const profile = candidateBProfile(scenario.candidateB)
    const state = {
      ...initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0]),
      rareMisses: 7,
      epicMisses: 19,
      selectedMisses: 11,
    }
    expect(carryCandidateBState(profile, state, profile.compatibleBannerIds[1])).toEqual({
      ...state,
      bannerId: profile.compatibleBannerIds[1],
    })
    expect(() => carryCandidateBState(profile, state, 'unrelated-banner')).toThrow(/not compatible/)
  })

  it('rejects malformed pools, weight normalization, unreachable selection, and balance ambiguity', () => {
    const wrongWeight = clone(scenario)
    wrongWeight.candidateB.tiers[0].weightUnits = 71
    expect(() => validateSimulationScenario(wrongWeight, catalog, contract)).toThrow(/weights total 99/)

    const emptyPool = clone(scenario)
    emptyPool.candidateB.tiers[2].catalogItemIds = []
    expect(() => validateSimulationScenario(emptyPool, catalog, contract)).toThrow(/non-empty array/)

    const unreachable = clone(scenario)
    unreachable.candidateB.guarantees.selectedFeaturedUnowned.featuredCatalogItemIds = [
      'infernal-obsidian/d10/mythic@1',
    ]
    expect(() => validateSimulationScenario(unreachable, catalog, contract)).toThrow(/unreachable/)

    const wrongFeaturedRank = clone(scenario)
    wrongFeaturedRank.candidateB.guarantees.selectedFeaturedUnowned.featuredCatalogItemIds = [
      scenario.candidateB.tiers[0].catalogItemIds[0],
    ]
    expect(() => validateSimulationScenario(wrongFeaturedRank, catalog, contract)).toThrow(/minimum rank/)

    const wrongPassportPool = clone(scenario)
    wrongPassportPool.freeCadence.passport.eligibleCatalogItemIds[0] =
      scenario.candidateB.tiers[2].catalogItemIds[0]
    expect(() => validateSimulationScenario(wrongPassportPool, catalog, contract)).toThrow(/standard pool/)

    const ambiguousBalance = clone(scenario)
    ambiguousBalance.candidateB.currency.balanceClasses = ['stars']
    expect(() => validateSimulationScenario(ambiguousBalance, catalog, contract)).toThrow(/paid\/promotional/)
  })
})
