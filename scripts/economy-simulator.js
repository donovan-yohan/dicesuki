#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { exactProbability, validateEconomyContract } from './generate-economy-disclosures.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT_DIR = path.join(path.dirname(__filename), '..')
const SCENARIO_PATTERN = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/
const MILLION = 1_000_000
const UINT32_RANGE = 0x1_0000_0000
const BASE_FEATURED_RATE_RELATIVE_EPSILON = 1e-9
const RARITY_RANK = new Map([
  ['common', 0],
  ['uncommon', 0],
  ['rare', 1],
  ['epic', 2],
  ['legendary', 3],
])

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertRecord(value, label)
  const actual = Object.keys(value).sort(compareStrings)
  const expected = [...expectedKeys].sort(compareStrings)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer from ${minimum}`)
  }
  return value
}

function assertIntegerNumbers(value, label = 'Simulation scenario') {
  if (typeof value === 'number') {
    if (
      (label.endsWith('.softPity.perPullIncrement') ||
        label.endsWith('.softPity.baseFeaturedRate')) &&
      Number.isFinite(value)
    ) {
      return
    }
    if (!Number.isSafeInteger(value)) throw new Error(`${label} may only use safe integers`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertIntegerNumbers(entry, `${label}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => assertIntegerNumbers(entry, `${label}.${key}`))
  }
}

function validateSoftPity(value, hardGuaranteePull, derivedBaseFeaturedRate, label) {
  if (value === 'none') return
  assertExactKeys(
    value,
    ['model', 'startPull', 'perPullIncrement', 'baseFeaturedRate'],
    label,
  )
  if (value.model !== 'linear-rate-ramp') {
    throw new Error(`${label}.model must be linear-rate-ramp`)
  }
  if (!Number.isSafeInteger(value.startPull) || value.startPull <= 1) {
    throw new Error(`${label}.startPull must be a safe integer greater than 1`)
  }
  if (value.startPull >= hardGuaranteePull) {
    throw new Error(`${label}.startPull must be below the selected hard guarantee pull`)
  }
  if (!Number.isFinite(value.perPullIncrement) || value.perPullIncrement <= 0) {
    throw new Error(`${label}.perPullIncrement must be a positive finite number`)
  }
  if (
    !Number.isFinite(value.baseFeaturedRate) ||
    value.baseFeaturedRate <= 0 ||
    value.baseFeaturedRate >= 1
  ) {
    throw new Error(`${label}.baseFeaturedRate must be a finite probability between 0 and 1`)
  }
  const relativeScale = Math.max(
    Math.abs(value.baseFeaturedRate),
    Math.abs(derivedBaseFeaturedRate),
  )
  if (
    Math.abs(value.baseFeaturedRate - derivedBaseFeaturedRate) >
    BASE_FEATURED_RATE_RELATIVE_EPSILON * relativeScale
  ) {
    throw new Error(
      `${label}.baseFeaturedRate configured=${value.baseFeaturedRate} must equal ` +
      `derived=${derivedBaseFeaturedRate} from the signature tier weight fraction`,
    )
  }
}

