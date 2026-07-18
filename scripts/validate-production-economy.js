#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT_DIR = path.resolve(path.dirname(__filename), '..')
const EDITION_FILE_PATTERN = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/
const MIGRATION_FILE_PATTERN = /^\d{4}_earned_economy_[a-z0-9_]+\.sql$/
const EDITION_0001_SHA256 = '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09'

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
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

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function assertExactArray(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} must equal ${JSON.stringify(expected)}`)
  }
}

function assertReward(value, expected, label) {
  assertExactKeys(value, ['currencyId', 'balanceBucket', 'amount'], label)
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new Error(`${label}.${key} must be ${expectedValue}`)
    }
  }
}

function catalogById(catalog) {
  assertRecord(catalog, 'Collectible catalog')
  if (!Array.isArray(catalog.items) || catalog.items.length === 0) {
    throw new Error('Collectible catalog must contain items')
  }
  return new Map(catalog.items.map(item => [item.id, item]))
}

function validateCatalogPool(value, itemsById, allowedRarities, label, globalIds) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must freeze a non-empty catalog pool`)
  }
  const localIds = new Set()
  for (const catalogItemId of value) {
    assertNonEmptyString(catalogItemId, `${label} catalog item id`)
    if (localIds.has(catalogItemId) || globalIds?.has(catalogItemId)) {
      throw new Error(`Duplicate catalog item ${catalogItemId} in ${label}`)
    }
    const item = itemsById.get(catalogItemId)
    if (!item) throw new Error(`${label} references unknown catalog item ${catalogItemId}`)
    if (!allowedRarities.has(item.rarity)) {
      throw new Error(`${catalogItemId} has catalog rarity ${item.rarity}, invalid for ${label}`)
    }
    localIds.add(catalogItemId)
    globalIds?.add(catalogItemId)
  }
  return [...localIds]
}

function validateSchemaV1TierPools(edition, itemsById) {
  const banner = edition.acquisition.banner
  assertExactKeys(
    banner,
    ['bannerId', 'familyId', 'weightScale', 'tiers', 'guarantees'],
    'acquisition.banner',
  )
  assertNonEmptyString(banner.bannerId, 'acquisition.banner.bannerId')
  assertNonEmptyString(banner.familyId, 'acquisition.banner.familyId')
  assertPositiveInteger(banner.weightScale, 'acquisition.banner.weightScale')

  const tierDefinitions = [
    ['standard', 0, new Set(['common', 'uncommon'])],
    ['rare', 1, new Set(['rare'])],
    ['epic', 2, new Set(['epic'])],
    ['signature', 3, new Set(['legendary'])],
  ]
  if (!Array.isArray(banner.tiers) || banner.tiers.length !== tierDefinitions.length) {
    throw new Error('Schema-v1 production banner must contain four ordered tiers')
  }

  const allItemIds = new Set()
  const tierItems = new Map()
  banner.tiers.forEach((tier, index) => {
    assertExactKeys(tier, ['tierId', 'rank', 'weightUnits', 'catalogItemIds'], `tier[${index}]`)
    const [tierId, rank, allowedRarities] = tierDefinitions[index]
    if (tier.tierId !== tierId || tier.rank !== rank) {
      throw new Error(`Schema-v1 tier ${index} must be ${tierId}/${rank}`)
    }
    assertPositiveInteger(tier.weightUnits, `tier ${tierId}.weightUnits`)
    tierItems.set(
      tierId,
      validateCatalogPool(
        tier.catalogItemIds,
        itemsById,
        allowedRarities,
        `tier ${tierId}`,
        allItemIds,
      ),
    )
  })
  if (banner.tiers.reduce((sum, tier) => sum + tier.weightUnits, 0) !== banner.weightScale) {
    throw new Error('Schema-v1 production banner tier weights must total the fixed scale')
  }
  return tierItems
}

