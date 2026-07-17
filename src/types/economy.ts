/** Static modeling contracts only. No production wallet or pull path consumes these types. */
export type EconomyRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'mythic'

export interface EconomyPoolItem {
  readonly catalogItemId: string
  readonly weightUnits: number
}

export interface EconomyRarityTier {
  readonly rarity: EconomyRarity
  readonly weightUnits: number
  readonly items: readonly EconomyPoolItem[]
}

export interface EconomyGuarantees {
  readonly rareOrBetterTenPull: {
    readonly windowPulls: number
    readonly windowScope: 'purchased-ten-pull-batch'
    readonly singlePullBehavior: 'does-not-advance-or-satisfy-window'
    readonly rollingBehavior: 'does-not-carry-between-purchases'
    readonly reset: 'after-each-purchased-ten-pull-batch'
    readonly minimumRarity: EconomyRarity
    readonly trigger: 'replace-final-pull-if-window-misses'
    readonly replacementDistribution: 'base-weights-conditioned-on-minimum-rarity'
  }
  readonly selectedFeatured: {
    readonly featuredCatalogItemIds: readonly string[]
    readonly selection: 'player-selected-before-pull'
    readonly hardGuaranteePull: number
    readonly trigger: 'replace-pull-at-counter-if-selected-not-awarded'
    readonly lossPath: 'none'
    readonly counterScope: 'banner-family'
    readonly carryFamilyId: string
    readonly reset: 'selected-featured-awarded'
  }
}

export interface EconomyContract {
  readonly contractVersion: number
  readonly contractId: string
  readonly slug: string
  readonly purpose: 'simulation-only'
  readonly catalogContractVersion: number
  readonly disclosureArtifact: string
  readonly currency: {
    readonly currencyId: 'stars'
    readonly singlePullCost: number
    readonly tenPullCost: number
    readonly balanceClasses: readonly ['paid', 'promotional']
    readonly debitPolicy: 'promotional-before-paid'
  }
  readonly banner: {
    readonly bannerId: string
    readonly familyId: string
    readonly paidRandom: {
      readonly weightScale: number
      readonly tiers: readonly EconomyRarityTier[]
      readonly excludedRarities: readonly ['mythic']
    }
    readonly guarantees: EconomyGuarantees
  }
  readonly freeCadence: {
    readonly dailyBank: {
      readonly accrualPeriodDays: number
      readonly capacityDays: number
      readonly claimOrder: 'oldest-first'
      readonly streakLoss: false
      readonly rewardPerAccrual: {
        readonly currencyId: 'stars'
        readonly amount: number
      }
    }
    readonly weeklyFlexibleBonus: {
      readonly intervalDays: number
      readonly reward: {
        readonly currencyId: 'stars'
        readonly amount: number
      }
    }
    readonly weeklyStarBudget: {
      readonly periodDays: number
      readonly totalAmount: number
    }
    readonly weeklyUnownedEvergreen: {
      readonly intervalDays: number
      readonly rewardCount: number
      readonly eligibleRarities: readonly ['common', 'uncommon']
      readonly catalogItemIds: readonly string[]
      readonly selection: 'lowest-canonical-id-unowned'
      readonly whenAllOwned: 'no-item'
    }
  }
  readonly duplicateConversion: {
    readonly currencyId: 'shards'
    readonly mode: 'fixed-by-rarity'
    readonly amountByRarity: Readonly<Record<EconomyRarity, number>>
  }
  readonly acquisitionPolicy: {
    readonly randomOnly: false
    readonly requiredNamedItemRoutes: readonly [
      'direct-purchase',
      'deterministic-shard-crafting',
    ]
  }
}

export interface ExactProbability {
  readonly numerator: number
  readonly denominator: number
}

export interface ProbabilityDisclosure {
  readonly exact: ExactProbability
  readonly displayPercent: string
  readonly displayRounding: 'nearest-0.000001-percent'
}

export interface EconomyDisclosureItemProbability {
  readonly catalogItemId: string
  readonly rarity: EconomyRarity
  readonly itemWeightUnits: number
  readonly probability: ProbabilityDisclosure
}

/** Immutable machine-readable input for the future simulator and disclosure UI. */
export interface EconomyDisclosure {
  readonly disclosureVersion: 1
  readonly contractId: string
  readonly contractVersion: number
  readonly generatedFrom: string
  readonly purpose: 'simulation-only'
  readonly runtimeConsumption: 'forbidden'
  readonly catalogContractVersion: number
  readonly currency: EconomyContract['currency']
  readonly paidRandom: {
    readonly bannerId: string
    readonly familyId: string
    readonly weightScale: number
    readonly excludedRarities: readonly EconomyRarity[]
    readonly rarityProbabilities: readonly {
      readonly rarity: EconomyRarity
      readonly weightUnits: number
      readonly probability: ProbabilityDisclosure
    }[]
    readonly itemProbabilities: readonly EconomyDisclosureItemProbability[]
    readonly rareOrBetterBaseProbability: ProbabilityDisclosure
    readonly rareOrBetterReplacementProbabilities: {
      readonly distribution: 'base-weights-conditioned-on-minimum-rarity'
      readonly rarityProbabilities: readonly {
        readonly rarity: EconomyRarity
        readonly weightUnits: number
        readonly probability: ProbabilityDisclosure
      }[]
      readonly itemProbabilities: readonly EconomyDisclosureItemProbability[]
    }
    readonly guarantees: EconomyGuarantees & {
      readonly selectedFeatured: EconomyGuarantees['selectedFeatured'] & {
        readonly baseProbabilities: readonly {
          readonly catalogItemId: string
          readonly probability: ProbabilityDisclosure
        }[]
      }
    }
  }
  readonly freeCadence: EconomyContract['freeCadence']
  readonly duplicateConversion: EconomyContract['duplicateConversion']
  readonly acquisitionPolicy: EconomyContract['acquisitionPolicy']
}