function uniqueStrings(values, label, allowEmpty = false) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`)
  }
  const result = new Set()
  values.forEach((value, index) => {
    assertString(value, `${label}[${index}]`)
    if (result.has(value)) throw new Error(`${label} contains duplicate ${value}`)
    result.add(value)
  })
  return result
}

function catalogIndex(catalog) {
  assertRecord(catalog, 'Collectible catalog')
  if (!Array.isArray(catalog.items) || catalog.items.length === 0) {
    throw new Error('Collectible catalog must contain items')
  }
  return new Map(catalog.items.map(item => [item.id, item]))
}

function requireCatalogItems(ids, itemsById, label) {
  for (const itemId of ids) {
    if (!itemsById.has(itemId)) throw new Error(`${label} references unknown catalog item ${itemId}`)
  }
}

function validateCandidateB(scenario, catalog) {
  const candidate = scenario.candidateB
  assertRecord(candidate, 'candidateB')
  if (candidate.candidateId !== 'collection-first-showcase@1') {
    throw new Error('candidateB.candidateId must identify the frozen collection-first candidate')
  }
  assertString(candidate.familyId, 'candidateB.familyId')
  uniqueStrings(candidate.compatibleBannerIds, 'candidateB.compatibleBannerIds')
  if (candidate.compatibleBannerIds.length < 2) {
    throw new Error('Candidate B must name at least two compatible banners to prove family carry')
  }
  const currency = candidate.currency
  if (currency.currencyId !== 'stars' || currency.singlePullCost !== 160 || currency.tenPullCost !== 1600) {
    throw new Error('Candidate B must use the 160/1600 Stars price points')
  }
  if (
    JSON.stringify(currency.balanceClasses) !== JSON.stringify(['paid', 'promotional']) ||
    currency.debitPolicy !== 'promotional-before-paid'
  ) {
    throw new Error('Candidate B must preserve separate paid/promotional balances with promotional-first debit')
  }
  integer(candidate.weightScale, 'candidateB.weightScale', 1)
  if (!Array.isArray(candidate.tiers) || candidate.tiers.length === 0) {
    throw new Error('candidateB.tiers must be non-empty')
  }
  const itemsById = catalogIndex(catalog)
  const seenTierIds = new Set()
  const seenItems = new Set()
  const tierByItem = new Map()
  let totalWeight = 0
  candidate.tiers.forEach((tier, index) => {
    assertString(tier.tierId, `candidateB.tiers[${index}].tierId`)
    if (seenTierIds.has(tier.tierId)) throw new Error(`Duplicate Candidate B tier ${tier.tierId}`)
    seenTierIds.add(tier.tierId)
    if (tier.rank !== index) throw new Error('Candidate B tier ranks must be contiguous and ordered')
    totalWeight += integer(tier.weightUnits, `candidateB tier ${tier.tierId} weight`, 1)
    const itemIds = uniqueStrings(tier.catalogItemIds, `candidateB tier ${tier.tierId} pool`)
    requireCatalogItems(itemIds, itemsById, `candidateB tier ${tier.tierId}`)
    for (const itemId of itemIds) {
      if (seenItems.has(itemId)) throw new Error(`Candidate B item ${itemId} appears in multiple tiers`)
      if (itemsById.get(itemId).rarity === 'mythic') {
        throw new Error(`Mythic item ${itemId} cannot enter Candidate B paid-random pools`)
      }
      seenItems.add(itemId)
      tierByItem.set(itemId, tier)
    }
  })
  if (totalWeight !== candidate.weightScale) {
    throw new Error(`Candidate B weights total ${totalWeight}, expected ${candidate.weightScale}`)
  }
  if (JSON.stringify([...seenTierIds]) !== JSON.stringify(['standard', 'rare', 'epic', 'signature'])) {
    throw new Error('Candidate B must contain standard, rare, epic, and signature tiers in order')
  }

  const guarantees = candidate.guarantees
  const expected = [
    ['rareOrBetter', 1, 8],
    ['epicOrBetter', 2, 25],
    ['selectedFeaturedUnowned', 3, 20],
  ]
  for (const [key, rank, hardPull] of expected) {
    const guarantee = guarantees[key]
    if (guarantee.minimumRank !== rank || guarantee.hardGuaranteePull !== hardPull) {
      throw new Error(`${key} must use rank ${rank} at the exact pull-${hardPull} boundary`)
    }
    if (guarantee.counterScope !== 'banner-family') {
      throw new Error(`${key} must carry within the compatible banner family`)
    }
    if (!candidate.tiers.some(tier => tier.rank >= rank && tier.catalogItemIds.length > 0)) {
      throw new Error(`${key} has no reachable paid-random result`)
    }
  }
  const selected = guarantees.selectedFeaturedUnowned
  const featured = uniqueStrings(selected.featuredCatalogItemIds, 'selected featured pool')
  requireCatalogItems(featured, itemsById, 'selected featured pool')
  for (const itemId of featured) {
    if (!seenItems.has(itemId)) throw new Error(`Selected featured item ${itemId} is unreachable`)
    if (tierByItem.get(itemId).rank < selected.minimumRank) {
      throw new Error(`Selected featured item ${itemId} cannot satisfy its minimum rank`)
    }
  }
  validateSoftPity(
    selected.softPity,
    selected.hardGuaranteePull,
    candidate.tiers.find(tier => tier.tierId === 'signature').weightUnits / totalWeight,
    'selectedFeaturedUnowned.softPity',
  )
  if (
    selected.selection !== 'lowest-canonical-id-unowned' ||
    selected.lossPath !== 'none' ||
    selected.reset !== 'selected-featured-awarded'
  ) {
    throw new Error('Selected featured guarantee must be deterministic, lossless, and reset on award')
  }
  for (const key of ['rareOrBetter', 'epicOrBetter']) {
    if (guarantees[key].reset !== 'qualifying-result-awarded') {
      throw new Error(`${key} must reset when a qualifying result is awarded`)
    }
  }
  const shardTierIds = Object.keys(candidate.duplicateShardsByTier).sort(compareStrings)
  if (JSON.stringify(shardTierIds) !== JSON.stringify([...seenTierIds].sort(compareStrings))) {
    throw new Error('Candidate B must specify duplicate Shards for every tier')
  }
  shardTierIds.forEach(tierId => integer(candidate.duplicateShardsByTier[tierId], `Shards for ${tierId}`))
  return { itemsById, seenItems, featured }
}

export function validateSimulationScenario(scenario, catalog, candidateAContract) {
  assertRecord(scenario, 'Simulation scenario')
  assertIntegerNumbers(scenario)
  integer(scenario.scenarioVersion, 'scenarioVersion', 1)
  if (scenario.scenarioId !== `${scenario.slug}@${scenario.scenarioVersion}`) {
    throw new Error('scenarioId must be <slug>@<scenarioVersion>')
  }
  if (scenario.purpose !== 'simulation-only') throw new Error('Simulation scenario must remain simulation-only')
  const expectedReport = `economy/simulations/reports/${String(scenario.scenarioVersion).padStart(4, '0')}-${scenario.slug}.json`
  if (scenario.reportArtifact !== expectedReport) {
    throw new Error(`reportArtifact must be ${expectedReport}`)
  }
  validateEconomyContract(candidateAContract, catalog)
  if (scenario.candidateA.candidateId !== candidateAContract.contractId) {
    throw new Error('Candidate A reference does not match its immutable contract')
  }
  if (scenario.candidateA.sourceDisclosure !== candidateAContract.disclosureArtifact) {
    throw new Error('Candidate A disclosure reference does not match its immutable contract')
  }
  const selectedA = candidateAContract.banner.guarantees.selectedFeatured.featuredCatalogItemIds
  if (!selectedA.includes(scenario.candidateA.selectedCatalogItemId)) {
    throw new Error('Candidate A selected target is unreachable')
  }
  validateCandidateB(scenario, catalog)

  const simulation = scenario.simulation
  for (const key of ['targetTrials', 'distributionDraws', 'collectionCohorts', 'horizonWeeks']) {
    integer(simulation[key], `simulation.${key}`, 1)
  }
  for (const key of ['targetSeed', 'distributionSeed', 'collectionSeed']) {
    integer(simulation[key], `simulation.${key}`, 1)
    if (simulation[key] > 0xffff_ffff) throw new Error(`${key} must fit an unsigned 32-bit seed`)
  }
  integer(simulation.statisticalTolerancePpm, 'simulation.statisticalTolerancePpm', 1)
  if (simulation.statisticalTolerancePpm >= MILLION) throw new Error('Statistical tolerance must be below one million ppm')
  const checkpoints = simulation.completionCheckpointsWeeks
  if (!Array.isArray(checkpoints) || checkpoints[0] !== 0 || checkpoints.at(-1) !== simulation.horizonWeeks) {
    throw new Error('Completion checkpoints must include week zero and the full horizon')
  }
  checkpoints.forEach((week, index) => {
    integer(week, `completion checkpoint ${index}`)
    if (index > 0 && week <= checkpoints[index - 1]) throw new Error('Completion checkpoints must increase')
  })
  const allCatalogIds = new Set(catalog.items.map(item => item.id))
  requireCatalogItems(uniqueStrings(scenario.initialOwnedCatalogItemIds, 'initial ownership', true), new Map([...allCatalogIds].map(id => [id, true])), 'initial ownership')
  const free = scenario.freeCadence
  if (free.weeklyStars !== 1600) throw new Error('Free cadence must model exactly 1600 weekly promotional Stars')
  if (free.passport.durationWeeks !== 12 || free.passport.rewardCountPerWeek !== 1) {
    throw new Error('Collection-first passport must award one unowned standard per week for 12 weeks')
  }
  const catalogItems = catalogIndex(catalog)
  const passportIds = uniqueStrings(free.passport.eligibleCatalogItemIds, 'passport pool')
  const communityIds = uniqueStrings(free.communityClaim.eligibleCatalogItemIds, 'community pool')
  requireCatalogItems(passportIds, catalogItems, 'passport pool')
  requireCatalogItems(communityIds, catalogItems, 'community pool')
  const standardIds = new Set(scenario.candidateB.tiers.find(tier => tier.tierId === 'standard').catalogItemIds)
  if ([...passportIds].some(itemId => !standardIds.has(itemId))) {
    throw new Error('Passport rewards must come from the frozen Candidate B standard pool')
  }
  if ([...communityIds].some(itemId => catalogItems.get(itemId).rarity !== 'mythic')) {
    throw new Error('Community direct claims must remain outside paid random acquisition')
  }
  if (free.communityClaim.intervalWeeks !== 4 || free.communityClaim.rewardCount !== 1) {
    throw new Error('Community cadence must award one direct claim every four weeks')
  }
  if (free.passport.selection !== 'lowest-canonical-id-unowned' || free.communityClaim.selection !== 'lowest-canonical-id-unowned') {
    throw new Error('Free named-item cadence must use deterministic canonical selection')
  }
  if (free.passport.whenAllOwned !== 'no-item' || free.communityClaim.whenAllOwned !== 'no-item') {
    throw new Error('Free named-item cadence must disclose the exhausted-pool no-item outcome')
  }
  const alternatives = scenario.acquisitionAlternatives
  const routeMix = Object.values(alternatives.routeMixBasisPoints).reduce((sum, value) => sum + value, 0)
  if (routeMix !== 10_000) throw new Error(`Acquisition route mix totals ${routeMix}, expected 10000 basis points`)
  if (Object.values(alternatives.directPurchaseStarsByCandidate).some(value => value <= 0) ||
      Object.values(alternatives.craftingCostShardsByCandidate).some(value => value <= 0)) {
    throw new Error('Direct purchase and crafting must be positive deterministic alternatives')
  }
  integer(alternatives.modeledUsers, 'acquisitionAlternatives.modeledUsers', 1)
  const content = scenario.contentProduction
  integer(content.perpetualUnownedRewardIntervalWeeks, 'contentProduction.perpetualUnownedRewardIntervalWeeks', 1)
  integer(content.plannedNewSkusPerYear, 'contentProduction.plannedNewSkusPerYear')
  integer(content.productionCostCentsPerSku, 'contentProduction.productionCostCentsPerSku', 1)
  integer(content.annualContentBudgetCents, 'contentProduction.annualContentBudgetCents')
  return scenario
}

export function createSeededRng(seed) {
  integer(seed, 'RNG seed', 1)
  let state = seed >>> 0
  return {
    nextUint32() {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      return state
    },
    randomInt(maxExclusive) {
      integer(maxExclusive, 'randomInt maximum', 1)
      if (maxExclusive > UINT32_RANGE) throw new Error('randomInt maximum exceeds uint32 range')
      const maximum = BigInt(maxExclusive)
      const threshold = (0x1_0000_0000n - maximum) % maximum
      for (;;) {
        const product = BigInt(this.nextUint32()) * maximum
        if ((product & 0xffff_ffffn) >= threshold) return Number(product >> 32n)
      }
    },
  }
}

function weightedChoice(entries, weight, rng) {
  const total = entries.reduce((sum, entry) => sum + weight(entry), 0)
  if (total <= 0) throw new Error('Weighted choice has no reachable entries')
  let cursor = rng.randomInt(total)
  for (const entry of entries) {
    cursor -= weight(entry)
    if (cursor < 0) return entry
  }
  throw new Error('Weighted choice exhausted unexpectedly')
}

function candidateAProfile(contract, selectedCatalogItemId) {
  return {
    key: 'candidateA',
    candidateId: contract.contractId,
    familyId: contract.banner.familyId,
    currency: contract.currency,
    tiers: contract.banner.paidRandom.tiers.map(tier => ({
      tierId: tier.rarity,
      rank: RARITY_RANK.get(tier.rarity),
      weightUnits: tier.weightUnits,
      items: tier.items.map(item => ({ ...item, tierId: tier.rarity, rank: RARITY_RANK.get(tier.rarity) })),
    })),
    targetId: selectedCatalogItemId,
    featuredIds: contract.banner.guarantees.selectedFeatured.featuredCatalogItemIds,
    selectedHardPull: contract.banner.guarantees.selectedFeatured.hardGuaranteePull,
    batchRareMinimumRank: RARITY_RANK.get(contract.banner.guarantees.rareOrBetterTenPull.minimumRarity),
    duplicateShards: item => contract.duplicateConversion.amountByRarity[item.tierId],
  }
}

export function candidateBProfile(candidate) {
  return {
    key: 'candidateB',
    candidateId: candidate.candidateId,
    familyId: candidate.familyId,
    compatibleBannerIds: candidate.compatibleBannerIds,
    currency: candidate.currency,
    tiers: candidate.tiers.map(tier => ({
      tierId: tier.tierId,
      rank: tier.rank,
      weightUnits: tier.weightUnits,
      items: tier.catalogItemIds.map(catalogItemId => ({
        catalogItemId,
        weightUnits: 1,
        tierId: tier.tierId,
        rank: tier.rank,
      })),
    })),
    featuredIds: candidate.guarantees.selectedFeaturedUnowned.featuredCatalogItemIds,
    guarantees: candidate.guarantees,
    duplicateShards: item => candidate.duplicateShardsByTier[item.tierId],
  }
}

export function drawBaseResult(profile, rng, minimumRank = 0) {
  const tiers = profile.tiers.filter(tier => tier.rank >= minimumRank)
  const tier = weightedChoice(tiers, entry => entry.weightUnits, rng)
  const item = weightedChoice(tier.items, entry => entry.weightUnits, rng)
  return { ...item, reason: 'base' }
}

export function initialCandidateBState(familyId, bannerId) {
  return { familyId, bannerId, pulls: 0, rareMisses: 0, epicMisses: 0, selectedMisses: 0 }
}

export function carryCandidateBState(profile, state, nextBannerId) {
  if (!profile.compatibleBannerIds.includes(nextBannerId)) {
    throw new Error(`Banner ${nextBannerId} is not compatible with ${profile.familyId}`)
  }
  return state.familyId === profile.familyId
    ? { ...state, bannerId: nextBannerId }
    : initialCandidateBState(profile.familyId, nextBannerId)
}

function lowestUnowned(ids, owned) {
  return [...ids].sort(compareStrings).find(itemId => !owned.has(itemId))
}

export function resolveCandidateBPull(profile, state, owned, draw = drawBaseResult, rng = undefined) {
  const selectedId = lowestUnowned(profile.featuredIds, owned)
  const selectedDue = selectedId && state.selectedMisses + 1 >= profile.guarantees.selectedFeaturedUnowned.hardGuaranteePull
  const epicDue = state.epicMisses + 1 >= profile.guarantees.epicOrBetter.hardGuaranteePull
  const rareDue = state.rareMisses + 1 >= profile.guarantees.rareOrBetter.hardGuaranteePull
  let result
  if (selectedDue) {
    const tier = profile.tiers.find(entry => entry.catalogItemIds?.includes?.(selectedId) || entry.items.some(item => item.catalogItemId === selectedId))
    result = { catalogItemId: selectedId, tierId: tier.tierId, rank: tier.rank, weightUnits: 1, reason: 'selected-guarantee' }
  } else if (epicDue) {
    result = { ...draw(profile, rng, profile.guarantees.epicOrBetter.minimumRank), reason: 'epic-guarantee' }
  } else if (rareDue) {
    result = { ...draw(profile, rng, profile.guarantees.rareOrBetter.minimumRank), reason: 'rare-guarantee' }
  } else {
    result = draw(profile, rng, 0)
  }
  const selectedAwarded = selectedId !== undefined && result.catalogItemId === selectedId
  const nextState = {
    ...state,
    pulls: state.pulls + 1,
    rareMisses: result.rank >= 1 ? 0 : state.rareMisses + 1,
    epicMisses: result.rank >= 2 ? 0 : state.epicMisses + 1,
    selectedMisses: selectedAwarded ? 0 : state.selectedMisses + 1,
  }
  return { result, state: nextState, selectedId }
}

function resolveCandidateAPull(profile, state, batch, position, owned, rng) {
  const selectedId = state.selectedId ?? profile.targetId
  const selectedDue = state.selectedMisses + 1 >= profile.selectedHardPull
  let result = drawBaseResult(profile, rng)
  if (selectedDue) {
    const tier = profile.tiers.find(entry => entry.items.some(item => item.catalogItemId === selectedId))
    result = { catalogItemId: selectedId, tierId: tier.tierId, rank: tier.rank, weightUnits: 1, reason: 'selected-guarantee' }
  } else if (position === 10 && !batch.hasRare && result.rank < profile.batchRareMinimumRank) {
    result = { ...drawBaseResult(profile, rng, profile.batchRareMinimumRank), reason: 'rare-batch-guarantee' }
  }
  const selectedAwarded = result.catalogItemId === selectedId
  return {
    result,
    state: {
      ...state,
      pulls: state.pulls + 1,
      selectedMisses: selectedAwarded ? 0 : state.selectedMisses + 1,
    },
    batch: { hasRare: batch.hasRare || result.rank >= profile.batchRareMinimumRank },
  }
}

function award(result, owned, profile) {
  const duplicate = owned.has(result.catalogItemId)
  if (!duplicate) owned.add(result.catalogItemId)
  return { duplicate, shards: duplicate ? profile.duplicateShards(result) : 0 }
}

function debitStars(cost, promotionalAvailable) {
  const promotional = Math.min(cost, promotionalAvailable)
  return { promotional, paid: cost - promotional }
}

function summarizeTargetTrials(profile, scenario, candidateKey) {
  const rng = createSeededRng(scenario.simulation.targetSeed + (candidateKey === 'candidateA' ? 0 : 1))
  const pullCounts = []
  const purchasedPullCounts = []
  const reasonCounts = {}
  let totalDuplicates = 0
  let totalShards = 0
  let totalPromotionalStars = 0
  let totalPaidStars = 0

  for (let trial = 0; trial < scenario.simulation.targetTrials; trial += 1) {
    const owned = new Set(scenario.initialOwnedCatalogItemIds)
    let firstTargetPull
    let pulls = 0
    let purchasedPulls = 0
    let state

    if (candidateKey === 'candidateA') {
      state = { pulls: 0, selectedMisses: 0, selectedId: profile.targetId }
      while (firstTargetPull === undefined) {
        let batch = { hasRare: false }
        purchasedPulls += 10
        for (let position = 1; position <= 10; position += 1) {
          const resolved = resolveCandidateAPull(profile, state, batch, position, owned, rng)
          state = resolved.state
          batch = resolved.batch
          pulls += 1
          const acquisition = award(resolved.result, owned, profile)
          totalDuplicates += Number(acquisition.duplicate)
          totalShards += acquisition.shards
          reasonCounts[resolved.result.reason] = (reasonCounts[resolved.result.reason] ?? 0) + 1
          if (resolved.result.catalogItemId === profile.targetId && firstTargetPull === undefined) {
            firstTargetPull = pulls
          }
        }
      }
    } else {
      state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
      while (firstTargetPull === undefined) {
        const resolved = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
        state = resolved.state
        pulls += 1
        purchasedPulls += 1
        const acquisition = award(resolved.result, owned, profile)
        totalDuplicates += Number(acquisition.duplicate)
        totalShards += acquisition.shards
        reasonCounts[resolved.result.reason] = (reasonCounts[resolved.result.reason] ?? 0) + 1
        if (resolved.result.catalogItemId === resolved.selectedId) firstTargetPull = pulls
      }
    }

    const cost = candidateKey === 'candidateA'
      ? (purchasedPulls / 10) * profile.currency.tenPullCost
      : purchasedPulls * profile.currency.singlePullCost
    const debit = debitStars(cost, scenario.simulation.promotionalStarsPerTargetTrial)
    totalPromotionalStars += debit.promotional
    totalPaidStars += debit.paid
    pullCounts.push(firstTargetPull)
    purchasedPullCounts.push(purchasedPulls)
  }

  pullCounts.sort((left, right) => left - right)
  purchasedPullCounts.sort((left, right) => left - right)
  const trials = scenario.simulation.targetTrials
  const quantile = (values, numerator, denominator) => values[Math.ceil(values.length * numerator / denominator) - 1]
  const totalFirstPulls = pullCounts.reduce((sum, value) => sum + value, 0)
  const totalPurchasedPulls = purchasedPullCounts.reduce((sum, value) => sum + value, 0)
  const meanPurchasedPullsMilli = Math.round(totalPurchasedPulls * 1000 / trials)
  const singleCost = profile.currency.singlePullCost
  const meanCostStars = candidateKey === 'candidateA'
    ? Math.round((totalPurchasedPulls / 10) * profile.currency.tenPullCost / trials)
    : Math.round(totalPurchasedPulls * singleCost / trials)
  const resolutionCounts = Object.fromEntries(Object.entries(reasonCounts).sort(([left], [right]) => compareStrings(left, right)))
  const pityActivationCounts = Object.fromEntries(Object.entries(resolutionCounts).filter(([reason]) => reason !== 'base'))
  const histogram = values => Object.fromEntries(
    [...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map())]
      .sort(([left], [right]) => left - right)
      .map(([value, count]) => [String(value), count]),
  )
  return {
    trials,
    seed: scenario.simulation.targetSeed + (candidateKey === 'candidateA' ? 0 : 1),
    purchaseMode: candidateKey === 'candidateA' ? 'ten-pull-batches' : 'single-pulls',
    selectedTargetPolicy: candidateKey === 'candidateA'
      ? `fixed:${profile.targetId}`
      : 'lowest-canonical-id-unowned',
    expectedFirstAwardPullsMilli: Math.round(totalFirstPulls * 1000 / trials),
    expectedPurchasedPullsMilli: meanPurchasedPullsMilli,
    selectedCost: {
      expectedStars: meanCostStars,
      p50Stars: candidateKey === 'candidateA'
        ? (quantile(purchasedPullCounts, 1, 2) / 10) * profile.currency.tenPullCost
        : quantile(purchasedPullCounts, 1, 2) * singleCost,
      p90Stars: candidateKey === 'candidateA'
        ? (quantile(purchasedPullCounts, 9, 10) / 10) * profile.currency.tenPullCost
        : quantile(purchasedPullCounts, 9, 10) * singleCost,
      capStars: candidateKey === 'candidateA'
        ? 3 * profile.currency.tenPullCost
        : profile.guarantees.selectedFeaturedUnowned.hardGuaranteePull * singleCost,
    },
    selectedAwardPullDistribution: histogram(pullCounts),
    purchasedPullDistribution: histogram(purchasedPullCounts),
    resolutionCounts,
    pityActivationCounts,
    duplicates: {
      total: totalDuplicates,
      perTrialMilli: Math.round(totalDuplicates * 1000 / trials),
      shardsTotal: totalShards,
      shardsPerPurchasedPullMilli: totalPurchasedPulls === 0 ? 0 : Math.round(totalShards * 1000 / totalPurchasedPulls),
    },
    currencyBurn: {
      promotionalStarsTotal: totalPromotionalStars,
      paidStarsTotal: totalPaidStars,
      debitPolicy: 'promotional-before-paid',
    },
  }
}

function probabilityRecord(numerator, denominator) {
  const exact = exactProbability(numerator, denominator)
  return { exact, ppm: Math.round(exact.numerator * MILLION / exact.denominator) }
}

function disclosureForProfile(profile) {
  const rarityProbabilities = profile.tiers.map(tier => ({
    tierId: tier.tierId,
    weightUnits: tier.weightUnits,
    probability: probabilityRecord(tier.weightUnits, profile.tiers.reduce((sum, entry) => sum + entry.weightUnits, 0)),
  }))
  const itemProbabilities = profile.tiers.flatMap(tier => {
    const itemWeight = tier.items.reduce((sum, item) => sum + item.weightUnits, 0)
    const scale = profile.tiers.reduce((sum, entry) => sum + entry.weightUnits, 0)
    return tier.items.map(item => ({
      catalogItemId: item.catalogItemId,
      tierId: tier.tierId,
      probability: probabilityRecord(tier.weightUnits * item.weightUnits, scale * itemWeight),
    }))
  })
  return {
    candidateId: profile.candidateId,
    purpose: 'simulation-only',
    runtimeConsumption: 'forbidden',
    currency: profile.currency,
    baseRandom: { rarityProbabilities, itemProbabilities },
    guarantees: profile.key === 'candidateA'
      ? {
          rareOrBetterTenPull: { minimumRank: profile.batchRareMinimumRank, hardGuaranteePull: 10, scope: 'purchased-ten-pull-batch' },
          selectedFeatured: { hardGuaranteePull: profile.selectedHardPull, lossPath: 'none', counterScope: 'banner-family' },
        }
      : {
          ...profile.guarantees,
          resolutionPrecedence: ['selectedFeaturedUnowned', 'epicOrBetter', 'rareOrBetter', 'base'],
          epicReachability: 'epic pity is reachable after the finite selected-featured pool is exhausted',
        },
  }
}

function distributionValidation(profile, scenario, candidateOffset) {
  const draws = scenario.simulation.distributionDraws
  const rng = createSeededRng(scenario.simulation.distributionSeed + candidateOffset)
  const tierCounts = new Map(profile.tiers.map(tier => [tier.tierId, 0]))
  const itemCounts = new Map(profile.tiers.flatMap(tier => tier.items.map(item => [item.catalogItemId, 0])))
  for (let draw = 0; draw < draws; draw += 1) {
    const result = drawBaseResult(profile, rng)
    tierCounts.set(result.tierId, tierCounts.get(result.tierId) + 1)
    itemCounts.set(result.catalogItemId, itemCounts.get(result.catalogItemId) + 1)
  }
  const disclosure = disclosureForProfile(profile)
  const compare = (expected, count) => {
    const observedPpm = Math.round(count * MILLION / draws)
    return {
      ...expected,
      observedCount: count,
      observedPpm,
      absoluteDeviationPpm: Math.abs(observedPpm - expected.probability.ppm),
    }
  }
  const tierResults = disclosure.baseRandom.rarityProbabilities.map(entry => compare(entry, tierCounts.get(entry.tierId)))
  const itemResults = disclosure.baseRandom.itemProbabilities.map(entry => compare(entry, itemCounts.get(entry.catalogItemId)))
  const maximumDeviationPpm = Math.max(...tierResults.map(entry => entry.absoluteDeviationPpm))
  return {
    draws,
    seed: scenario.simulation.distributionSeed + candidateOffset,
    tolerancePpm: scenario.simulation.statisticalTolerancePpm,
    validationScope: 'tier-rollups',
    maximumDeviationPpm,
    passed: maximumDeviationPpm <= scenario.simulation.statisticalTolerancePpm,
    tiers: tierResults,
    namedItems: itemResults,
  }
}

function deterministicFreeAward(ids, owned) {
  const itemId = lowestUnowned(ids, owned)
  if (itemId) owned.add(itemId)
  return itemId
}

function simulateCollection(profile, scenario, candidateKey, completeCatalogIds) {
  const cohorts = scenario.simulation.collectionCohorts
  const rng = createSeededRng(scenario.simulation.collectionSeed + (candidateKey === 'candidateA' ? 0 : 1))
  const checkpoints = new Map(scenario.simulation.completionCheckpointsWeeks.map(week => [week, {
    ownedTotal: 0,
    complete: 0,
    standardPoolExhausted: 0,
    communityPoolExhausted: 0,
  }]))
  let totalDuplicates = 0
  let totalShards = 0
  let promotionalStarsBurned = 0
  let paidStarsBurned = 0
  const pityCounts = {}
  const aEvergreen = scenario.freeCadence.passport.eligibleCatalogItemIds
  const bPassport = scenario.freeCadence.passport
  const community = scenario.freeCadence.communityClaim

  for (let cohort = 0; cohort < cohorts; cohort += 1) {
    const owned = new Set(scenario.initialOwnedCatalogItemIds)
    let state = candidateKey === 'candidateA'
      ? { pulls: 0, selectedMisses: 0, selectedId: lowestUnowned(profile.featuredIds, owned) }
      : initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
    const record = week => {
      const checkpoint = checkpoints.get(week)
      checkpoint.ownedTotal += owned.size
      checkpoint.complete += Number(completeCatalogIds.every(itemId => owned.has(itemId)))
      checkpoint.standardPoolExhausted += Number(aEvergreen.every(itemId => owned.has(itemId)))
      checkpoint.communityPoolExhausted += Number(
        candidateKey === 'candidateB' && community.eligibleCatalogItemIds.every(itemId => owned.has(itemId)),
      )
    }
    record(0)

    for (let week = 1; week <= scenario.simulation.horizonWeeks; week += 1) {
      if (candidateKey === 'candidateA') {
        state.selectedId = lowestUnowned(profile.featuredIds, owned) ?? profile.featuredIds[0]
        let batch = { hasRare: false }
        for (let position = 1; position <= 10; position += 1) {
          const resolved = resolveCandidateAPull(profile, state, batch, position, owned, rng)
          state = resolved.state
          batch = resolved.batch
          const acquisition = award(resolved.result, owned, profile)
          totalDuplicates += Number(acquisition.duplicate)
          totalShards += acquisition.shards
          pityCounts[resolved.result.reason] = (pityCounts[resolved.result.reason] ?? 0) + 1
        }
        deterministicFreeAward(aEvergreen, owned)
      } else {
        for (let position = 0; position < 10; position += 1) {
          const resolved = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
          state = resolved.state
          const acquisition = award(resolved.result, owned, profile)
          totalDuplicates += Number(acquisition.duplicate)
          totalShards += acquisition.shards
          pityCounts[resolved.result.reason] = (pityCounts[resolved.result.reason] ?? 0) + 1
        }
        if (week <= bPassport.durationWeeks) {
          for (let reward = 0; reward < bPassport.rewardCountPerWeek; reward += 1) {
            deterministicFreeAward(bPassport.eligibleCatalogItemIds, owned)
          }
        }
        if (week % community.intervalWeeks === 0) {
          for (let reward = 0; reward < community.rewardCount; reward += 1) {
            deterministicFreeAward(community.eligibleCatalogItemIds, owned)
          }
        }
      }
      const weeklyDebit = debitStars(profile.currency.tenPullCost, scenario.freeCadence.weeklyStars)
      promotionalStarsBurned += weeklyDebit.promotional
      paidStarsBurned += weeklyDebit.paid
      if (checkpoints.has(week)) record(week)
    }
  }
  const resolutionCounts = Object.fromEntries(
    Object.entries(pityCounts).sort(([left], [right]) => compareStrings(left, right)),
  )
  return {
    cohorts,
    seed: scenario.simulation.collectionSeed + (candidateKey === 'candidateA' ? 0 : 1),
    horizonWeeks: scenario.simulation.horizonWeeks,
    totalCatalogItems: completeCatalogIds.length,
    completionCurve: [...checkpoints].map(([week, value]) => ({
      week,
      meanOwnedMilli: Math.round(value.ownedTotal * 1000 / cohorts),
      noUnownedProbabilityPpm: Math.round(value.complete * MILLION / cohorts),
      noEligibleStandardRewardProbabilityPpm: Math.round(
        value.standardPoolExhausted * MILLION / cohorts,
      ),
      noEligibleCommunityRewardProbabilityPpm: candidateKey === 'candidateB'
        ? Math.round(value.communityPoolExhausted * MILLION / cohorts)
        : null,
    })),
    duplicates: {
      total: totalDuplicates,
      perCohortMilli: Math.round(totalDuplicates * 1000 / cohorts),
      shardsTotal: totalShards,
      shardsPerCohortMilli: Math.round(totalShards * 1000 / cohorts),
    },
    resolutionCounts,
    pityActivationCounts: Object.fromEntries(Object.entries(resolutionCounts).filter(([reason]) => reason !== 'base')),
    currencyBurn: { promotionalStarsBurned, paidStarsBurned, debitPolicy: 'promotional-before-paid' },
    freeNamedItems: candidateKey === 'candidateA'
      ? { cadence: 'weekly-perpetual-unowned-standard', exhaustedOutcome: 'no-item' }
      : { cadence: '12-week-passport-plus-four-week-community-claim', exhaustedOutcome: 'no-item' },
  }
}

function acquisitionAlternatives(scenario, candidateKey, targetResult) {
  const alternatives = scenario.acquisitionAlternatives
  const directStars = alternatives.directPurchaseStarsByCandidate[candidateKey]
  const craftShards = alternatives.craftingCostShardsByCandidate[candidateKey]
  const shardsPerPullMilli = targetResult.duplicates.shardsPerPurchasedPullMilli
  const craftPulls = shardsPerPullMilli === 0
    ? null
    : Math.ceil(craftShards * 1000 / shardsPerPullMilli)
  const craftStars = craftPulls === null ? null : craftPulls * 160
  const users = alternatives.modeledUsers
  const mix = alternatives.routeMixBasisPoints
  const randomUsers = users * mix.randomPulls / 10_000
  const directUsers = users * mix.directPurchase / 10_000
  const craftingUsers = users * mix.crafting / 10_000
  const randomStars = Math.round(randomUsers * targetResult.selectedCost.expectedStars)
  const directRouteStars = Math.round(directUsers * directStars)
  const craftingRouteStars = craftStars === null ? null : Math.round(craftingUsers * craftStars)
  return {
    directPurchase: {
      priceStars: directStars,
      savingsVsExpectedRandomStars: targetResult.selectedCost.expectedStars - directStars,
    },
    deterministicCrafting: {
      costShards: craftShards,
      observedShardsPerPullMilli: shardsPerPullMilli,
      estimatedPullsToCraft: craftPulls,
      estimatedStarsToCraft: craftStars,
      estimateBasis: 'fixed-seed target-trial duplicate yield',
    },
    routeMix: {
      modeledUsers: users,
      basisPoints: mix,
      randomRouteCannibalizationPpm: MILLION - mix.randomPulls * 100,
      randomStars,
      directRouteStars,
      craftingRouteStars,
      totalModeledStars: craftingRouteStars === null ? null : randomStars + directRouteStars + craftingRouteStars,
    },
  }
}

function contentThroughput(scenario) {
  const content = scenario.contentProduction
  const requiredAnnualSkus = Math.ceil(52 / content.perpetualUnownedRewardIntervalWeeks)
  const requiredAnnualCost = requiredAnnualSkus * content.productionCostCentsPerSku
  const plannedAnnualCost = content.plannedNewSkusPerYear * content.productionCostCentsPerSku
  const passport = scenario.freeCadence.passport
  const initiallyOwned = new Set(scenario.initialOwnedCatalogItemIds)
  const passportCapacity = passport.eligibleCatalogItemIds.filter(itemId => !initiallyOwned.has(itemId)).length
  return {
    perpetualWeeklyNewSkuPromise: {
      intervalWeeks: content.perpetualUnownedRewardIntervalWeeks,
      requiredAnnualSkus,
      plannedAnnualSkus: content.plannedNewSkusPerYear,
      annualSkuDeficit: Math.max(0, requiredAnnualSkus - content.plannedNewSkusPerYear),
      requiredAnnualCostCents: requiredAnnualCost,
      plannedAnnualCostCents: plannedAnnualCost,
      annualBudgetCents: content.annualContentBudgetCents,
      sustainable: content.plannedNewSkusPerYear >= requiredAnnualSkus && requiredAnnualCost <= content.annualContentBudgetCents,
      decision: 'rejected',
      reason: 'planned SKU throughput and budget cannot sustain a perpetual weekly-new entitlement',
    },
    boundedPassport: {
      durationWeeks: passport.durationWeeks,
      promisedRewards: passport.durationWeeks * passport.rewardCountPerWeek,
      initiallyUnownedEligibleItems: passportCapacity,
      requiresNewSkusDuringEdition: passportCapacity < passport.durationWeeks * passport.rewardCountPerWeek,
      exhaustedOutcome: passport.whenAllOwned,
    },
  }
}

function buildReport(rootDir, scenario, catalog, candidateAContract, scenarioPath, contractPath, disclosurePath) {
  const profileA = candidateAProfile(candidateAContract, scenario.candidateA.selectedCatalogItemId)
  const profileB = candidateBProfile(scenario.candidateB)
  const targetA = summarizeTargetTrials(profileA, scenario, 'candidateA')
  const targetB = summarizeTargetTrials(profileB, scenario, 'candidateB')
  const completeCatalogIds = [...new Set([
    ...profileB.tiers.flatMap(tier => tier.items.map(item => item.catalogItemId)),
    ...scenario.freeCadence.communityClaim.eligibleCatalogItemIds,
  ])].sort(compareStrings)
  const distributionA = distributionValidation(profileA, scenario, 0)
  const distributionB = distributionValidation(profileB, scenario, 1)
  if (!distributionA.passed || !distributionB.passed) {
    throw new Error(
      `Fixed-seed statistical validation exceeded the configured tier tolerance: Candidate A ${distributionA.maximumDeviationPpm}ppm; Candidate B ${distributionB.maximumDeviationPpm}ppm`,
    )
  }
  return {
    reportVersion: 1,
    scenarioId: scenario.scenarioId,
    generatedFrom: path.relative(rootDir, scenarioPath).replaceAll(path.sep, '/'),
    purpose: 'simulation-only',
    runtimeConsumption: 'forbidden',
    reproducibility: {
      algorithm: 'xorshift32-with-rejection-sampled-integer-selection',
      scenarioSha256: sha256(fs.readFileSync(scenarioPath)),
      candidateASourceSha256: sha256(fs.readFileSync(contractPath)),
      candidateADisclosureSha256: sha256(fs.readFileSync(disclosurePath)),
      seeds: {
        targetCandidateA: scenario.simulation.targetSeed,
        targetCandidateB: scenario.simulation.targetSeed + 1,
        distributionCandidateA: scenario.simulation.distributionSeed,
        distributionCandidateB: scenario.simulation.distributionSeed + 1,
        collectionCandidateA: scenario.simulation.collectionSeed,
        collectionCandidateB: scenario.simulation.collectionSeed + 1,
      },
    },
    disclosures: {
      candidateA: disclosureForProfile(profileA),
      candidateB: disclosureForProfile(profileB),
    },
    targetAcquisition: { candidateA: targetA, candidateB: targetB },
    statisticalValidation: { candidateA: distributionA, candidateB: distributionB },
    collectionCompletion: {
      candidateA: simulateCollection(profileA, scenario, 'candidateA', completeCatalogIds),
      candidateB: simulateCollection(profileB, scenario, 'candidateB', completeCatalogIds),
    },
    alternatives: {
      candidateA: acquisitionAlternatives(scenario, 'candidateA', targetA),
      candidateB: acquisitionAlternatives(scenario, 'candidateB', targetB),
    },
    contentThroughput: contentThroughput(scenario),
    comparison: {
      expectedSelectedCostDeltaStars: targetB.selectedCost.expectedStars - targetA.selectedCost.expectedStars,
      selectedCostCapDeltaStars: targetB.selectedCost.capStars - targetA.selectedCost.capStars,
      conclusion: 'Candidate B lowers the hard selected-item cap and replaces the perpetual weekly-new promise with a bounded passport.',
    },
  }
}

export function simulationPaths(rootDir = ROOT_DIR) {
  return {
    rootDir,
    scenariosDir: path.join(rootDir, 'economy', 'simulations', 'scenarios'),
    reportsDir: path.join(rootDir, 'economy', 'simulations', 'reports'),
    catalogPath: path.join(rootDir, 'src', 'generated', 'collectibleCatalog.json'),
  }
}

export function loadSimulationScenarios(rootDir = ROOT_DIR) {
  const paths = simulationPaths(rootDir)
  const fileNames = fs.readdirSync(paths.scenariosDir)
    .filter(fileName => fileName.endsWith('.json'))
    .sort(compareStrings)
  if (fileNames.length === 0) throw new Error('No economy simulation scenarios found')
  const catalog = readJson(paths.catalogPath)
  const scenarios = fileNames.map((fileName, index) => {
    const match = fileName.match(SCENARIO_PATTERN)
    if (!match) throw new Error(`Invalid economy simulation scenario filename ${fileName}`)
    const version = index + 1
    if (Number(match[1]) !== version) throw new Error('Economy simulation scenarios must use contiguous versions')
    const scenarioPath = path.join(paths.scenariosDir, fileName)
    const scenario = readJson(scenarioPath)
    if (scenario.scenarioVersion !== version || match[2] !== scenario.slug) {
      throw new Error(`Economy scenario ${fileName} has an invalid version or slug`)
    }
    const contractPath = path.join(rootDir, scenario.candidateA.sourceContract)
    const disclosurePath = path.join(rootDir, scenario.candidateA.sourceDisclosure)
    if (!fs.existsSync(contractPath) || !fs.existsSync(disclosurePath)) {
      throw new Error(`${fileName} references a missing Candidate A source artifact`)
    }
    const candidateAContract = readJson(contractPath)
    validateSimulationScenario(scenario, catalog, candidateAContract)
    return { fileName, scenarioPath, scenario, candidateAContract, contractPath, disclosurePath }
  })
  const referencedReports = new Set(scenarios.map(({ scenario }) => scenario.reportArtifact))
  const orphaned = fs.existsSync(paths.reportsDir)
    ? fs.readdirSync(paths.reportsDir)
      .filter(fileName => fileName.endsWith('.json'))
      .map(fileName => `economy/simulations/reports/${fileName}`)
      .filter(fileName => !referencedReports.has(fileName))
    : []
  if (orphaned.length > 0) throw new Error(`Economy simulation reports lack scenarios: ${orphaned.join(', ')}`)
  return { paths, catalog, scenarios }
}

export function generateEconomySimulationReports({ rootDir = ROOT_DIR, writeNew = false } = {}) {
  const { paths, catalog, scenarios } = loadSimulationScenarios(rootDir)
  const generated = []
  for (const entry of scenarios) {
    const report = buildReport(
      rootDir,
      entry.scenario,
      catalog,
      entry.candidateAContract,
      entry.scenarioPath,
      entry.contractPath,
      entry.disclosurePath,
    )
    const expected = serialize(report)
    const outputPath = path.join(rootDir, entry.scenario.reportArtifact)
    if (!fs.existsSync(outputPath)) {
      if (!writeNew) throw new Error(`Missing economy simulation report ${entry.scenario.reportArtifact}`)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, expected)
      generated.push(entry.scenario.reportArtifact)
    } else if (fs.readFileSync(outputPath, 'utf8') !== expected) {
      throw new Error(`Published economy simulation report ${entry.scenario.reportArtifact} differs; append a new scenario version instead`)
    }
  }
  return { count: scenarios.length, generated, paths }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--check', '--write-new'].includes(args[0])) {
    throw new Error('Usage: economy-simulator.js --check | --write-new')
  }
  const result = generateEconomySimulationReports({ writeNew: args[0] === '--write-new' })
  const prefix = result.generated.length > 0
    ? `Generated ${result.generated.length} new report(s); verified`
    : 'Verified'
  console.log(`${prefix} ${result.count} immutable economy simulation scenario(s)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