function validateSchemaV1Guarantees(edition, tierItems) {
  const guarantees = edition.acquisition.banner.guarantees
  assertExactKeys(
    guarantees,
    ['resolutionOrder', 'rareOrBetter', 'epicOrBetter', 'selectedFeaturedUnowned'],
    'banner.guarantees',
  )
  assertExactArray(
    guarantees.resolutionOrder,
    ['selected-featured-unowned', 'epic-or-better', 'rare-or-better', 'base'],
    'guarantee resolution order',
  )
  for (const [key, minimumRank] of [['rareOrBetter', 1], ['epicOrBetter', 2]]) {
    const value = guarantees[key]
    assertExactKeys(value, ['minimumRank', 'hardGuaranteePull', 'counterScope', 'reset'], key)
    assertPositiveInteger(value.hardGuaranteePull, `${key}.hardGuaranteePull`)
    if (
      value.minimumRank !== minimumRank ||
      value.counterScope !== 'banner-family' ||
      value.reset !== 'qualifying-result-awarded'
    ) {
      throw new Error(`${key} violates schema-v1 guarantee semantics`)
    }
  }

  const selected = guarantees.selectedFeaturedUnowned
  assertExactKeys(
    selected,
    [
      'minimumRank',
      'hardGuaranteePull',
      'catalogItemIds',
      'selection',
      'lossPath',
      'softPity',
      'counterScope',
      'reset',
    ],
    'selectedFeaturedUnowned',
  )
  assertPositiveInteger(selected.hardGuaranteePull, 'selectedFeaturedUnowned.hardGuaranteePull')
  if (
    selected.minimumRank !== 3 ||
    selected.selection !== 'lowest-canonical-id-unowned' ||
    selected.lossPath !== 'none' ||
    selected.softPity !== 'none' ||
    selected.counterScope !== 'banner-family' ||
    selected.reset !== 'selected-featured-awarded'
  ) {
    throw new Error('Selected-featured guarantee violates schema-v1 semantics')
  }
  if (!Array.isArray(selected.catalogItemIds) || selected.catalogItemIds.length === 0) {
    throw new Error('Selected featured pool must freeze at least one signature item')
  }
  const signatureIds = new Set(tierItems.get('signature'))
  const selectedIds = new Set()
  for (const catalogItemId of selected.catalogItemIds) {
    if (selectedIds.has(catalogItemId) || !signatureIds.has(catalogItemId)) {
      throw new Error(`Selected featured item ${catalogItemId} must be unique and belong to the signature tier`)
    }
    selectedIds.add(catalogItemId)
  }
}

function validateSchemaV1Reward(value, expectedCurrencyId, expectedBalanceBucket, label) {
  assertExactKeys(value, ['currencyId', 'balanceBucket', 'amount'], label)
  if (value.currencyId !== expectedCurrencyId || value.balanceBucket !== expectedBalanceBucket) {
    throw new Error(`${label} must credit ${expectedBalanceBucket} ${expectedCurrencyId}`)
  }
  assertPositiveInteger(value.amount, `${label}.amount`)
}

