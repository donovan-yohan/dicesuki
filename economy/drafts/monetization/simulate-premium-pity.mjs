#!/usr/bin/env node
// DRAFT / SIMULATION-ONLY — monetization economy spec (2026-07-22).
//
// This driver reuses the repo's OWN pity-resolution engine from
// scripts/economy-simulator.js (the exact same functions the frozen
// candidate-a-vs-collection-first@1 study runs): createSeededRng,
// candidateBProfile, drawBaseResult, initialCandidateBState, resolveCandidateBPull.
//
// The repo simulator CLI (`--check` / `--write-new`) is hard-locked to the
// frozen collection-first-showcase@1 schema (validateCandidateB pins pity to
// 8/25/20 and the standard/rare/epic/signature tier names), so a NEW premium
// banner cannot flow through the CLI. Per the task's "minimally-adapted copy"
// allowance we drive the exported primitives directly. No engine math is
// re-implemented here — only the banner config, the trial/percentile loop, and
// (below) a DESIGN-SIMULATION soft-pity ramp layer.
//
// ===========================================================================
// SOFT-PITY RAMP LAYER — DESIGN-SIMULATION OF AN ACCEPTED FUTURE ENGINE CHANGE.
// ===========================================================================
// The product owner ACCEPTED (2026-07-22) adding a soft-pity ramp to
// dicesuki-core / the 0011 pull policy. The engine does NOT have it yet: the
// selectedFeaturedUnowned guarantee still carries `softPity: 'none'`, and this
// driver leaves that engine contract field untouched. Instead we model the
// accepted target OUTSIDE the engine so the ramp slope can be sized before the
// core work lands.
//
// This is NOT engine parity. It is a wrapper around the `draw` parameter of the
// repo's resolveCandidateBPull: based on the live featured-pity counter
// (candidate-B state.selectedMisses), it upgrades the draw to the featured
// signature result with the ramp probability, otherwise delegates to the real
// drawBaseResult. The 75-pull hard guarantee is unchanged (resolveCandidateBPull
// still fires `selected-guarantee` at attempt 75 without ever calling `draw`).
//
// Run: node economy/drafts/monetization/simulate-premium-pity.mjs
import {
  createSeededRng,
  candidateBProfile,
  drawBaseResult,
  initialCandidateBState,
  resolveCandidateBPull,
} from '../../../scripts/economy-simulator.js'

const FEATURED = 'draft-premium/featured-signature-die@1'
const WEIGHT_SCALE = 1000
const CURRENCY = {
  currencyId: 'stars',
  singlePullCost: 160,
  tenPullCost: 1600,
  balanceClasses: ['paid', 'promotional'],
  debitPolicy: 'promotional-before-paid',
}
const SINGLE_PULL_STARS = 160
// Uniform-in-[0,1) resolution for the ramp coin flip (well within uint32 range).
const UNIFORM_SCALE = 1_000_000_000

// Placeholder non-featured pools (their membership does not affect featured-die
// odds; the featured die is the sole signature-tier item). weights set the tier
// probabilities out of a 1000-unit scale.
const STANDARD_ITEMS = ['draft-premium/std-a@1', 'draft-premium/std-b@1', 'draft-premium/std-c@1']
const RARE_ITEMS = ['draft-premium/rare-a@1', 'draft-premium/rare-b@1']
const EPIC_ITEMS = ['draft-premium/epic-a@1', 'draft-premium/epic-b@1']

