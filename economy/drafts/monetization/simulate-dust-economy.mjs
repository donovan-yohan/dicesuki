#!/usr/bin/env node
// DRAFT / SIMULATION-ONLY — monetization economy spec (2026-07-22 / rev 2026-07-23).
//
// Sizes the three joint Dust values the ADR-017 discrete-copy inventory needs but
// left TBD: per-tier `dupe_dust`, `scrap_yield`, and `craft_cost`. It reuses the
// repo's OWN pity-resolution engine exported from scripts/economy-simulator.js
// (createSeededRng, candidateBProfile, drawBaseResult, initialCandidateBState,
// resolveCandidateBPull) — the exact same primitives the frozen
// candidate-a-vs-collection-first@1 study and simulate-premium-pity.mjs drive.
// NO engine math is re-implemented here: this driver only (a) builds a candidate
// profile from the REAL production edition (economy/production/editions/
// 0001-earned-collection.json) so it inherits the real tier weights, pool sizes,
// and 8/25/20 pity, (b) runs long collector pull streams, and (c) does closed-form
// Dust arithmetic on the measured pull statistics.
//
// Run: node economy/drafts/monetization/simulate-dust-economy.mjs
//
// ===========================================================================
// AUDIT LEDGER — changes from the prior 457-line draft (2026-07-23)
// ===========================================================================
// CHANGED:
//   - Replaced the "pure scrapper" base-weight arithmetic with an engine-driven
//     pity-aware stream. An always-unowned player re-arms selected-featured pity,
//     so base weights alone were not the realized distribution.
//   - Relabeled the requested late-game result as the CONDITIONAL all-owned /
//     all-duplicate ceiling. It is the task's binding comparator, not a claim
//     that no live-count manipulation could alter tier frequency; scrap-driven
//     featured re-chase remains an open product rule in the source spec.
//   - Made native-acquisition parity strict (`craft_cost / D_FARM_MAX >
//     expected pulls for the same specific die`) to match ADR 017's "MUST
//     exceed", and print each tier's plugged-in inequality and margin.
//   - Priced signature directly against both its standard-pool specific-copy
//     rate and the premium hard-75 chase; removed the prior ambiguity that only
//     a separate premium/collab class was craft-excluded.
//   - Corrected wording that called the epic price "the same" as pull parity:
//     the recommendation is deliberately above it, with a printed margin.
//   - Focused-review P1: added an adverse exact-engine stream that owns every
//     pool item except one signature and scraps that target immediately, thereby
//     re-arming selected pity. `D_FARM_MAX` is the larger of that measured rate
//     and `D_ALL_DUPE`; anti-arbitrage now uses this conservative divisor.
//   - First focused pass raised epic craft 600 -> 610 and signature 2400 -> 2500
//     after the fixed-owned stream invalidated their prior margins; the final
//     dynamic pass below supersedes the 610 interim value.
//   - Final focused-review P1: added the stronger dynamic selected-pity farm.
//     It stays fully owned until selectedMisses reaches hard-1, scraps one
//     signature, takes the immediate guaranteed replacement, and repeats.
//     `D_FARM_MAX` now includes this 5,000,000-pull exact-engine stream.
//   - Added final safety buffers: craft 210/220/615/2500. Epic remains within
//     the binding 4-12 week all-dupe pace while every native floor stays strict.
//   - Rev 2 statistical audit: removed the pity-drained 300-pull
//     post-completion tail as the `P_late` estimator. `P_late` now comes from a
//     dedicated 24,000,000-pull all-owned stream, independent of collection
//     completion. Batch means quantify serial dependence; per-tier probability
//     SE is the larger of batch-means and binomial SE.
//   - Rev 2 farm audit: sweeps dynamic signature-scrap triggers
//     19/25/20/21/30/40/60, publishes a batch-means SE for each, selects the
//     maximum trigger, then estimates its `D_FARM_MAX` in an independent 10M
//     validation stream.
//   - Rev 2 uncertainty audit: propagates independent `D_FARM_MAX` and `P_late`
//     SE into every per-tier native floor and prints each Dust margin plus
//     margin/SE. The epic pace and signature hard-75 checks also print their
//     stochastic margins in SE units.
// KEPT AFTER AUDIT:
//   - Exact imports of all five required economy-engine exports; no pull/pity
//     math is reimplemented.
//   - Production-edition-derived tier weights, item pools, and 8/25/20 pity.
//   - Per-player owned-set tracking, so duplicate probability evolves by tier
//     with collection completion rather than using a flat duplicate rate.
//   - Double-dip accounting and the split-baseline 1/4/10/25 + 1/4/10/25,
//     which preserves the prior effective 2/8/20/50 duplicate faucet.
//   - >=100k fixed-seed Monte Carlo sizing and the 10-standard-pulls/week faucet.
//
// ===========================================================================
// WHAT THIS ANSWERS (spec §1.6, §6.1 deltas 10-13, §7 three-way validation; ADR
// 017 "Discrete-copy dice inventory"):
//   1. Duplicate rate vs collection completion for the STANDARD pool (real tiers/
//      weights/pity), early-game (empty) through late-game (near-complete).
//   2. Expected Dust income per pull as a function of collection state, for
//      candidate (dupe_dust, scrap_yield) sets, COUNTING THE DOUBLE-DIP (a
//      duplicate grants dupe_dust AND a spawnable copy that is itself scrappable
//      for scrap_yield -> effective per-duplicate Dust = dupe_dust + scrap_yield).
//   3. The required late-game all-owned/all-duplicate Dust-per-pull CEILING:
//      dupe_dust + scrap_yield of that tier, weighted by the realized
//      (pity-shifted) tier distribution.
//   4. Craft-cost floors per tier + the binding anti-arbitrage inequality actually
//      used, derived and stated (see BINDING INEQUALITIES section at the bottom of
//      the printout and the header comment on RECOMMENDED below).
//   5. One recommended value set (dupe_dust, scrap_yield, craft_cost per tier).
// ===========================================================================
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSeededRng,
  candidateBProfile,
  drawBaseResult,
  initialCandidateBState,
  resolveCandidateBPull,
} from '../../../scripts/economy-simulator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDITION_PATH = path.join(__dirname, '../../production/editions/0001-earned-collection.json')

// Tier order / index used throughout (matches rank 0..3 in the edition banner).
const TIER_IDS = ['standard', 'rare', 'epic', 'signature']