function validateSchemaV1Rewards(edition, tierItems, itemsById) {
  assertExactKeys(
    edition.rewards,
    ['weeklyAuthoritativeRolls', 'newCollectorPassport', 'communityDie'],
    'rewards',
  )
  const weekly = edition.rewards.weeklyAuthoritativeRolls
  assertExactKeys(
    weekly,
    [
      'periodDays',
      'authoritativeCompletedRollTarget',
      'maximumRewardedRolls',
      'rewardPerCompletedRoll',
      'maximumPeriodReward',
      'streakLoss',
      'missedDayPenalty',
    ],
    'weeklyAuthoritativeRolls',
  )
  assertPositiveInteger(weekly.periodDays, 'weeklyAuthoritativeRolls.periodDays')
  assertPositiveInteger(
    weekly.authoritativeCompletedRollTarget,
    'weeklyAuthoritativeRolls.authoritativeCompletedRollTarget',
  )
  assertPositiveInteger(weekly.maximumRewardedRolls, 'weeklyAuthoritativeRolls.maximumRewardedRolls')
  validateSchemaV1Reward(
    weekly.rewardPerCompletedRoll,
    'stars',
    'promotional',
    'weeklyAuthoritativeRolls.rewardPerCompletedRoll',
  )
  assertPositiveInteger(weekly.maximumPeriodReward, 'weeklyAuthoritativeRolls.maximumPeriodReward')
  if (
    weekly.authoritativeCompletedRollTarget !== weekly.maximumRewardedRolls ||
    weekly.maximumPeriodReward !== weekly.maximumRewardedRolls * weekly.rewardPerCompletedRoll.amount ||
    weekly.streakLoss !== false ||
    weekly.missedDayPenalty !== false
  ) {
    throw new Error('Schema-v1 weekly rewards must be capped, internally coherent, and non-coercive')
  }

  const passport = edition.rewards.newCollectorPassport
  assertExactKeys(
    passport,
    [
      'durationWeeks',
      'claimsPerWeek',
      'eligibleCatalogItemIds',
      'selection',
      'whenAllOwned',
      'afterWeekTwelve',
    ],
    'newCollectorPassport',
  )
  assertPositiveInteger(passport.durationWeeks, 'newCollectorPassport.durationWeeks')
  assertPositiveInteger(passport.claimsPerWeek, 'newCollectorPassport.claimsPerWeek')
  if (
    passport.selection !== 'lowest-canonical-id-unowned' ||
    passport.afterWeekTwelve !== 'completed-no-further-claims'
  ) {
    throw new Error('Schema-v1 passport must remain finite and deterministic')
  }
  if (!Array.isArray(passport.eligibleCatalogItemIds) || passport.eligibleCatalogItemIds.length === 0) {
    throw new Error('New Collector Passport must freeze a non-empty standard pool')
  }
  const standardIds = new Set(tierItems.get('standard'))
  const passportIds = new Set()
  for (const catalogItemId of passport.eligibleCatalogItemIds) {
    if (passportIds.has(catalogItemId) || !standardIds.has(catalogItemId)) {
      throw new Error(`Passport item ${catalogItemId} must be unique and belong to the standard tier`)
    }
    passportIds.add(catalogItemId)
  }
  validateSchemaV1Reward(passport.whenAllOwned, 'dust', 'earned', 'newCollectorPassport.whenAllOwned')

  const community = edition.rewards.communityDie
  assertExactKeys(
    community,
    ['intervalWeeks', 'claimMode', 'eligibleCatalogItemIds', 'selection', 'whenAllOwned'],
    'communityDie',
  )
  assertPositiveInteger(community.intervalWeeks, 'communityDie.intervalWeeks')
  if (
    community.claimMode !== 'direct-claim' ||
    community.selection !== 'lowest-canonical-id-unowned'
  ) {
    throw new Error('Schema-v1 Community Die must remain a deterministic direct claim')
  }
  validateCatalogPool(
    community.eligibleCatalogItemIds,
    itemsById,
    new Set(['mythic']),
    'communityDie',
  )
  validateSchemaV1Reward(community.whenAllOwned, 'dust', 'earned', 'communityDie.whenAllOwned')
}

function validateSchemaV1DuplicateConversion(edition) {
  const duplicate = edition.duplicateConversion
  assertExactKeys(duplicate, ['currencyId', 'balanceBucket', 'amountByTier'], 'duplicateConversion')
  if (duplicate.currencyId !== 'dust' || duplicate.balanceBucket !== 'earned') {
    throw new Error('Duplicate conversion must credit earned Dust')
  }
  assertExactKeys(
    duplicate.amountByTier,
    ['standard', 'rare', 'epic', 'signature', 'community'],
    'duplicateConversion.amountByTier',
  )
  for (const [tier, amount] of Object.entries(duplicate.amountByTier)) {
    assertPositiveInteger(amount, `duplicateConversion.amountByTier.${tier}`)
  }
}