function buildCandidate({ featuredWeight, rareHard, epicHard, sigHard }) {
  const rareWeight = 154
  const epicWeight = 40
  const standardWeight = WEIGHT_SCALE - rareWeight - epicWeight - featuredWeight
  return {
    candidateId: 'premium-featured-rate-up@draft',
    familyId: 'premium-featured',
    compatibleBannerIds: ['premium-featured-001'],
    currency: CURRENCY,
    tiers: [
      { tierId: 'standard', rank: 0, weightUnits: standardWeight, catalogItemIds: STANDARD_ITEMS },
      { tierId: 'rare', rank: 1, weightUnits: rareWeight, catalogItemIds: RARE_ITEMS },
      { tierId: 'epic', rank: 2, weightUnits: epicWeight, catalogItemIds: EPIC_ITEMS },
      { tierId: 'signature', rank: 3, weightUnits: featuredWeight, catalogItemIds: [FEATURED] },
    ],
    guarantees: {
      rareOrBetter: { minimumRank: 1, hardGuaranteePull: rareHard },
      epicOrBetter: { minimumRank: 2, hardGuaranteePull: epicHard },
      selectedFeaturedUnowned: {
        minimumRank: 3,
        hardGuaranteePull: sigHard,
        featuredCatalogItemIds: [FEATURED],
        selection: 'lowest-canonical-id-unowned',
        lossPath: 'none',
        // Engine contract field is UNCHANGED (`none`). The soft-pity ramp below is
        // applied EXTERNALLY via the injected draw wrapper — it is a design-sim of
        // the PO-accepted future engine change, not this contract flag.
        softPity: 'none',
        reset: 'selected-featured-awarded',
      },
    },
    duplicateShardsByTier: { standard: 2, rare: 8, epic: 20, signature: 50 },
  }
}

// DESIGN-SIMULATION soft-pity ramp. Returns a drop-in replacement for
// drawBaseResult that resolveCandidateBPull can call. `getSelectedMisses` reads
// the live candidate-B featured-pity counter so the wrapper knows which pull
// number this is (1-indexed featured attempt = selectedMisses + 1).
//
// Linear rate ramp:
//   n < start           -> featured rate = base (drawBaseResult handles it)
//   n >= start          -> featured rate = min(1, base + increment*(n-start+1))
// drawBaseResult ALREADY yields featured at `base` (the signature tier weight),
// so we inject only the EXCESS above base and delegate the remainder, making the
// effective featured rate equal the ramp target exactly:
//   effective = excess + (1-excess)*base
//             = base + excess*(1-base)   with excess = (target-base)/(1-base)
//             = target
function makeSoftPityDraw({ getSelectedMisses, softPity, baseFeaturedRate }) {
  const featuredResult = {
    catalogItemId: FEATURED,
    weightUnits: 1,
    tierId: 'signature',
    rank: 3,
    reason: 'soft-pity',
  }
  return (profile, rng, minimumRank = 0) => {
    const n = getSelectedMisses() + 1 // 1-indexed featured attempt for THIS pull
    const targetRate = n < softPity.start
      ? baseFeaturedRate
      : Math.min(1, baseFeaturedRate + softPity.increment * (n - softPity.start + 1))
    const excess = targetRate <= baseFeaturedRate ? 0 : (targetRate - baseFeaturedRate) / (1 - baseFeaturedRate)
    if (excess > 0 && rng.randomInt(UNIFORM_SCALE) / UNIFORM_SCALE < excess) {
      return { ...featuredResult }
    }
    return drawBaseResult(profile, rng, minimumRank)
  }
}

function quantile(sorted, p) {
  // Same nearest-rank convention as economy-simulator.js summarizeTargetTrials.
  return sorted[Math.ceil(sorted.length * p) - 1]
}