// ---------------------------------------------------------------------------
// Build the candidate profile FROM the real production edition. Same shape
// candidateBProfile expects (see scripts/economy-simulator.js candidateBProfile);
// the only field rename is guarantees.selectedFeaturedUnowned.catalogItemIds ->
// featuredCatalogItemIds. Weights, pool sizes, and 8/25/20 pity are read as-is.
// ---------------------------------------------------------------------------
function buildStandardProfile() {
  const edition = JSON.parse(readFileSync(EDITION_PATH, 'utf8'))
  const banner = edition.acquisition.banner
  const g = banner.guarantees
  const candidate = {
    candidateId: edition.editionId,
    familyId: banner.familyId,
    compatibleBannerIds: [banner.bannerId],
    currency: {
      currencyId: 'stars',
      singlePullCost: edition.acquisition.currency.singlePullCost,
      tenPullCost: edition.acquisition.currency.tenPullCost,
      balanceClasses: ['promotional'],
      debitPolicy: 'promotional-before-paid',
    },
    tiers: banner.tiers.map(t => ({
      tierId: t.tierId,
      rank: t.rank,
      weightUnits: t.weightUnits,
      catalogItemIds: t.catalogItemIds,
    })),
    guarantees: {
      rareOrBetter: { minimumRank: g.rareOrBetter.minimumRank, hardGuaranteePull: g.rareOrBetter.hardGuaranteePull },
      epicOrBetter: { minimumRank: g.epicOrBetter.minimumRank, hardGuaranteePull: g.epicOrBetter.hardGuaranteePull },
      selectedFeaturedUnowned: {
        minimumRank: g.selectedFeaturedUnowned.minimumRank,
        hardGuaranteePull: g.selectedFeaturedUnowned.hardGuaranteePull,
        featuredCatalogItemIds: g.selectedFeaturedUnowned.catalogItemIds,
      },
    },
    duplicateShardsByTier: edition.duplicateConversion.amountByTier,
  }
  const profile = candidateBProfile(candidate)
  const poolItemIds = [...new Set(profile.tiers.flatMap(t => t.items.map(i => i.catalogItemId)))]
  const tierSizes = profile.tiers.map(t => t.items.length)
  const baseWeights = profile.tiers.map(t => t.weightUnits)
  const weightScale = baseWeights.reduce((a, b) => a + b, 0)
  return { edition, profile, poolItemIds, tierSizes, baseWeights, weightScale }
}

// ---------------------------------------------------------------------------
// Monte Carlo: N independent COLLECTOR players. Each pulls (single pulls on the
// standard banner) until the whole 45-item pool is owned. This run measures only
// collection progression; it deliberately does NOT estimate equilibrium.
//
// "Collector" = never scraps a NEW distinct die (keeps it for the collection);
// duplicates are the only Dust events. For dupe detection, owned = has >=1 live
// copy, so a plain Set of catalog ids is exactly right (copy counts beyond 1 do
// not change either dupe detection or completion). This mirrors the award() dupe
// rule in scripts/economy-simulator.js (duplicate := owned.has(id) before add).
//
// We bucket every pull by the distinct-owned count BEFORE the award (0..44 during
// completion) and record: total pulls, duplicate
// pulls, and per-tier pulls / per-tier duplicate pulls. That yields both the
// completion curve and the realized (pity-shifted) tier distribution.
// ---------------------------------------------------------------------------
function runCollectorStreams({ profile, poolItemIds, N, seed }) {
  const poolSize = poolItemIds.length // 45
  const nBuckets = poolSize // 0..44
  const pullsAt = new Array(nBuckets).fill(0)
  const dupeAt = new Array(nBuckets).fill(0)
  const tierPullsAt = Array.from({ length: nBuckets }, () => [0, 0, 0, 0])
  const tierDupeAt = Array.from({ length: nBuckets }, () => [0, 0, 0, 0])
  const completionPulls = []
  let incomplete = 0
  let totalPulls = 0
  const rng = createSeededRng(seed)

  for (let player = 0; player < N; player += 1) {
    const owned = new Set()
    let state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
    let pulls = 0
    // Phase 1: pull to full collection.
    while (owned.size < poolSize && pulls < 20000) {
      const bucket = owned.size
      const res = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
      state = res.state
      const rank = res.result.rank
      const isDupe = owned.has(res.result.catalogItemId)
      pullsAt[bucket] += 1
      tierPullsAt[bucket][rank] += 1
      if (isDupe) {
        dupeAt[bucket] += 1
        tierDupeAt[bucket][rank] += 1
      } else {
        owned.add(res.result.catalogItemId)
      }
      pulls += 1
      totalPulls += 1
    }
    if (owned.size < poolSize) incomplete += 1
    else completionPulls.push(pulls)
  }
  return { pullsAt, dupeAt, tierPullsAt, tierDupeAt, completionPulls, incomplete, totalPulls, poolSize }
}

function meanAndSe(values) {
  if (values.length < 2) throw new Error('At least two batch means are required')
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const squaredDeviations = values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0,
  )
  return {
    mean,
    se: Math.sqrt(squaredDeviations / (values.length * (values.length - 1))),
    batches: values.length,
  }
}

function probabilityStats(tierPulls, pulls, tierBatchMeans) {
  return tierPulls.map((count, tier) => {
    const probability = count / pulls
    const batch = meanAndSe(tierBatchMeans.map(means => means[tier]))
    const binomialSe = Math.sqrt(probability * (1 - probability) / pulls)
    return {
      probability,
      batchSe: batch.se,
      binomialSe,
      se: Math.max(batch.se, binomialSe),
    }
  })
}

// Dedicated all-owned equilibrium stream. It starts from the engine's normal
// initial pity counters with the complete pool already owned; unlike the old
// collector tail, it is not conditioned on an epic-or-better completion award.
// Twenty-four million pulls make the finite initial transient negligible.
function runAllOwnedEquilibrium({
  profile,
  poolItemIds,
  pulls,
  seed,
  effectiveDust,
  batchSize,
}) {
  if (pulls % batchSize !== 0) throw new Error('Equilibrium pulls must divide evenly into batches')
  const owned = new Set(poolItemIds)
  const rng = createSeededRng(seed)
  let state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
  const tierPulls = [0, 0, 0, 0]
  const tierBatchMeans = []
  const dustBatchMeans = []
  let batchTierPulls = [0, 0, 0, 0]
  let batchDust = 0

  for (let pull = 0; pull < pulls; pull += 1) {
    const resolved = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
    state = resolved.state
    const tier = resolved.result.rank
    tierPulls[tier] += 1
    batchTierPulls[tier] += 1
    batchDust += effectiveDust[tier]

    if ((pull + 1) % batchSize === 0) {
      tierBatchMeans.push(batchTierPulls.map(count => count / batchSize))
      dustBatchMeans.push(batchDust / batchSize)
      batchTierPulls = [0, 0, 0, 0]
      batchDust = 0
    }
  }

  const tierStats = probabilityStats(tierPulls, pulls, tierBatchMeans)
  const dustStats = meanAndSe(dustBatchMeans)
  return {
    pulls,
    batchSize,
    batches: dustStats.batches,
    tierPulls,
    tierStats,
    tierProbs: tierStats.map(stat => stat.probability),
    tierSes: tierStats.map(stat => stat.se),
    dustPerPull: dustStats.mean,
    dustSe: dustStats.se,
  }
}