function validateTierPools(edition, itemsById) {
  const banner = edition.acquisition.banner
  assertExactKeys(
    banner,
    ['bannerId', 'familyId', 'weightScale', 'tiers', 'guarantees'],
    'acquisition.banner',
  )
  if (banner.bannerId !== 'earned-collection-001') throw new Error('Unexpected production banner id')
  if (banner.familyId !== 'earned-collection') throw new Error('Unexpected production banner family')
  if (banner.weightScale !== 100) throw new Error('Production banner weight scale must be 100')

  const expectedTiers = [
    ['standard', 0, 72, new Set(['common', 'uncommon'])],
    ['rare', 1, 23, new Set(['rare'])],
    ['epic', 2, 4, new Set(['epic'])],
    ['signature', 3, 1, new Set(['legendary'])],
  ]
  if (!Array.isArray(banner.tiers) || banner.tiers.length !== expectedTiers.length) {
    throw new Error('Production banner must contain four ordered tiers')
  }

  const allItemIds = new Set()
  const tierItems = new Map()
  banner.tiers.forEach((tier, index) => {
    assertExactKeys(tier, ['tierId', 'rank', 'weightUnits', 'catalogItemIds'], `tier[${index}]`)
    const [tierId, rank, weightUnits, allowedRarities] = expectedTiers[index]
    if (tier.tierId !== tierId || tier.rank !== rank || tier.weightUnits !== weightUnits) {
      throw new Error(`Tier ${index} must be ${tierId}/${rank}/${weightUnits}`)
    }
    if (!Array.isArray(tier.catalogItemIds) || tier.catalogItemIds.length === 0) {
      throw new Error(`Tier ${tierId} must freeze a non-empty catalog pool`)
    }
    const local = new Set()
    for (const catalogItemId of tier.catalogItemIds) {
      if (typeof catalogItemId !== 'string' || local.has(catalogItemId) || allItemIds.has(catalogItemId)) {
        throw new Error(`Duplicate or invalid catalog item ${catalogItemId} in production banner`)
      }
      const item = itemsById.get(catalogItemId)
      if (!item) throw new Error(`Production banner references unknown catalog item ${catalogItemId}`)
      if (!allowedRarities.has(item.rarity)) {
        throw new Error(`${catalogItemId} has catalog rarity ${item.rarity}, invalid for ${tierId}`)
      }
      local.add(catalogItemId)
      allItemIds.add(catalogItemId)
    }
    tierItems.set(tierId, [...local])
  })
  if (banner.tiers.reduce((sum, tier) => sum + tier.weightUnits, 0) !== banner.weightScale) {
    throw new Error('Production banner tier weights must total the fixed scale')
  }
  return tierItems
}

function validateGuarantees(edition, tierItems) {
  const guarantees = edition.acquisition.banner.guarantees
  assertExactKeys(
    guarantees,
    ['resolutionOrder', 'rareOrBetter', 'epicOrBetter', 'selectedFeaturedUnowned'],
    'banner.guarantees',
  )
  assertExactArray(
    guarantees.resolutionOrder,
    ['selected-featured-unowned', 'epic-or-better', 'rare-or-better', 'base'],
    'guarantee resolution order',
  )
  const boundaries = [
    ['rareOrBetter', 1, 8, 'qualifying-result-awarded'],
    ['epicOrBetter', 2, 25, 'qualifying-result-awarded'],
  ]
  for (const [key, minimumRank, hardGuaranteePull, reset] of boundaries) {
    const value = guarantees[key]
    assertExactKeys(value, ['minimumRank', 'hardGuaranteePull', 'counterScope', 'reset'], key)
    if (
      value.minimumRank !== minimumRank ||
      value.hardGuaranteePull !== hardGuaranteePull ||
      value.counterScope !== 'banner-family' ||
      value.reset !== reset
    ) {
      throw new Error(`${key} production boundary is not the selected Candidate B contract`)
    }
  }

  const selected = guarantees.selectedFeaturedUnowned
  assertExactKeys(
    selected,
    [
      'minimumRank',
      'hardGuaranteePull',
      'catalogItemIds',
      'selection',
      'lossPath',
      'softPity',
      'counterScope',
      'reset',
    ],
    'selectedFeaturedUnowned',
  )
  if (
    selected.minimumRank !== 3 ||
    selected.hardGuaranteePull !== 20 ||
    selected.selection !== 'lowest-canonical-id-unowned' ||
    selected.lossPath !== 'none' ||
    selected.softPity !== 'none' ||
    selected.counterScope !== 'banner-family' ||
    selected.reset !== 'selected-featured-awarded'
  ) {
    throw new Error('Selected-featured guarantee is not the selected Candidate B contract')
  }
  assertExactArray(selected.catalogItemIds, tierItems.get('signature'), 'selected featured pool')
}

