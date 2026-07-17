#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.join(__dirname, '..')
const POSTGRES_INTEGER_MAX = 2_147_483_647

export const ECONOMY_DISCLOSURE_VERSION = 1
export const ECONOMY_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
]

const REQUIRED_RANDOM_RARITIES = ECONOMY_RARITIES.filter(rarity => rarity !== 'mythic')
const CONTRACT_FILE_PATTERN = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/
const RUNTIME_SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.rs'])

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertKeys(value, expectedKeys, label) {
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
  if (!Number.isSafeInteger(value) || value < minimum || value > POSTGRES_INTEGER_MAX) {
    throw new Error(`${label} must be an integer from ${minimum} to ${POSTGRES_INTEGER_MAX}`)
  }
  return value
}

function assertIntegerNumbers(value, label = 'Economy contract') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} may only use fixed-scale safe integers`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertIntegerNumbers(entry, `${label}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      assertIntegerNumbers(entry, `${label}.${key}`)
    })
  }
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array`)
  }
  const unique = new Set()
  values.forEach((value, index) => {
    assertString(value, `${label}[${index}]`)
    if (unique.has(value)) throw new Error(`${label} contains duplicate ${value}`)
    unique.add(value)
  })
  return unique
}

function assertExactStringSet(values, expected, label) {
  const actual = [...assertUniqueStrings(values, label)].sort(compareStrings)
  const sortedExpected = [...expected].sort(compareStrings)
  if (
    actual.length !== sortedExpected.length ||
    actual.some((value, index) => value !== sortedExpected[index])
  ) {
    throw new Error(`${label} must contain exactly: ${sortedExpected.join(', ')}`)
  }
}

function rarityRank(rarity) {
  const rank = ECONOMY_RARITIES.indexOf(rarity)
  if (rank < 0) throw new Error(`Unknown economy rarity ${rarity}`)
  return rank
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) [a, b] = [b, a % b]
  return a
}

export function exactProbability(numerator, denominator) {
  integer(numerator, 'Probability numerator')
  integer(denominator, 'Probability denominator', 1)
  if (numerator > denominator) {
    throw new Error('Probability numerator cannot exceed its denominator')
  }
  const divisor = greatestCommonDivisor(numerator, denominator)
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  }
}

function displayPercent(probability, decimalPlaces = 6) {
  const scale = 10n ** BigInt(decimalPlaces)
  const scaledNumerator = BigInt(probability.numerator) * 100n * scale
  const denominator = BigInt(probability.denominator)
  const rounded = (scaledNumerator * 2n + denominator) / (2n * denominator)
  const whole = rounded / scale
  const fraction = String(rounded % scale).padStart(decimalPlaces, '0')
  return `${whole}.${fraction}%`
}

function probabilityDisclosure(numerator, denominator) {
  const exact = exactProbability(numerator, denominator)
  return {
    exact,
    displayPercent: displayPercent(exact),
    displayRounding: 'nearest-0.000001-percent',
  }
}

export function economyPaths(rootDir = ROOT_DIR) {
  return {
    rootDir,
    contractsDir: path.join(rootDir, 'economy', 'contracts', 'editions'),
    disclosuresDir: path.join(rootDir, 'economy', 'disclosures'),
    catalogPath: path.join(rootDir, 'src', 'generated', 'collectibleCatalog.json'),
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function catalogIndex(catalog) {
  assertRecord(catalog, 'Collectible catalog')
  if (!Array.isArray(catalog.items) || catalog.items.length === 0) {
    throw new Error('Collectible catalog must contain items')
  }
  return new Map(catalog.items.map(item => [item.id, item]))
}

function validateCurrency(contract) {
  const currency = contract.currency
  assertKeys(
    currency,
    ['currencyId', 'singlePullCost', 'tenPullCost', 'balanceClasses', 'debitPolicy'],
    'currency',
  )
  if (currency.currencyId !== 'stars') throw new Error('Pull currency must be stars')
  integer(currency.singlePullCost, 'currency.singlePullCost', 1)
  integer(currency.tenPullCost, 'currency.tenPullCost', 1)
  if (currency.tenPullCost !== currency.singlePullCost * 10) {
    throw new Error('Ten-pull cost must equal ten single pulls')
  }
  assertExactStringSet(currency.balanceClasses, ['paid', 'promotional'], 'currency.balanceClasses')
  if (currency.debitPolicy !== 'promotional-before-paid') {
    throw new Error('Currency debit policy must preserve paid and promotional balance semantics')
  }
}

function validatePaidRandom(contract, itemsById) {
  const paidRandom = contract.banner.paidRandom
  assertKeys(paidRandom, ['weightScale', 'tiers', 'excludedRarities'], 'banner.paidRandom')
  integer(paidRandom.weightScale, 'banner.paidRandom.weightScale', 1)
  if (!Array.isArray(paidRandom.tiers) || paidRandom.tiers.length === 0) {
    throw new Error('Paid-random banner must contain rarity tiers')
  }
  assertExactStringSet(
    paidRandom.excludedRarities,
    ['mythic'],
    'banner.paidRandom.excludedRarities',
  )

  const seenRarities = new Set()
  const seenItems = new Set()
  let totalWeight = 0

  paidRandom.tiers.forEach((tier, tierIndex) => {
    assertKeys(tier, ['rarity', 'weightUnits', 'items'], `banner.paidRandom.tiers[${tierIndex}]`)
    rarityRank(tier.rarity)
    if (seenRarities.has(tier.rarity)) {
      throw new Error(`Paid-random rarity ${tier.rarity} appears more than once`)
    }
    if (paidRandom.excludedRarities.includes(tier.rarity)) {
      throw new Error(`Excluded rarity ${tier.rarity} cannot appear in paid-random tiers`)
    }
    seenRarities.add(tier.rarity)
    totalWeight += integer(tier.weightUnits, `Weight for ${tier.rarity}`, 1)

    if (!Array.isArray(tier.items) || tier.items.length === 0) {
      throw new Error(`Paid-random rarity ${tier.rarity} must contain at least one item`)
    }
    tier.items.forEach((entry, itemIndex) => {
      assertKeys(
        entry,
        ['catalogItemId', 'weightUnits'],
        `banner.paidRandom.tiers[${tierIndex}].items[${itemIndex}]`,
      )
      const itemId = assertString(entry.catalogItemId, `Catalog item at ${tier.rarity}[${itemIndex}]`)
      integer(entry.weightUnits, `Item weight for ${itemId}`, 1)
      if (seenItems.has(itemId)) throw new Error(`Paid-random item ${itemId} appears more than once`)
      seenItems.add(itemId)
      const catalogItem = itemsById.get(itemId)
      if (!catalogItem) throw new Error(`Paid-random pool references unknown catalog item ${itemId}`)
      if (catalogItem.rarity !== tier.rarity) {
        throw new Error(`Paid-random item ${itemId} is not ${tier.rarity} in the canonical catalog`)
      }
    })
  })

  assertExactStringSet([...seenRarities], REQUIRED_RANDOM_RARITIES, 'Paid-random rarities')
  if (totalWeight !== paidRandom.weightScale) {
    throw new Error(
      `Paid-random rarity weights total ${totalWeight}, expected scale ${paidRandom.weightScale}`,
    )
  }
  for (const item of itemsById.values()) {
    if (item.rarity === 'mythic' && seenItems.has(item.id)) {
      throw new Error(`Mythic item ${item.id} cannot enter a paid-random tier`)
    }
  }
  return { seenItems, seenRarities }
}

function validateGuarantees(contract, paidRandomState) {
  const guarantees = contract.banner.guarantees
  assertKeys(guarantees, ['rareOrBetterTenPull', 'selectedFeatured'], 'banner.guarantees')

  const tenPull = guarantees.rareOrBetterTenPull
  assertKeys(
    tenPull,
    [
      'windowPulls',
      'windowScope',
      'singlePullBehavior',
      'rollingBehavior',
      'reset',
      'minimumRarity',
      'trigger',
      'replacementDistribution',
    ],
    'rareOrBetterTenPull',
  )
  integer(tenPull.windowPulls, 'rareOrBetterTenPull.windowPulls', 1)
  if (tenPull.windowPulls !== 10) throw new Error('Rare-or-better guarantee must use a ten-pull window')
  if (tenPull.windowScope !== 'purchased-ten-pull-batch') {
    throw new Error('Rare-or-better guarantee must be scoped to one purchased ten-pull batch')
  }
  if (tenPull.singlePullBehavior !== 'does-not-advance-or-satisfy-window') {
    throw new Error('Single pulls must not advance or satisfy the ten-pull guarantee window')
  }
  if (tenPull.rollingBehavior !== 'does-not-carry-between-purchases') {
    throw new Error('Ten-pull guarantee windows must not roll across purchases')
  }
  if (tenPull.reset !== 'after-each-purchased-ten-pull-batch') {
    throw new Error('Ten-pull guarantee state must reset after every purchased ten-pull batch')
  }
  if (tenPull.trigger !== 'replace-final-pull-if-window-misses') {
    throw new Error('Rare-or-better guarantee must trigger on the final pull of a missing window')
  }
  if (tenPull.replacementDistribution !== 'base-weights-conditioned-on-minimum-rarity') {
    throw new Error('Rare-or-better replacement must condition the disclosed base weights')
  }
  const minimumRank = rarityRank(tenPull.minimumRarity)
  const reachableRarity = [...paidRandomState.seenRarities]
    .some(rarity => rarityRank(rarity) >= minimumRank)
  if (!reachableRarity) throw new Error('Rare-or-better guarantee has no reachable eligible rarity')

  const featured = guarantees.selectedFeatured
  assertKeys(
    featured,
    [
      'featuredCatalogItemIds',
      'selection',
      'hardGuaranteePull',
      'trigger',
      'lossPath',
      'counterScope',
      'carryFamilyId',
      'reset',
    ],
    'selectedFeatured',
  )
  const featuredIds = assertUniqueStrings(
    featured.featuredCatalogItemIds,
    'selectedFeatured.featuredCatalogItemIds',
  )
  for (const itemId of featuredIds) {
    if (!paidRandomState.seenItems.has(itemId)) {
      throw new Error(`Featured item ${itemId} is inaccessible from the paid-random pool`)
    }
  }
  integer(featured.hardGuaranteePull, 'selectedFeatured.hardGuaranteePull', 1)
  if (featured.trigger !== 'replace-pull-at-counter-if-selected-not-awarded') {
    throw new Error('Featured guarantee must replace the pull at the disclosed hard counter')
  }
  if (featured.selection !== 'player-selected-before-pull') {
    throw new Error('Featured guarantee must use an explicit player-selected item')
  }
  if (featured.lossPath !== 'none') throw new Error('Featured guarantee cannot have a 50/50 loss path')
  if (featured.counterScope !== 'banner-family') {
    throw new Error('Featured guarantee counter must be scoped to the banner family')
  }
  if (featured.carryFamilyId !== contract.banner.familyId) {
    throw new Error('Featured guarantee carry family must match banner.familyId')
  }
  if (featured.reset !== 'selected-featured-awarded') {
    throw new Error('Featured guarantee may reset only when the selected featured item is awarded')
  }
}

function validateFreeCadence(contract, itemsById) {
  const cadence = contract.freeCadence
  assertKeys(
    cadence,
    ['dailyBank', 'weeklyFlexibleBonus', 'weeklyStarBudget', 'weeklyUnownedEvergreen'],
    'freeCadence',
  )

  const daily = cadence.dailyBank
  assertKeys(
    daily,
    ['accrualPeriodDays', 'capacityDays', 'claimOrder', 'streakLoss', 'rewardPerAccrual'],
    'freeCadence.dailyBank',
  )
  integer(daily.accrualPeriodDays, 'dailyBank.accrualPeriodDays', 1)
  integer(daily.capacityDays, 'dailyBank.capacityDays', 1)
  if (daily.capacityDays !== 7) throw new Error('Daily reward bank must hold seven days')
  if (daily.claimOrder !== 'oldest-first') throw new Error('Daily reward bank must claim oldest first')
  if (daily.streakLoss !== false) throw new Error('Daily reward bank cannot use streak loss')
  assertKeys(daily.rewardPerAccrual, ['currencyId', 'amount'], 'dailyBank.rewardPerAccrual')
  if (daily.rewardPerAccrual.currencyId !== contract.currency.currencyId) {
    throw new Error('Daily reward currency must match the pull currency')
  }
  integer(daily.rewardPerAccrual.amount, 'dailyBank.rewardPerAccrual.amount', 1)

  const bonus = cadence.weeklyFlexibleBonus
  assertKeys(bonus, ['intervalDays', 'reward'], 'freeCadence.weeklyFlexibleBonus')
  integer(bonus.intervalDays, 'weeklyFlexibleBonus.intervalDays', 1)
  assertKeys(bonus.reward, ['currencyId', 'amount'], 'weeklyFlexibleBonus.reward')
  if (bonus.reward.currencyId !== contract.currency.currencyId) {
    throw new Error('Weekly bonus currency must match the pull currency')
  }
  integer(bonus.reward.amount, 'weeklyFlexibleBonus.reward.amount')

  const budget = cadence.weeklyStarBudget
  assertKeys(budget, ['periodDays', 'totalAmount'], 'freeCadence.weeklyStarBudget')
  integer(budget.periodDays, 'weeklyStarBudget.periodDays', 1)
  integer(budget.totalAmount, 'weeklyStarBudget.totalAmount', 1)
  if (budget.periodDays % daily.accrualPeriodDays !== 0) {
    throw new Error('Weekly budget period must contain a whole number of daily accruals')
  }
  if (bonus.intervalDays !== budget.periodDays) {
    throw new Error('Weekly bonus interval must match the weekly budget period')
  }
  const dailyClaims = budget.periodDays / daily.accrualPeriodDays
  const computedBudget = dailyClaims * daily.rewardPerAccrual.amount + bonus.reward.amount
  if (computedBudget !== budget.totalAmount) {
    throw new Error(`Weekly Stars components total ${computedBudget}, expected ${budget.totalAmount}`)
  }

  const evergreen = cadence.weeklyUnownedEvergreen
  assertKeys(
    evergreen,
    [
      'intervalDays',
      'rewardCount',
      'eligibleRarities',
      'catalogItemIds',
      'selection',
      'whenAllOwned',
    ],
    'freeCadence.weeklyUnownedEvergreen',
  )
  integer(evergreen.intervalDays, 'weeklyUnownedEvergreen.intervalDays', 1)
  integer(evergreen.rewardCount, 'weeklyUnownedEvergreen.rewardCount', 1)
  assertExactStringSet(
    evergreen.eligibleRarities,
    ['common', 'uncommon'],
    'weeklyUnownedEvergreen.eligibleRarities',
  )
  const evergreenIds = assertUniqueStrings(
    evergreen.catalogItemIds,
    'weeklyUnownedEvergreen.catalogItemIds',
  )
  for (const itemId of evergreenIds) {
    const catalogItem = itemsById.get(itemId)
    if (!catalogItem) throw new Error(`Weekly evergreen pool references unknown catalog item ${itemId}`)
    if (!evergreen.eligibleRarities.includes(catalogItem.rarity)) {
      throw new Error(`Weekly evergreen item ${itemId} has ineligible rarity ${catalogItem.rarity}`)
    }
  }
  if (evergreen.selection !== 'lowest-canonical-id-unowned') {
    throw new Error('Weekly unowned reward must use deterministic canonical selection')
  }
  if (evergreen.whenAllOwned !== 'no-item') {
    throw new Error('Weekly unowned reward must disclose the exhausted-pool no-item outcome')
  }
}

function validateDuplicateConversion(contract) {
  const duplicates = contract.duplicateConversion
  assertKeys(duplicates, ['currencyId', 'mode', 'amountByRarity'], 'duplicateConversion')
  if (duplicates.currencyId !== 'shards') throw new Error('Duplicate currency must be shards')
  if (duplicates.mode !== 'fixed-by-rarity') {
    throw new Error('Duplicate conversion must be deterministic and fixed by rarity')
  }
  assertRecord(duplicates.amountByRarity, 'duplicateConversion.amountByRarity')
  const amountRarities = Object.keys(duplicates.amountByRarity)
  assertExactStringSet(amountRarities, ECONOMY_RARITIES, 'Duplicate conversion rarities')
  for (const rarity of ECONOMY_RARITIES) {
    integer(duplicates.amountByRarity[rarity], `Duplicate amount for ${rarity}`)
  }
}

function validateAcquisitionPolicy(contract) {
  const policy = contract.acquisitionPolicy
  assertKeys(policy, ['randomOnly', 'requiredNamedItemRoutes'], 'acquisitionPolicy')
  if (policy.randomOnly !== false) throw new Error('Random pulls cannot be the only named-item route')
  assertExactStringSet(
    policy.requiredNamedItemRoutes,
    ['direct-purchase', 'deterministic-shard-crafting'],
    'acquisitionPolicy.requiredNamedItemRoutes',
  )
}

export function validateEconomyContract(contract, catalog, sourceFileName = undefined) {
  assertKeys(
    contract,
    [
      'contractVersion',
      'contractId',
      'slug',
      'purpose',
      'catalogContractVersion',
      'disclosureArtifact',
      'currency',
      'banner',
      'freeCadence',
      'duplicateConversion',
      'acquisitionPolicy',
    ],
    'Economy contract',
  )
  assertIntegerNumbers(contract)
  integer(contract.contractVersion, 'contractVersion', 1)
  assertString(contract.slug, 'slug')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.slug)) {
    throw new Error('Economy contract slug must be lowercase kebab-case')
  }
  if (contract.contractId !== `${contract.slug}@${contract.contractVersion}`) {
    throw new Error('Economy contract id must be <slug>@<contractVersion>')
  }
  if (contract.purpose !== 'simulation-only') {
    throw new Error('Economy contracts must remain simulation-only')
  }
  integer(contract.catalogContractVersion, 'catalogContractVersion', 1)
  if (contract.catalogContractVersion !== catalog.contractVersion) {
    throw new Error('Economy contract targets a different collectible catalog envelope version')
  }
  const expectedArtifact = `economy/disclosures/${String(contract.contractVersion).padStart(4, '0')}-${contract.slug}.json`
  if (contract.disclosureArtifact !== expectedArtifact) {
    throw new Error(`Economy disclosure artifact must be ${expectedArtifact}`)
  }
  if (sourceFileName) {
    const expectedSource = `${String(contract.contractVersion).padStart(4, '0')}-${contract.slug}.json`
    if (sourceFileName !== expectedSource) {
      throw new Error(`Economy contract filename must be ${expectedSource}`)
    }
  }

  assertKeys(contract.banner, ['bannerId', 'familyId', 'paidRandom', 'guarantees'], 'banner')
  assertString(contract.banner.bannerId, 'banner.bannerId')
  assertString(contract.banner.familyId, 'banner.familyId')
  validateCurrency(contract)
  const paidRandomState = validatePaidRandom(contract, catalogIndex(catalog))
  validateGuarantees(contract, paidRandomState)
  validateFreeCadence(contract, catalogIndex(catalog))
  validateDuplicateConversion(contract)
  validateAcquisitionPolicy(contract)
  return contract
}

export function buildEconomyDisclosure(contract, catalog, sourcePath) {
  validateEconomyContract(contract, catalog, path.basename(sourcePath))
  const itemProbabilities = []
  const rarityProbabilities = []

  for (const tier of contract.banner.paidRandom.tiers) {
    const tierItemWeight = tier.items.reduce((sum, item) => sum + item.weightUnits, 0)
    rarityProbabilities.push({
      rarity: tier.rarity,
      weightUnits: tier.weightUnits,
      probability: probabilityDisclosure(tier.weightUnits, contract.banner.paidRandom.weightScale),
    })
    for (const item of tier.items) {
      itemProbabilities.push({
        catalogItemId: item.catalogItemId,
        rarity: tier.rarity,
        itemWeightUnits: item.weightUnits,
        probability: probabilityDisclosure(
          tier.weightUnits * item.weightUnits,
          contract.banner.paidRandom.weightScale * tierItemWeight,
        ),
      })
    }
  }

  const minimumRank = rarityRank(
    contract.banner.guarantees.rareOrBetterTenPull.minimumRarity,
  )
  const rareOrBetterWeight = contract.banner.paidRandom.tiers
    .filter(tier => rarityRank(tier.rarity) >= minimumRank)
    .reduce((sum, tier) => sum + tier.weightUnits, 0)
  const rareOrBetterTiers = contract.banner.paidRandom.tiers
    .filter(tier => rarityRank(tier.rarity) >= minimumRank)
  const replacementRarityProbabilities = rareOrBetterTiers.map(tier => ({
    rarity: tier.rarity,
    weightUnits: tier.weightUnits,
    probability: probabilityDisclosure(tier.weightUnits, rareOrBetterWeight),
  }))
  const replacementItemProbabilities = rareOrBetterTiers.flatMap(tier => {
    const tierItemWeight = tier.items.reduce((sum, item) => sum + item.weightUnits, 0)
    return tier.items.map(item => ({
      catalogItemId: item.catalogItemId,
      rarity: tier.rarity,
      itemWeightUnits: item.weightUnits,
      probability: probabilityDisclosure(
        tier.weightUnits * item.weightUnits,
        rareOrBetterWeight * tierItemWeight,
      ),
    }))
  })
  const itemProbabilityById = new Map(
    itemProbabilities.map(item => [item.catalogItemId, item.probability]),
  )
  const featuredBaseProbabilities = contract.banner.guarantees.selectedFeatured
    .featuredCatalogItemIds
    .map(catalogItemId => ({
      catalogItemId,
      probability: itemProbabilityById.get(catalogItemId),
    }))

  return {
    disclosureVersion: ECONOMY_DISCLOSURE_VERSION,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    generatedFrom: sourcePath.replaceAll(path.sep, '/'),
    purpose: contract.purpose,
    runtimeConsumption: 'forbidden',
    catalogContractVersion: contract.catalogContractVersion,
    currency: contract.currency,
    paidRandom: {
      bannerId: contract.banner.bannerId,
      familyId: contract.banner.familyId,
      weightScale: contract.banner.paidRandom.weightScale,
      excludedRarities: contract.banner.paidRandom.excludedRarities,
      rarityProbabilities,
      itemProbabilities,
      rareOrBetterBaseProbability: probabilityDisclosure(
        rareOrBetterWeight,
        contract.banner.paidRandom.weightScale,
      ),
      rareOrBetterReplacementProbabilities: {
        distribution: contract.banner.guarantees.rareOrBetterTenPull
          .replacementDistribution,
        rarityProbabilities: replacementRarityProbabilities,
        itemProbabilities: replacementItemProbabilities,
      },
      guarantees: {
        ...contract.banner.guarantees,
        selectedFeatured: {
          ...contract.banner.guarantees.selectedFeatured,
          baseProbabilities: featuredBaseProbabilities,
        },
      },
    },
    freeCadence: contract.freeCadence,
    duplicateConversion: contract.duplicateConversion,
    acquisitionPolicy: contract.acquisitionPolicy,
  }
}

function listFilesRecursively(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath]
  })
}

export function validateNoRuntimeEconomyConsumers(rootDir = ROOT_DIR) {
  const runtimeRoots = [
    path.join(rootDir, 'src'),
    path.join(rootDir, 'server', 'src'),
    path.join(rootDir, 'server', 'core', 'src'),
    path.join(rootDir, 'server', 'wasm', 'src'),
  ]
  const forbiddenReference = /economy[\\/](?:contracts|disclosures)|generate-economy-disclosures/
  const offenders = runtimeRoots.flatMap(runtimeRoot => listFilesRecursively(runtimeRoot))
    .filter(filePath => RUNTIME_SOURCE_EXTENSIONS.has(path.extname(filePath)))
    .filter(filePath => !/\.test\.[cm]?[jt]sx?$/.test(filePath))
    .filter(filePath => forbiddenReference.test(fs.readFileSync(filePath, 'utf8')))
    .map(filePath => path.relative(rootDir, filePath))
  if (offenders.length > 0) {
    throw new Error(
      `Simulation-only economy data cannot be imported by production runtime code: ${offenders.join(', ')}`,
    )
  }
}

export function loadEconomyContracts(rootDir = ROOT_DIR) {
  const paths = economyPaths(rootDir)
  const catalog = readJson(paths.catalogPath)
  const contractFileNames = fs.readdirSync(paths.contractsDir)
    .filter(fileName => fileName.endsWith('.json'))
    .sort(compareStrings)
  if (contractFileNames.length === 0) throw new Error('No economy contract editions found')

  const contracts = contractFileNames.map((fileName, index) => {
    const match = fileName.match(CONTRACT_FILE_PATTERN)
    if (!match) throw new Error(`Invalid economy contract filename ${fileName}`)
    const expectedVersion = index + 1
    if (Number(match[1]) !== expectedVersion) {
      throw new Error('Economy contract editions must use contiguous version numbers')
    }
    const contract = readJson(path.join(paths.contractsDir, fileName))
    validateEconomyContract(contract, catalog, fileName)
    if (contract.contractVersion !== expectedVersion) {
      throw new Error(`Economy contract ${fileName} has noncontiguous contractVersion`)
    }
    return { fileName, contract }
  })

  const referencedDisclosures = new Set(contracts.map(({ contract }) => contract.disclosureArtifact))
  const disclosureFileNames = fs.existsSync(paths.disclosuresDir)
    ? fs.readdirSync(paths.disclosuresDir)
    : []
  const orphanedDisclosures = disclosureFileNames
    .filter(fileName => fileName.endsWith('.json'))
    .map(fileName => `economy/disclosures/${fileName}`)
    .filter(filePath => !referencedDisclosures.has(filePath))
  if (orphanedDisclosures.length > 0) {
    throw new Error(`Economy disclosures lack contract editions: ${orphanedDisclosures.join(', ')}`)
  }
  return { paths, catalog, contracts }
}

function serializedDisclosure(disclosure) {
  return `${JSON.stringify(disclosure, null, 2)}\n`
}

export function generateEconomyDisclosures({ rootDir = ROOT_DIR, writeNew = false } = {}) {
  validateNoRuntimeEconomyConsumers(rootDir)
  const { paths, catalog, contracts } = loadEconomyContracts(rootDir)
  const generated = []

  for (const { fileName, contract } of contracts) {
    const relativeSourcePath = `economy/contracts/editions/${fileName}`
    const disclosure = buildEconomyDisclosure(contract, catalog, relativeSourcePath)
    const outputPath = path.join(rootDir, contract.disclosureArtifact)
    const expected = serializedDisclosure(disclosure)

    if (!fs.existsSync(outputPath)) {
      if (!writeNew) {
        throw new Error(`Missing economy disclosure ${contract.disclosureArtifact}`)
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, expected)
      generated.push(contract.disclosureArtifact)
      continue
    }

    const actual = fs.readFileSync(outputPath, 'utf8')
    if (actual !== expected) {
      throw new Error(
        `Published economy disclosure ${contract.disclosureArtifact} differs from its contract; append a new version instead`,
      )
    }
  }

  return { count: contracts.length, generated, paths }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--check', '--write-new'].includes(args[0])) {
    throw new Error('Usage: generate-economy-disclosures.js --check | --write-new')
  }
  const result = generateEconomyDisclosures({ writeNew: args[0] === '--write-new' })
  const action = result.generated.length > 0
    ? `Generated ${result.generated.length} new disclosure artifact(s); verified`
    : 'Verified'
  console.log(`${action} ${result.count} immutable economy contract edition(s)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