function simulate({ label, featuredWeight, rareHard, epicHard, sigHard, trials, seed, soft }) {
  const profile = candidateBProfile(buildCandidate({ featuredWeight, rareHard, epicHard, sigHard }))
  const rng = createSeededRng(seed)
  const baseFeaturedRate = featuredWeight / WEIGHT_SCALE
  const pulls = new Array(trials)
  let hardPityHits = 0
  let sum = 0
  for (let t = 0; t < trials; t += 1) {
    let state = initialCandidateBState(profile.familyId, profile.compatibleBannerIds[0])
    // DESIGN-SIM: the soft-pity variants swap drawBaseResult for the ramp wrapper.
    // The no-soft-pity rows pass the real drawBaseResult (engine parity, reproduces
    // the historical baseline exactly). The closure reads live `state` each pull.
    const draw = soft
      ? makeSoftPityDraw({ getSelectedMisses: () => state.selectedMisses, softPity: soft, baseFeaturedRate })
      : drawBaseResult
    const owned = new Set()
    let n = 0
    let reason
    for (;;) {
      const res = resolveCandidateBPull(profile, state, owned, draw, rng)
      state = res.state
      n += 1
      if (res.result.catalogItemId === res.selectedId) {
        reason = res.result.reason
        break
      }
    }
    pulls[t] = n
    sum += n
    if (reason === 'selected-guarantee') hardPityHits += 1
  }
  pulls.sort((a, b) => a - b)
  const featuredBasePct = baseFeaturedRate * 100
  return {
    label,
    featuredBasePct: featuredBasePct.toFixed(2),
    sigHard,
    soft: soft ? `+${(soft.increment * 100).toFixed(1)}%/${soft.start}` : 'none',
    trials,
    mean: (sum / trials).toFixed(2),
    p50: quantile(pulls, 0.5),
    p90: quantile(pulls, 0.9),
    p99: quantile(pulls, 0.99),
    max: pulls[pulls.length - 1],
    pctHardPity: ((hardPityHits / trials) * 100).toFixed(1),
    meanStars: Math.round((sum / trials) * SINGLE_PULL_STARS),
    ceilingStars: sigHard * SINGLE_PULL_STARS,
  }
}

const TRIALS = 200000
const variants = [
  // ---- HISTORICAL no-soft-pity sweep (SUPERSEDED context; engine had no ramp).
  // Kept so the spec's §5.2 historical table stays reproducible.
  { label: 'A shallow (PO concern)',   featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 25, seed: 20260722, soft: null },
  { label: 'B no-soft, hard 50',       featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 50, seed: 20260723, soft: null },
  { label: 'C no-soft, hard 70',       featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 70, seed: 20260724, soft: null },
  { label: 'E no-soft baseline hard75',featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 75, seed: 20260725, soft: null },
  { label: 'D no-soft, deep hard 90',  featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 90, seed: 20260726, soft: null },
  { label: 'F 1.0% no-soft, hard 75',  featuredWeight: 10, rareHard: 10, epicHard: 30, sigHard: 75, seed: 20260727, soft: null },
  // ---- ACCEPTED ENGINE CHANGE (design-sim): soft-pity ramp, base 0.6%, start 41,
  // hard 75 LOCKED. Slope sweep to size the perPullIncrement.
  { label: 'SP soft +0.5% start41',    featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 75, seed: 20260728, soft: { start: 41, increment: 0.005 } },
  { label: 'SP soft +1% start41',      featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 75, seed: 20260729, soft: { start: 41, increment: 0.01 } },
  { label: 'SP soft +2% start41',      featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 75, seed: 20260730, soft: { start: 41, increment: 0.02 } },
  { label: 'SP soft +3% start41',      featuredWeight: 6,  rareHard: 10, epicHard: 30, sigHard: 75, seed: 20260731, soft: { start: 41, increment: 0.03 } },
]

const rows = variants.map(v => simulate({ ...v, trials: TRIALS }))
console.log(`trials per variant: ${TRIALS}`)
console.log(
  ['label', 'featBase%', 'sigHard', 'soft', 'mean', 'p50', 'p90', 'p99', 'max', '%hardPity', 'meanStars', 'ceilStars'].join('\t'),
)
for (const r of rows) {
  console.log(
    [r.label, r.featuredBasePct, r.sigHard, r.soft, r.mean, r.p50, r.p90, r.p99, r.max, r.pctHardPity, r.meanStars, r.ceilingStars].join('\t'),
  )
}