function validateRewards(edition, tierItems, itemsById) {
  assertExactKeys(
    edition.rewards,
    ['weeklyAuthoritativeRolls', 'newCollectorPassport', 'communityDie'],
    'rewards',
  )
  const weekly = edition.rewards.weeklyAuthoritativeRolls
  assertExactKeys(
    weekly,
    [
      'periodDays',
      'authoritativeCompletedRollTarget',
      'maximumRewardedRolls',
      'rewardPerCompletedRoll',
      'maximumPeriodReward',
      'streakLoss',
      'missedDayPenalty',
    ],
    'weeklyAuthoritativeRolls',
  )
  assertReward(
    weekly.rewardPerCompletedRoll,
    { currencyId: 'stars', balanceBucket: 'promotional', amount: 160 },
    'weeklyAuthoritativeRolls.rewardPerCompletedRoll',
  )
  if (
    weekly.periodDays !== 7 ||
    weekly.authoritativeCompletedRollTarget !== 10 ||
    weekly.maximumRewardedRolls !== 10 ||
    weekly.maximumPeriodReward !== 1600 ||
    weekly.maximumPeriodReward !== weekly.maximumRewardedRolls * weekly.rewardPerCompletedRoll.amount ||
    weekly.streakLoss !== false ||
    weekly.missedDayPenalty !== false
  ) {
    throw new Error('Weekly reward must be ten flexible authoritative rolls worth 160 Stars each')
  }

  const passport = edition.rewards.newCollectorPassport
  assertExactKeys(
    passport,
    [
      'durationWeeks',
      'claimsPerWeek',
      'eligibleCatalogItemIds',
      'selection',
      'whenAllOwned',
      'afterWeekTwelve',
    ],
    'newCollectorPassport',
  )
  if (
    passport.durationWeeks !== 12 ||
    passport.claimsPerWeek !== 1 ||
    passport.selection !== 'lowest-canonical-id-unowned' ||
    passport.afterWeekTwelve !== 'completed-no-further-claims'
  ) {
    throw new Error('New Collector Passport must be one finite claim for each of 12 weeks')
  }
  assertExactArray(passport.eligibleCatalogItemIds, tierItems.get('standard'), 'passport pool')
  assertReward(
    passport.whenAllOwned,
    { currencyId: 'dust', balanceBucket: 'earned', amount: 2 },
    'newCollectorPassport.whenAllOwned',
  )

  const community = edition.rewards.communityDie
  assertExactKeys(
    community,
    ['intervalWeeks', 'claimMode', 'eligibleCatalogItemIds', 'selection', 'whenAllOwned'],
    'communityDie',
  )
  if (
    community.intervalWeeks !== 4 ||
    community.claimMode !== 'direct-claim' ||
    community.selection !== 'lowest-canonical-id-unowned'
  ) {
    throw new Error('Community Die must be a direct claim every four weeks')
  }
  if (!Array.isArray(community.eligibleCatalogItemIds) || community.eligibleCatalogItemIds.length === 0) {
    throw new Error('Community Die must freeze a non-empty item pool')
  }
  const communityIds = new Set()
  for (const catalogItemId of community.eligibleCatalogItemIds) {
    if (communityIds.has(catalogItemId)) throw new Error(`Duplicate community item ${catalogItemId}`)
    const item = itemsById.get(catalogItemId)
    if (!item || item.rarity !== 'mythic') {
      throw new Error(`Community item ${catalogItemId} must be a canonical mythic die`)
    }
    communityIds.add(catalogItemId)
  }
  assertReward(
    community.whenAllOwned,
    { currencyId: 'dust', balanceBucket: 'earned', amount: 50 },
    'communityDie.whenAllOwned',
  )
}

function validateDuplicateConversion(edition) {
  const duplicate = edition.duplicateConversion
  assertExactKeys(duplicate, ['currencyId', 'balanceBucket', 'amountByTier'], 'duplicateConversion')
  if (duplicate.currencyId !== 'dust' || duplicate.balanceBucket !== 'earned') {
    throw new Error('Duplicate conversion must credit earned Dust')
  }
  assertExactKeys(
    duplicate.amountByTier,
    ['standard', 'rare', 'epic', 'signature', 'community'],
    'duplicateConversion.amountByTier',
  )
  const expected = { standard: 2, rare: 8, epic: 20, signature: 50, community: 50 }
  for (const [tier, amount] of Object.entries(expected)) {
    if (duplicate.amountByTier[tier] !== amount) {
      throw new Error(`Duplicate ${tier} conversion must be ${amount} Dust`)
    }
  }
}