// Reference strategy: keep no copies and scrap every result. Unlike a base-weight
// calculation, this exact-engine stream preserves rare/epic pity and repeatedly
// re-arms selected-featured-unowned pity because the featured copy remains
// unowned after every scrap.
function runScrapOnlyStream({ profile, pulls, seed, scrap, batchSize }) {
  if (pulls % batchSize !== 0) throw new Error('Scrap-only pulls must divide evenly into batches')
  const rng = createSeededRng(seed)
  const owned = new Set()
  let state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
  const tierPulls = [0, 0, 0, 0]
  const dustBatchMeans = []
  let batchDust = 0
  for (let pull = 0; pull < pulls; pull += 1) {
    const resolved = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
    state = resolved.state
    const tier = resolved.result.rank
    tierPulls[tier] += 1
    batchDust += scrap[tier]
    if ((pull + 1) % batchSize === 0) {
      dustBatchMeans.push(batchDust / batchSize)
      batchDust = 0
    }
    // Deliberately do not add the awarded copy: it is immediately scrapped.
  }
  const dustStats = meanAndSe(dustBatchMeans)
  return {
    pulls,
    tierProbs: tierPulls.map(count => count / pulls),
    dustPerPull: dustStats.mean,
    dustSe: dustStats.se,
  }
}

// Adverse fixed-owned strategy from focused review: hold every pool item except
// one signature, scrap every awarded copy, and never add the missing signature
// to `owned`. All other results are duplicates (dupe_dust + scrap_yield); the
// missing signature grants only scrap_yield and remains unowned, repeatedly
// re-arming selected-featured pity.
function runOneSignatureUnownedStream({
  profile,
  poolItemIds,
  pulls,
  seed,
  dupe,
  scrap,
  batchSize,
}) {
  if (pulls % batchSize !== 0) throw new Error('Adverse pulls must divide evenly into batches')
  const signatureTier = profile.tiers.find(tier => tier.tierId === 'signature')
  const missingSignatureId = signatureTier.items
    .map(item => item.catalogItemId)
    .sort()[0]
  const owned = new Set(poolItemIds)
  owned.delete(missingSignatureId)
  const rng = createSeededRng(seed)
  let state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
  const tierPulls = [0, 0, 0, 0]
  const tierDuplicatePulls = [0, 0, 0, 0]
  let dust = 0
  let batchDust = 0
  const dustBatchMeans = []
  for (let pull = 0; pull < pulls; pull += 1) {
    const resolved = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
    state = resolved.state
    const tier = resolved.result.rank
    const duplicate = owned.has(resolved.result.catalogItemId)
    tierPulls[tier] += 1
    tierDuplicatePulls[tier] += Number(duplicate)
    const awardedDust = scrap[tier] + (duplicate ? dupe[tier] : 0)
    dust += awardedDust
    batchDust += awardedDust
    if ((pull + 1) % batchSize === 0) {
      dustBatchMeans.push(batchDust / batchSize)
      batchDust = 0
    }
    // Every awarded copy is scrapped. The fixed owned set therefore never
    // changes, including when the missing signature target is awarded.
  }
  const dustStats = meanAndSe(dustBatchMeans)
  return {
    pulls,
    missingSignatureId,
    tierProbs: tierPulls.map(count => count / pulls),
    tierDuplicateProbs: tierDuplicatePulls.map(count => count / pulls),
    dustPerPull: dust / pulls,
    dustSe: dustStats.se,
  }
}

// Strongest measured live-count farm: preserve the fully-owned double-dip while
// selectedMisses advances (the engine increments it even with no unowned
// featured target). At hard-1, scrap exactly one signature before the pull,
// arming an immediate selected guarantee; keep that replacement, returning to
// fully owned. Duplicate awards are immediately scrapped while their base copy
// remains owned.
function runDynamicSelectedPityFarm({
  profile,
  poolItemIds,
  pulls,
  seed,
  dupe,
  scrap,
  trigger,
  batchSize,
}) {
  if (pulls % batchSize !== 0) throw new Error('Dynamic farm pulls must divide evenly into batches')
  const signatureIds = profile.tiers
    .find(tier => tier.tierId === 'signature')
    .items
    .map(item => item.catalogItemId)
    .sort()
  const owned = new Set(poolItemIds)
  const rng = createSeededRng(seed)
  let state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
  let dust = 0
  let prePullSignatureScraps = 0
  let duplicatePulls = 0
  let replacementPulls = 0
  let duplicateDust = 0
  let batchDust = 0
  const dustBatchMeans = []

  for (let pull = 0; pull < pulls; pull += 1) {
    if (state.selectedMisses >= trigger) {
      const signatureToScrap = signatureIds.find(itemId => owned.has(itemId))
      if (!signatureToScrap) throw new Error('Dynamic selected-pity farm has no owned signature to scrap')
      owned.delete(signatureToScrap)
      dust += scrap[3]
      batchDust += scrap[3]
      prePullSignatureScraps += 1
    }

    const resolved = resolveCandidateBPull(profile, state, owned, drawBaseResult, rng)
    state = resolved.state
    const tier = resolved.result.rank
    const duplicate = owned.has(resolved.result.catalogItemId)
    if (duplicate) {
      // The awarded surplus copy is scrapped; the base owned copy remains.
      const awardedDust = dupe[tier] + scrap[tier]
      dust += awardedDust
      duplicateDust += awardedDust
      batchDust += awardedDust
      duplicatePulls += 1
    } else {
      // Keep the guaranteed replacement for the signature scrapped pre-pull.
      owned.add(resolved.result.catalogItemId)
      replacementPulls += 1
    }
    if ((pull + 1) % batchSize === 0) {
      dustBatchMeans.push(batchDust / batchSize)
      batchDust = 0
    }
  }

  const dustStats = meanAndSe(dustBatchMeans)
  return {
    pulls,
    trigger,
    prePullSignatureScraps,
    duplicatePulls,
    replacementPulls,
    duplicateDustPerDuplicatePull: duplicateDust / duplicatePulls,
    duplicateDustPerTotalPull: duplicateDust / pulls,
    signatureScrapDustPerPull: (prePullSignatureScraps * scrap[3]) / pulls,
    dustPerPull: dust / pulls,
    dustSe: dustStats.se,
  }
}

// Expected Dust per pull at a given collection state (owned-count bucket), for the
// COLLECTOR strategy: only duplicates yield Dust, and a duplicate yields the FULL
// double-dip dupe_dust + scrap_yield (grant the dupe copy, then scrap it).
//   E[dust/pull | bucket] = sum_t (dupePulls[bucket][t] / pulls[bucket]) * eff[t]
// where eff[t] = dupe_dust[t] + scrap_yield[t].
function expectedDustPerPullAtBucket(mc, bucket, eff) {
  const pulls = mc.pullsAt[bucket]
  if (pulls === 0) return null
  let sum = 0
  for (let t = 0; t < 4; t += 1) sum += (mc.tierDupeAt[bucket][t] / pulls) * eff[t]
  return sum
}