function validateSchemaV1ProductionEdition(edition, catalog) {
  assertExactKeys(edition.decisionSource, ['studyId', 'selectedCandidateId'], 'decisionSource')
  assertNonEmptyString(edition.decisionSource.studyId, 'decisionSource.studyId')
  assertNonEmptyString(edition.decisionSource.selectedCandidateId, 'decisionSource.selectedCandidateId')
  assertPositiveInteger(edition.catalogContractVersion, 'catalogContractVersion')
  assertPositiveInteger(catalog.contractVersion, 'Collectible catalog contractVersion')
  if (edition.catalogContractVersion > catalog.contractVersion) {
    throw new Error('Production edition cannot reference a future canonical catalog contract')
  }

  assertExactKeys(
    edition.acquisition,
    ['phase', 'realMoneyEnabled', 'checkoutEnabled', 'currency', 'banner'],
    'acquisition',
  )
  if (
    edition.acquisition.phase !== 'earned-only' ||
    edition.acquisition.realMoneyEnabled !== false ||
    edition.acquisition.checkoutEnabled !== false
  ) {
    throw new Error('Schema-v1 production remains earned-only with money and checkout disabled')
  }
  const currency = edition.acquisition.currency
  assertExactKeys(
    currency,
    ['currencyId', 'balanceBucket', 'singlePullCost', 'tenPullCost'],
    'acquisition.currency',
  )
  if (currency.currencyId !== 'stars' || currency.balanceBucket !== 'promotional') {
    throw new Error('Schema-v1 earned pulls must debit promotional Stars')
  }
  assertPositiveInteger(currency.singlePullCost, 'acquisition.currency.singlePullCost')
  assertPositiveInteger(currency.tenPullCost, 'acquisition.currency.tenPullCost')
  if (currency.tenPullCost !== currency.singlePullCost * 10) {
    throw new Error('Schema-v1 ten-pull cost must equal ten single-pull costs')
  }

  const itemsById = catalogById(catalog)
  const tierItems = validateSchemaV1TierPools(edition, itemsById)
  validateSchemaV1Guarantees(edition, tierItems)
  validateSchemaV1Rewards(edition, tierItems, itemsById)
  validateSchemaV1DuplicateConversion(edition)
}

function validateEdition0001CandidateB(edition, catalog) {
  if (
    edition.decisionSource.studyId !== 'candidate-a-vs-collection-first@1' ||
    edition.decisionSource.selectedCandidateId !== 'collection-first-showcase@1'
  ) {
    throw new Error('Production edition 0001 must select Candidate B from the frozen study')
  }
  if (edition.catalogContractVersion !== 1) {
    throw new Error('Production edition 0001 must bind canonical catalog contract 1')
  }
  const currency = edition.acquisition.currency
  if (
    currency.singlePullCost !== 160 ||
    currency.tenPullCost !== 1600
  ) {
    throw new Error('Production edition 0001 pulls must cost 160/1600 promotional Stars')
  }

  const itemsById = catalogById(catalog)
  const tierItems = validateTierPools(edition, itemsById)
  validateGuarantees(edition, tierItems)
  validateRewards(edition, tierItems, itemsById)
  validateDuplicateConversion(edition)
  if (productionEditionSha256(edition) !== EDITION_0001_SHA256) {
    throw new Error('Production edition 0001 must retain the frozen Candidate B source')
  }
}

const SCHEMA_VERSION_VALIDATORS = new Map([
  [1, validateSchemaV1ProductionEdition],
])

const EDITION_VALIDATORS = new Map([
  [1, validateEdition0001CandidateB],
])

export function canonicalProductionEdition(edition) {
  return JSON.stringify(edition)
}

export function productionEditionSha256(edition) {
  return crypto.createHash('sha256').update(canonicalProductionEdition(edition)).digest('hex')
}

export function productionEconomyPaths(rootDir = ROOT_DIR) {
  return {
    rootDir,
    editionsDir: path.join(rootDir, 'economy', 'production', 'editions'),
    migrationsDir: path.join(rootDir, 'supabase', 'migrations'),
    catalogPath: path.join(rootDir, 'src', 'generated', 'collectibleCatalog.json'),
  }
}