// The task's required late-game all-duplicate Dust-per-pull ceiling: with the
// complete pool owned, every pull is a duplicate, so
// D_all_dupe = sum_t P_late[t] * eff[t].
function dustCeiling(pLate, eff) {
  let s = 0
  for (let t = 0; t < 4; t += 1) s += pLate[t] * eff[t]
  return s
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`
}
function f(n, d = 3) {
  return Number(n).toFixed(d)
}

// ---------------------------------------------------------------------------
// CANDIDATE VALUE SETS (dupe_dust, scrap_yield per tier). We sweep sensible grids;
// the draft 2/8/20/50 (dupe_dust) is included per the task. `scrap_yield <=
// dupe_dust` is the design guardrail (spec §5-recommendation). The "effective"
// per-duplicate Dust (what the double-dip actually pays a farmer) is dupe+scrap.
// ---------------------------------------------------------------------------
const DRAFT = [2, 8, 20, 50] // draft banner dupe_dust (NOT final)
const HALF = [1, 4, 10, 25] // half of draft

const VALUE_SETS = [
  { id: 'V0 draft-dupe / no-scrap', dupe: DRAFT, scrap: [0, 0, 0, 0] },
  { id: 'V1 draft-dupe / full-scrap (max double-dip)', dupe: DRAFT, scrap: DRAFT },
  { id: 'V2 draft-dupe / half-scrap', dupe: DRAFT, scrap: HALF },
  { id: 'V3 split-baseline (RECOMMENDED)', dupe: HALF, scrap: HALF },
  { id: 'V4 half-dupe / quarter-scrap', dupe: HALF, scrap: [1, 2, 5, 13] },
]

// ---------------------------------------------------------------------------
// RECOMMENDED SET.
//   dupe_dust  = 1 / 4 / 10 / 25   (half the draft, so dupe+scrap == draft 2/8/20/50)
//   scrap_yield= 1 / 4 / 10 / 25   (== dupe_dust: boundary of scrap <= dupe)
// Rationale: ADR 017 mandates a duplicate grants "a copy PLUS Dust" (dupe_dust>0,
// so dupe_dust=0 is out), but the double-dip means a farmer nets dupe+scrap per
// duplicate. Splitting the draft 2/8/20/50 across dupe_dust and scrap_yield keeps
// the EFFECTIVE per-duplicate Dust == the 0017-calibrated baseline (spec §7: "a
// dupe does not silently double the faucet"). scrap == dupe is Dust-neutral
// between keeping and scrapping a dupe, but keeping also yields a spawnable
// matched-set copy, so collectors keep and only surplus-farmers scrap.
//
//   craft_cost = per-tier native-acquisition floor (pull-parity), rounded up:
//     standard 210 / rare 220 / epic 615 / signature 2500.
// Craft cost is set strictly above the Dust generated at D_FARM_MAX in the
// expected number of pulls needed to obtain a SPECIFIC die of that tier on its
// native banner (see BINDING INEQUALITIES). This makes crafting slower than
// pulling for the same-copy value, even before crediting the other copies and
// Dust earned along the direct-pull route.
//
// Signature is priced, not excluded: 2500 Dust takes >400 standard farming pulls
// even at D_FARM_MAX, which is strictly above its standard-pool specific-copy
// comparator and far above the premium hard-75 chase.
// ---------------------------------------------------------------------------
const RECOMMENDED = {
  dupe: [1, 4, 10, 25],
  scrap: [1, 4, 10, 25],
  craft: [210, 220, 615, 2500],
  mythicScrap: 50,
}

// Free-player faucet: the task pins ~10 standard pulls/week free (edition weekly
// Star budget 1600 = 10 rolls). The direct-claim community die is mythic and
// arrives every 4 weeks once the pool is exhausted. Its recommended scrap yield
// is capped at 50, so claim -> scrap -> reclaim adds at most the already-modeled
// 12.5 Dust/week; reported as an accelerator, not the headline.
const FREE_PULLS_PER_WEEK = 10
const COMMUNITY_CADENCE_WEEKS = 4
const COMMUNITY_DUST_PER_WEEK = RECOMMENDED.mythicScrap / COMMUNITY_CADENCE_WEEKS

function main() {
  const { profile, poolItemIds, tierSizes, baseWeights, weightScale } = buildStandardProfile()
  const N = 4000
  const BATCH_SIZE = 10_000
  const mc = runCollectorStreams({ profile, poolItemIds, N, seed: 20260723 })
  const recEff = RECOMMENDED.dupe.map((d, i) => d + RECOMMENDED.scrap[i])
  const EQUILIBRIUM_PULLS = 24_000_000
  const equilibrium = runAllOwnedEquilibrium({
    profile,
    poolItemIds,
    pulls: EQUILIBRIUM_PULLS,
    seed: 20260727,
    effectiveDust: recEff,
    batchSize: BATCH_SIZE,
  })
  const pLate = equilibrium.tierProbs
  const pLateSe = equilibrium.tierSes
  const SCRAP_ONLY_PULLS = 1_200_000
  const scrapOnly = runScrapOnlyStream({
    profile,
    pulls: SCRAP_ONLY_PULLS,
    seed: 20260724,
    scrap: RECOMMENDED.scrap,
    batchSize: BATCH_SIZE,
  })
  const ADVERSE_PULLS = 2_000_000
  const oneSignatureUnowned = runOneSignatureUnownedStream({
    profile,
    poolItemIds,
    pulls: ADVERSE_PULLS,
    seed: 20260725,
    dupe: RECOMMENDED.dupe,
    scrap: RECOMMENDED.scrap,
    batchSize: BATCH_SIZE,
  })
  const DYNAMIC_FARM_PULLS = 2_000_000
  const DYNAMIC_TRIGGERS = [19, 25, 20, 21, 30, 40, 60]
  const dynamicSweep = DYNAMIC_TRIGGERS.map((trigger, index) =>
    runDynamicSelectedPityFarm({
      profile,
      poolItemIds,
      pulls: DYNAMIC_FARM_PULLS,
      seed: 20260730 + index,
      dupe: RECOMMENDED.dupe,
      scrap: RECOMMENDED.scrap,
      trigger,
      batchSize: BATCH_SIZE,
    }))
  const sweepWinner = dynamicSweep.reduce(
    (maximum, entry) => entry.dustPerPull > maximum.dustPerPull ? entry : maximum,
  )
  const DYNAMIC_VALIDATION_PULLS = 10_000_000
  const dynamicSelectedPity = runDynamicSelectedPityFarm({
    profile,
    poolItemIds,
    pulls: DYNAMIC_VALIDATION_PULLS,
    seed: 20260740,
    dupe: RECOMMENDED.dupe,
    scrap: RECOMMENDED.scrap,
    trigger: sweepWinner.trigger,
    batchSize: BATCH_SIZE,
  })

  const out = []
  const log = (...a) => out.push(a.join(''))

  log('DUST ECONOMY SIMULATION — discrete-copy inventory value sizing (ADR 017 / spec §1.6, §6.1, §7)')
  log('DRAFT / SIMULATION-ONLY. Engine reused from scripts/economy-simulator.js (no re-implementation).')
  log('')
  log(`STANDARD pool = production edition 0001-earned-collection.json`)
  log(`  pool size (distinct pull items): ${poolItemIds.length}`)
  log(`  tier weights (scale ${weightScale}): ` +
    TIER_IDS.map((t, i) => `${t} ${baseWeights[i]} (${pct(baseWeights[i] / weightScale)})`).join(' | '))
  log(`  tier pool sizes: ` + TIER_IDS.map((t, i) => `${t} n=${tierSizes[i]}`).join(' | '))
  log(`  pity: rareOrBetter hard 8 | epicOrBetter hard 25 | selectedFeaturedUnowned hard 20`)
  log(`  Collector Monte Carlo: ${N} players through completion only; ` +
    `${mc.totalPulls.toLocaleString('en-US')} total pull-resolutions; seed 20260723`)
  log(`  Dedicated all-owned equilibrium: ${EQUILIBRIUM_PULLS.toLocaleString('en-US')} pull-resolutions; ` +
    `${equilibrium.batches} batches × ${BATCH_SIZE.toLocaleString('en-US')}; seed 20260727`)
  log(`  Scrap-only reference: ${SCRAP_ONLY_PULLS.toLocaleString('en-US')} pull-resolutions; seed 20260724`)
  log(`  One-signature-unowned adverse farm: ${ADVERSE_PULLS.toLocaleString('en-US')} pull-resolutions; seed 20260725`)
  log(`  Dynamic selected-pity trigger sweep: ${DYNAMIC_TRIGGERS.join('/')} × ` +
    `${DYNAMIC_FARM_PULLS.toLocaleString('en-US')} pull-resolutions; seeds 20260730..20260736`)
  log(`  Adopted-trigger validation: trigger ${sweepWinner.trigger} × ` +
    `${DYNAMIC_VALIDATION_PULLS.toLocaleString('en-US')} pull-resolutions; seed 20260740`)
  const compl = [...mc.completionPulls].sort((a, b) => a - b)
  const meanCompl = compl.reduce((a, b) => a + b, 0) / compl.length
  log(`  pulls to complete all ${poolItemIds.length}: mean ${f(meanCompl, 1)} | ` +
    `p50 ${compl[Math.ceil(compl.length * 0.5) - 1]} | p90 ${compl[Math.ceil(compl.length * 0.9) - 1]} | ` +
    `max ${compl[compl.length - 1]} | incomplete players ${mc.incomplete}`)
  log('')

  // -------------------------------------------------------------------------
  // PART 1 — Duplicate rate vs collection completion (overall + per tier).
  // -------------------------------------------------------------------------
  log('== PART 1 — Duplicate rate vs collection completion (standard pool) ==')
  log('Duplicate probability rises toward 1.0 as the collection fills. Per-tier columns are')
  log('P(pull is a duplicate of that tier | at this owned-count) = tierDupePulls / totalPulls in bucket.')
  log('')
  log(['owned/45', 'complete%', 'pulls_seen', 'P(dupe)', 'dupe_std', 'dupe_rare', 'dupe_epic', 'dupe_sig'].join('\t'))
  const bucketsToShow = [0, 5, 10, 15, 20, 25, 30, 35, 40, 43, 44]
  for (const b of bucketsToShow) {
    const pulls = mc.pullsAt[b]
    if (pulls === 0) continue
    const pdupe = mc.dupeAt[b] / pulls
    const perTier = [0, 1, 2, 3].map(t => mc.tierDupeAt[b][t] / pulls)
    log([String(b), pct(b / 45), pulls.toLocaleString('en-US'), f(pdupe), ...perTier.map(x => f(x, 4))].join('\t'))
  }
  log(['45*', '100.0%', EQUILIBRIUM_PULLS.toLocaleString('en-US'), '1.000', ...pLate.map(x => f(x, 4))].join('\t'))
  log('* owned=45 is the independent all-owned equilibrium stream, not a post-completion tail.')
  log(`Realized steady-state tier distribution P_late (pity-shifted, selected-guarantee OFF): ` +
    TIER_IDS.map((t, i) => `${t} ${f(pLate[i], 4)}`).join(' | '))
  log(`  SE (max of batch-means and binomial): ` +
    TIER_IDS.map((t, i) => `${t} ${f(pLateSe[i], 7)}`).join(' | '))
  log('  Estimator fix: collection completion is conditioned on an epic-or-better award and resets epicMisses;')
  log('  the old immediate 300-pull tails began pity-drained. This dedicated 24M stream removes that bias.')
  log(`  (vs base weights ` + TIER_IDS.map((t, i) => `${t} ${f(baseWeights[i] / weightScale, 4)}`).join(' | ') +
    ` — epic/sig lift from epic-or-better pity draws.)`)
  log('')

  // -------------------------------------------------------------------------
  // PART 2 — Expected Dust per pull vs collection state, per candidate value set.
  //          (Counts the double-dip: eff[t] = dupe_dust[t] + scrap_yield[t].)
  // -------------------------------------------------------------------------
  log('== PART 2 — Expected Dust/pull vs collection state (double-dip counted) ==')
  log('eff[t] = dupe_dust[t] + scrap_yield[t] (a duplicate grants dupe_dust AND a copy scrappable for scrap_yield).')
  log('Collector strategy: only duplicates yield Dust; new distinct dice are kept for the collection.')
  log('')
  const dustBuckets = [5, 15, 25, 35, 44, 45]
  for (const vs of VALUE_SETS) {
    const eff = vs.dupe.map((d, i) => d + vs.scrap[i])
    log(`-- ${vs.id}`)
    log(`   dupe_dust ${vs.dupe.join('/')} | scrap_yield ${vs.scrap.join('/')} | eff(dupe+scrap) ${eff.join('/')}`)
    const row = dustBuckets.map(b => {
      const e = b === 45 ? dustCeiling(pLate, eff) : expectedDustPerPullAtBucket(mc, b, eff)
      return e == null ? 'n/a' : f(e, 3)
    })
    log(`   E[dust/pull] @ owned ` + dustBuckets.map((b, i) => `${b === 45 ? '45*' : b}=${row[i]}`).join(' '))
    const dCeil = dustCeiling(pLate, eff)
    log(`   D_ALL_DUPE (late-game, every pull a dupe) = ${f(dCeil, 3)} dust/pull` +
      ` | weekly free income (${FREE_PULLS_PER_WEEK} pulls) = ${f(dCeil * FREE_PULLS_PER_WEEK, 1)} dust/wk` +
      ` (+community ${COMMUNITY_DUST_PER_WEEK}/wk = ${f(dCeil * FREE_PULLS_PER_WEEK + COMMUNITY_DUST_PER_WEEK, 1)})`)
    log('')
  }

  // -------------------------------------------------------------------------
  // PART 3 — Required all-duplicate result + conservative maximum farm rate.
  // -------------------------------------------------------------------------
  const dAllDupe = equilibrium.dustPerPull
  const dAllDupeSe = equilibrium.dustSe
  const dAdverseOneSignature = oneSignatureUnowned.dustPerPull
  const farmRates = [
    {
      strategy: 'all-owned/all-duplicate',
      dustPerPull: dAllDupe,
      dustSe: dAllDupeSe,
    },
    {
      strategy: 'all-owned-except-one-signature, scrap every award',
      dustPerPull: dAdverseOneSignature,
      dustSe: oneSignatureUnowned.dustSe,
    },
    {
      strategy: `dynamic selected-pity trigger=${dynamicSelectedPity.trigger}`,
      dustPerPull: dynamicSelectedPity.dustPerPull,
      dustSe: dynamicSelectedPity.dustSe,
      result: dynamicSelectedPity,
    },
  ]
  const farmMax = farmRates.reduce(
    (maximum, entry) => entry.dustPerPull > maximum.dustPerPull ? entry : maximum,
  )
  const dFarmMax = farmMax.dustPerPull
  const dFarmMaxSe = farmMax.dustSe
  const farmMaxStrategy = farmMax.strategy
  if (!farmMax.result) throw new Error('Expected a dynamic trigger to bind D_FARM_MAX')
  const weeklyAllDupe = dAllDupe * FREE_PULLS_PER_WEEK
  const weeklyAllDupePlus = weeklyAllDupe + COMMUNITY_DUST_PER_WEEK
  const weeklyFarmMax = dFarmMax * FREE_PULLS_PER_WEEK
  // Scrap-only reference: owns nothing, scraps every pull -> scrap_yield only.
  const scrapOnlyDustPerPull = scrapOnly.dustPerPull
  log('== PART 3 — Required all-owned/all-duplicate farming comparator (RECOMMENDED eff 2/8/20/50) ==')
  log(`D_ALL_DUPE = Σ P_late[t] × (dupe_dust[t] + scrap_yield[t]) = ${f(dAllDupe, 6)} ` +
    `± ${f(dAllDupeSe, 6)} SE dust/pull`)
  log('  Condition: all 45 pull-pool items are owned, so every result grants dupe_dust plus a copy that is')
  log('  immediately scrapped. selected-featured-unowned pity is therefore off; rare/epic pity remains live.')
  log(`Scrap-only reference (own nothing, exact engine/pity, scrap_yield only) = ` +
    `${f(scrapOnlyDustPerPull, 6)} ± ${f(scrapOnly.dustSe, 6)} SE dust/pull`)
  log(`  realized tiers: ${TIER_IDS.map((tier, index) => `${tier} ${f(scrapOnly.tierProbs[index], 4)}`).join(' | ')}`)
  log('  This fixes the prior base-weight shortcut: an always-unowned player repeatedly re-arms selected pity.')
  log('Adverse fixed-owned farm: own all items except one signature and scrap every award.')
  log(`  missing target: ${oneSignatureUnowned.missingSignatureId}`)
  log(`  realized tiers: ${TIER_IDS.map((tier, index) => `${tier} ${f(oneSignatureUnowned.tierProbs[index], 6)}`).join(' | ')}`)
  log(`  duplicate-by-tier probabilities: ${TIER_IDS.map((tier, index) => `${tier} ${f(oneSignatureUnowned.tierDuplicateProbs[index], 6)}`).join(' | ')}`)
  log(`  D_ONE_SIGNATURE_UNOWNED = ${f(dAdverseOneSignature, 6)} ± ` +
    `${f(oneSignatureUnowned.dustSe, 6)} SE dust/pull`)
  log('Dynamic selected-pity trigger sweep: remain fully owned until selectedMisses reaches the trigger,')
  log('  scrap one signature, take the guaranteed replacement, keep it, and resume surplus-duplicate scraps.')
  log(['trigger', 'pulls', 'Dust/pull', 'batch-means SE'].join('\t'))
  for (const result of dynamicSweep) {
    log([
      result.trigger,
      result.pulls.toLocaleString('en-US'),
      f(result.dustPerPull, 7),
      f(result.dustSe, 7),
    ].join('\t'))
  }
  log(`  sweep maximum: trigger ${sweepWinner.trigger} at ${f(sweepWinner.dustPerPull, 7)} Dust/pull.`)
  log(`  adopted trigger ${dynamicSelectedPity.trigger} validation: ${f(dynamicSelectedPity.dustPerPull, 7)} ± ` +
    `${f(dynamicSelectedPity.dustSe, 7)} SE Dust/pull; pre-pull signature scraps ` +
    `${dynamicSelectedPity.prePullSignatureScraps.toLocaleString('en-US')} | ` +
    `duplicate pulls ${dynamicSelectedPity.duplicatePulls.toLocaleString('en-US')} | ` +
    `replacement pulls ${dynamicSelectedPity.replacementPulls.toLocaleString('en-US')}`)
  log(`  duplicate-award stream = ${f(dynamicSelectedPity.duplicateDustPerDuplicatePull, 6)} ` +
    `Dust/duplicate pull (${f(dynamicSelectedPity.duplicateDustPerTotalPull, 6)} per total pull)`)
  log(`  signature-scrap contribution = ${f(dynamicSelectedPity.signatureScrapDustPerPull, 6)} Dust/total pull`)
  log(`D_FARM_MAX = max(D_ALL_DUPE, D_ONE_SIGNATURE_UNOWNED, D_TRIGGER19_VALIDATION) = ` +
    `${f(dFarmMax, 7)} ± ${f(dFarmMaxSe, 7)} SE dust/pull`)
  log(`  binding anti-arbitrage strategy: ${farmMaxStrategy}`)
  log('  Dominance rationale: the trigger-19 cycle forces a rank-3 signature every 20 pulls; that award resets')
  log('  epicMisses, so epic pity is SUPPRESSED. The duplicate-award stream averages only about 4.72 Dust')
  log('  per duplicate pull. The uplift over all-owned equilibrium comes from the 25-Dust signature scrap')
  log('  every cycle, not from preserving epic duplicate Dust. Later triggers trade away that scrap cadence.')
  log(`Weekly free Dust @ ${FREE_PULLS_PER_WEEK} pulls = ${f(weeklyAllDupe, 3)} dust/wk all-dupe` +
    ` / ${f(weeklyFarmMax, 3)} dust/wk adverse max` +
    ` / ${f(weeklyAllDupePlus, 3)} all-dupe incl. community faucet.`)
  log('')

  // -------------------------------------------------------------------------
  // PART 4 — Craft-cost floors + the binding inequality actually used.
  // -------------------------------------------------------------------------
  log('== PART 4 — Craft-cost floors per tier + binding inequality ==')
  log('Owned-only crafting duplicates a die the player ALREADY owns, so the economic comparator is the')
  log('pull cost of hitting THAT SPECIFIC die AGAIN as a duplicate (selected-die targeting is impossible in')
  log('the standard pool). Expected pulls to hit a specific tier-t die = n_t / P_late[t]. Each such pull, run')
  log('as a farm, yields at most D_FARM_MAX Dust under the measured adverse strategy. Therefore:')
  log('')
  log('    craft_cost[t] / D_FARM_MAX  >  n_t / P_late[t]')
  log('    equivalently: craft_cost[t] > (n_t / P_late[t]) * D_FARM_MAX')
  log('')
  log('D_ALL_DUPE remains the required steady-state pace metric; D_FARM_MAX is the conservative')
  log('anti-arbitrage divisor used for all native acquisition and signature inequalities.')
  log('')
  log(['tier', 'n_t', 'P_late±SE', 'native pulls', 'native floor±SE Dust', 'Dust margin', 'margin/SE', 'pass?'].join('\t'))
  const nativeFloor = []
  const nativeFloorSe = []
  const nativeMargin = []
  const nativeMarginSigma = []
  const weeksFloor = []
  const farmPullsToCraft = []
  for (let t = 0; t < 4; t += 1) {
    const pullsSpecific = tierSizes[t] / pLate[t]
    const floor = pullsSpecific * dFarmMax
    const floorSe = Math.hypot(
      pullsSpecific * dFarmMaxSe,
      (tierSizes[t] * dFarmMax / (pLate[t] ** 2)) * pLateSe[t],
    )
    const margin = RECOMMENDED.craft[t] - floor
    const marginSigma = margin / floorSe
    const wf = tierSizes[t] / (FREE_PULLS_PER_WEEK * pLate[t])
    const craftFarmPulls = RECOMMENDED.craft[t] / dFarmMax
    nativeFloor.push(floor)
    nativeFloorSe.push(floorSe)
    nativeMargin.push(margin)
    nativeMarginSigma.push(marginSigma)
    weeksFloor.push(wf)
    farmPullsToCraft.push(craftFarmPulls)
    log([
      TIER_IDS[t],
      tierSizes[t],
      `${f(pLate[t], 6)}±${f(pLateSe[t], 6)}`,
      f(pullsSpecific, 3),
      `${f(floor, 3)}±${f(floorSe, 3)}`,
      `+${f(margin, 3)}`,
      `${f(marginSigma, 1)} SE`,
      RECOMMENDED.craft[t] > floor && marginSigma >= 3 ? 'YES' : 'NO',
    ].join('\t'))
  }
  log('')
  log('Anti-pump floor (hard, non-negotiable): craft_cost[t] > scrap_yield[t], else craft->scrap mints Dust.')
  log('Signature cross-banner floor: craft_cost / D_FARM_MAX must also exceed the premium hard-75 chase.')
  const signatureFarmPullSe = (RECOMMENDED.craft[3] / (dFarmMax ** 2)) * dFarmMaxSe
  const signatureHard75Margin = farmPullsToCraft[3] - 75
  log(`  ${RECOMMENDED.craft[3]} / ${f(dFarmMax, 6)} = ${f(farmPullsToCraft[3], 3)} standard-farm pulls > 75 premium pulls`)
  log(`  margin = ${f(signatureHard75Margin, 3)} pulls; SE = ${f(signatureFarmPullSe, 3)} pulls; ` +
    `margin/SE = ${f(signatureHard75Margin / signatureFarmPullSe, 1)}; ratio = ${f(farmPullsToCraft[3] / 75, 3)}x.`)
  log('  This is conservative: the recommended premium soft-pity mean is ~46.6 pulls, while 75 is the hard ceiling.')
  log('')

  // -------------------------------------------------------------------------
  // PART 5 — Recommended set + verification.
  // -------------------------------------------------------------------------
  log('== PART 5 — RECOMMENDED value set + verification ==')
  log(['tier', 'dupe_dust', 'scrap_yield', 'craft_cost', 'eff(d+s)', 'weeks all-dupe', 'weeks farm-max', 'native_floor', 'craft>floor?'].join('\t'))
  const weeksToCraftAllDupe = []
  const weeksToCraftFarmMax = []
  for (let t = 0; t < 4; t += 1) {
    const eff = RECOMMENDED.dupe[t] + RECOMMENDED.scrap[t]
    const weeksAllDupe = RECOMMENDED.craft[t] / weeklyAllDupe
    const weeksFarmMax = RECOMMENDED.craft[t] / weeklyFarmMax
    weeksToCraftAllDupe.push(weeksAllDupe)
    weeksToCraftFarmMax.push(weeksFarmMax)
    log([
      TIER_IDS[t],
      RECOMMENDED.dupe[t],
      RECOMMENDED.scrap[t],
      RECOMMENDED.craft[t],
      eff,
      f(weeksAllDupe, 2),
      f(weeksFarmMax, 2),
      f(nativeFloor[t], 0),
      RECOMMENDED.craft[t] > nativeFloor[t] ? 'YES' : 'NO',
    ].join('\t'))
  }
  const epicWeeksAllDupe = weeksToCraftAllDupe[2]
  const epicWeeksFarmMax = weeksToCraftFarmMax[2]
  const epicWeeksPlus = RECOMMENDED.craft[2] / weeklyAllDupePlus
  log('')
  log(`Effective per-duplicate Dust ${recEff.join('/')} == 0017 baseline 2/8/20/50 -> faucet NOT silently doubled.`)
  log('Crafted-copy scrap inequalities (all strict, with Dust margin and cost/scrap ratio):')
  for (let t = 0; t < 4; t += 1) {
    const margin = RECOMMENDED.craft[t] - RECOMMENDED.scrap[t]
    log(`  ${TIER_IDS[t]}: scrap ${RECOMMENDED.scrap[t]} < craft ${RECOMMENDED.craft[t]}; ` +
      `margin ${margin} Dust; ratio ${f(RECOMMENDED.craft[t] / RECOMMENDED.scrap[t], 2)}x`)
  }
  log('Native same-copy inequalities (strict; farm pulls to craft > expected pulls to pull that specific die):')
  for (let t = 0; t < 4; t += 1) {
    const nativePulls = tierSizes[t] / pLate[t]
    const pullMargin = farmPullsToCraft[t] - nativePulls
    log(`  ${TIER_IDS[t]}: ${RECOMMENDED.craft[t]} / ${f(dFarmMax, 6)} = ${f(farmPullsToCraft[t], 3)} ` +
      `> ${tierSizes[t]} / ${f(pLate[t], 4)} = ${f(nativePulls, 3)} pulls; ` +
      `margin ${f(pullMargin, 3)} pulls (${f(nativeMargin[t], 3)} Dust); ` +
      `floor SE ${f(nativeFloorSe[t], 3)} Dust; margin/SE ${f(nativeMarginSigma[t], 1)}`)
  }
  log(`Mythic community direct-claim scrap: ${RECOMMENDED.mythicScrap} Dust every ` +
    `${COMMUNITY_CADENCE_WEEKS} weeks = ${f(COMMUNITY_DUST_PER_WEEK, 1)} Dust/wk.`)
  log('  This is the maximum allowed recommendation: claim→scrap→reclaim does not exceed the')
  log('  already-modeled 12.5 Dust/wk community faucet. Mythic crafting is not proposed.')
  const epicWeeksSe = (RECOMMENDED.craft[2] / (FREE_PULLS_PER_WEEK * (dAllDupe ** 2))) * dAllDupeSe
  const epicLowerMargin = epicWeeksAllDupe - 4
  const epicUpperMargin = 12 - epicWeeksAllDupe
  log(`WEEKS-TO-CRAFT-ONE-EPIC (all-dupe steady state, ${FREE_PULLS_PER_WEEK} pulls/wk) = ${f(epicWeeksAllDupe, 3)} weeks` +
    ` (${f(epicWeeksPlus, 3)} wk incl. community faucet) -> target 4-12: ${epicWeeksAllDupe >= 4 && epicWeeksAllDupe <= 12 ? 'PASS' : 'FAIL'}`)
  log(`  batch-means SE ${f(epicWeeksSe, 4)} weeks; lower-bound margin ${f(epicLowerMargin, 3)} ` +
    `(${f(epicLowerMargin / epicWeeksSe, 1)} SE); upper-bound margin ${f(epicUpperMargin, 3)} ` +
    `(${f(epicUpperMargin / epicWeeksSe, 1)} SE)`)
  log(`WEEKS-TO-CRAFT-ONE-EPIC (adverse D_FARM_MAX) = ${f(epicWeeksFarmMax, 3)} weeks`)
  log(`  epic craft ${RECOMMENDED.craft[2]} is strictly above adverse native parity ${f(nativeFloor[2], 3)} Dust: farming takes`)
  log(`  ${f(farmPullsToCraft[2], 3)} pulls vs ${f(tierSizes[2] / pLate[2], 3)} expected pulls to re-pull a specific epic.`)
  log('')
  log(`SIGNATURE is PRICED, not excluded: ${RECOMMENDED.craft[3]} Dust is above the adverse standard-pool same-copy floor and requires`)
  log(`  ${f(farmPullsToCraft[3], 3)} standard-farm pulls, exceeding the premium hard-75 chase by ` +
    `${f(farmPullsToCraft[3] - 75, 3)} pulls (${f(farmPullsToCraft[3] / 75, 3)}x total).`)
  log('')
  log('-- BINDING INEQUALITIES (stated) --')
  log('[H1 anti-pump]        craft_cost[t]  >  scrap_yield[t]            (hard; else craft->scrap Dust pump)')
  log('  deterministic integer margins 209/216/605/2475 Dust; estimator SE=0; margin/SE=∞.')
  log('[H2 native-parity]    craft_cost[t] / D_FARM_MAX > n_t / P_late[t]  (strict same-copy comparator)')
  log(`  margin/SE by tier ${TIER_IDS.map((tier, index) => `${tier} ${f(nativeMarginSigma[index], 1)}`).join(' | ')}; all >=3.`)
  log('[H3 signature]        craft_cost[signature] / D_FARM_MAX > 75 premium hard-pity pulls.')
  log(`  margin/SE ${f(signatureHard75Margin / signatureFarmPullSe, 1)}; >=3.`)
  log('[G1 no-double-faucet] dupe_dust[t] + scrap_yield[t] <= 0017 baseline (2/8/20/50); scrap_yield<=dupe_dust.')
  log('  exact integer equality; estimator SE=0; equality is allowed by the guardrail.')
  log('[G2 faucet-progress]  4 <= craft_cost[epic] / (freePulls/wk * D_ALL_DUPE) <= 12 weeks;')
  log(`  lower margin/SE ${f(epicLowerMargin / epicWeeksSe, 1)}; upper margin/SE ` +
    `${f(epicUpperMargin / epicWeeksSe, 1)}; both >=3. Adverse D_FARM_MAX pace is also reported.`)
  log('')
  log(`RECOMMENDED  dupe_dust ${RECOMMENDED.dupe.join('/')}  scrap_yield ${RECOMMENDED.scrap.join('/')}  ` +
    `craft_cost ${RECOMMENDED.craft.join('/')}  (standard/rare/epic/signature)`)

  const text = out.join('\n') + '\n'
  process.stdout.write(text)

  // Machine-readable trailer so downstream tooling can diff without re-parsing tables.
  const summary = {
    poolSize: poolItemIds.length,
    tierSizes,
    pLate,
    pLateSe,
    equilibriumPulls: equilibrium.pulls,
    equilibriumBatchSize: equilibrium.batchSize,
    dAllDupe,
    dAllDupeSe,
    dOneSignatureUnowned: dAdverseOneSignature,
    dOneSignatureUnownedSe: oneSignatureUnowned.dustSe,
    dynamicSweep,
    sweepWinner,
    dFarmMax,
    dFarmMaxSe,
    farmMaxStrategy,
    farmMaxEvidence: farmMax.result,
    dynamicSelectedPity,
    comparator: 'max of required all-dupe, fixed one-signature-unowned, and independent trigger-19 validation',
    scrapOnlyDustPerPull,
    scrapOnlyDustSe: scrapOnly.dustSe,
    scrapOnlyTierProbs: scrapOnly.tierProbs,
    weeklyFreeDustAllDupe: weeklyAllDupe,
    weeklyFreeDustFarmMax: weeklyFarmMax,
    weeklyFreeDustAllDupeWithCommunity: weeklyAllDupePlus,
    nativeFloor,
    nativeFloorSe,
    nativeMargin,
    nativeMarginSigma,
    farmPullsToCraft,
    weeksFloor,
    recommended: {
      standard: { dupeDust: RECOMMENDED.dupe[0], scrapYield: RECOMMENDED.scrap[0], craftCost: RECOMMENDED.craft[0] },
      rare: { dupeDust: RECOMMENDED.dupe[1], scrapYield: RECOMMENDED.scrap[1], craftCost: RECOMMENDED.craft[1] },
      epic: { dupeDust: RECOMMENDED.dupe[2], scrapYield: RECOMMENDED.scrap[2], craftCost: RECOMMENDED.craft[2] },
      signature: { dupeDust: RECOMMENDED.dupe[3], scrapYield: RECOMMENDED.scrap[3], craftCost: RECOMMENDED.craft[3] },
      mythic: { scrapYield: RECOMMENDED.mythicScrap, craftCost: null },
    },
    freePlayerWeeksToEpicCraftAllDupe: epicWeeksAllDupe,
    freePlayerWeeksToEpicCraftFarmMax: epicWeeksFarmMax,
    freePlayerWeeksToEpicCraftAllDupeWithCommunity: epicWeeksPlus,
  }
  process.stdout.write('\n<<<SUMMARY_JSON>>>\n' + JSON.stringify(summary, null, 2) + '\n')
}

main()