export function validateProductionEdition(edition, catalog, fileName) {
  assertExactKeys(
    edition,
    [
      'schemaVersion',
      'edition',
      'editionId',
      'slug',
      'purpose',
      'migration',
      'decisionSource',
      'catalogContractVersion',
      'acquisition',
      'rewards',
      'duplicateConversion',
    ],
    fileName,
  )
  assertPositiveInteger(edition.schemaVersion, `${fileName}.schemaVersion`)
  if (edition.purpose !== 'production') throw new Error(`${fileName} must be a production edition`)
  assertPositiveInteger(edition.edition, `${fileName}.edition`)
  if (typeof edition.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition.slug)) {
    throw new Error(`${fileName}.slug must be a canonical kebab-case identifier`)
  }
  if (edition.editionId !== `${edition.slug}@${edition.edition}`) {
    throw new Error(`${fileName} editionId must bind slug and edition`)
  }
  if (!MIGRATION_FILE_PATTERN.test(edition.migration)) {
    throw new Error(`${fileName} has an invalid production migration anchor`)
  }

  const schemaValidator = SCHEMA_VERSION_VALIDATORS.get(edition.schemaVersion)
  if (!schemaValidator) {
    throw new Error(`${fileName} uses unsupported production schemaVersion ${edition.schemaVersion}`)
  }
  schemaValidator(edition, catalog, fileName)
  EDITION_VALIDATORS.get(edition.edition)?.(edition, catalog, fileName)
}

function validateMigrationAnchor(edition, migrationSql, expectedSha256, fileName) {
  const editionMarker = String(edition.edition).padStart(4, '0')
  const embedded = migrationSql.match(
    new RegExp(
      `-- BEGIN EARNED ECONOMY EDITION ${editionMarker}\\s*\\$edition\\$([\\s\\S]*?)` +
      `\\$edition\\$::jsonb\\s*-- END EARNED ECONOMY EDITION ${editionMarker}`,
      'i',
    ),
  )
  if (!embedded) throw new Error(`${fileName} migration is missing its generated edition block`)
  let embeddedEdition
  try {
    embeddedEdition = JSON.parse(embedded[1])
  } catch (error) {
    throw new Error(`${fileName} migration embeds invalid edition JSON: ${error.message}`)
  }
  if (canonicalProductionEdition(embeddedEdition) !== canonicalProductionEdition(edition)) {
    throw new Error(`${fileName} migration edition JSON differs from its source edition`)
  }
  const hashMatch = migrationSql.match(
    /expected_sha256\s+constant\s+text\s*:=\s*'([0-9a-f]{64})'/i,
  )
  if (!hashMatch || hashMatch[1] !== expectedSha256) {
    throw new Error(`${fileName} migration source hash differs from its production edition`)
  }
}

export function validateProductionEconomy({ rootDir = ROOT_DIR } = {}) {
  const paths = productionEconomyPaths(rootDir)
  const catalog = JSON.parse(fs.readFileSync(paths.catalogPath, 'utf8'))
  const fileNames = fs.readdirSync(paths.editionsDir)
    .filter(fileName => fileName.endsWith('.json'))
    .sort(compareStrings)
  if (fileNames.length === 0) throw new Error('No production economy editions found')

  const referencedMigrations = new Set()
  const editions = fileNames.map((fileName, index) => {
    const match = fileName.match(EDITION_FILE_PATTERN)
    if (!match) throw new Error(`Invalid production economy filename ${fileName}`)
    const expectedEdition = index + 1
    const edition = JSON.parse(fs.readFileSync(path.join(paths.editionsDir, fileName), 'utf8'))
    if (
      Number(match[1]) !== expectedEdition ||
      edition.edition !== expectedEdition ||
      fileName !== `${String(expectedEdition).padStart(4, '0')}-${edition.slug}.json`
    ) {
      throw new Error('Production economy editions must be contiguous and match their filenames')
    }
    validateProductionEdition(edition, catalog, fileName)
    if (referencedMigrations.has(edition.migration)) {
      throw new Error(`Production economy migration ${edition.migration} is referenced twice`)
    }
    referencedMigrations.add(edition.migration)
    const migrationPath = path.join(paths.migrationsDir, edition.migration)
    if (!fs.existsSync(migrationPath)) throw new Error(`${fileName} references a missing migration`)
    const sha256 = productionEditionSha256(edition)
    validateMigrationAnchor(edition, fs.readFileSync(migrationPath, 'utf8'), sha256, fileName)
    return { fileName, edition, sha256 }
  })

  const orphanedMigrations = fs.readdirSync(paths.migrationsDir)
    .filter(fileName => MIGRATION_FILE_PATTERN.test(fileName))
    .filter(fileName => !referencedMigrations.has(fileName))
  if (orphanedMigrations.length > 0) {
    throw new Error(`Production economy migrations lack edition manifests: ${orphanedMigrations.join(', ')}`)
  }
  return { editions }
}

function main() {
  const result = validateProductionEconomy()
  console.log(`Verified ${result.editions.length} immutable production economy edition(s)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
