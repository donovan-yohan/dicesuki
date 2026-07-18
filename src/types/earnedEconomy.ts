export type WalletCurrencyId = 'stars' | 'dust'

export type WalletBalanceBucket = 'promotional' | 'earned'

export type EarnedEconomyTierId = 'standard' | 'rare' | 'epic' | 'signature'

export interface WalletRewardAmount {
  readonly currencyId: WalletCurrencyId
  readonly balanceBucket: WalletBalanceBucket
  readonly amount: number
}

export interface WeeklyAuthoritativeRollRewardContract {
  readonly periodDays: 7
  readonly authoritativeCompletedRollTarget: 10
  readonly maximumRewardedRolls: 10
  readonly rewardPerCompletedRoll: WalletRewardAmount & {
    readonly currencyId: 'stars'
    readonly balanceBucket: 'promotional'
    readonly amount: 160
  }
  readonly maximumPeriodReward: 1600
  readonly streakLoss: false
  readonly missedDayPenalty: false
}

export interface NewCollectorPassportRewardContract {
  readonly durationWeeks: 12
  readonly claimsPerWeek: 1
  readonly eligibleCatalogItemIds: readonly string[]
  readonly selection: 'lowest-canonical-id-unowned'
  readonly whenAllOwned: WalletRewardAmount & {
    readonly currencyId: 'dust'
    readonly balanceBucket: 'earned'
    readonly amount: 2
  }
  readonly afterWeekTwelve: 'completed-no-further-claims'
}

export interface CommunityDieRewardContract {
  readonly intervalWeeks: 4
  readonly claimMode: 'direct-claim'
  readonly eligibleCatalogItemIds: readonly string[]
  readonly selection: 'lowest-canonical-id-unowned'
  readonly whenAllOwned: WalletRewardAmount & {
    readonly currencyId: 'dust'
    readonly balanceBucket: 'earned'
    readonly amount: 50
  }
}

export interface EarnedEconomyTier {
  readonly tierId: EarnedEconomyTierId
  readonly rank: number
  readonly weightUnits: number
  readonly catalogItemIds: readonly string[]
}

export interface EarnedEconomyProductionEdition {
  readonly schemaVersion: 1
  readonly edition: number
  readonly editionId: string
  readonly slug: string
  readonly purpose: 'production'
  readonly migration: string
  readonly decisionSource: {
    readonly studyId: string
    readonly selectedCandidateId: string
  }
  readonly catalogContractVersion: number
  readonly acquisition: {
    readonly phase: 'earned-only'
    readonly realMoneyEnabled: false
    readonly checkoutEnabled: false
    readonly currency: {
      readonly currencyId: 'stars'
      readonly balanceBucket: 'promotional'
      readonly singlePullCost: number
      readonly tenPullCost: number
    }
    readonly banner: {
      readonly bannerId: string
      readonly familyId: string
      readonly weightScale: number
      readonly tiers: readonly EarnedEconomyTier[]
      readonly guarantees: Readonly<Record<string, unknown>>
    }
  }
  readonly rewards: {
    readonly weeklyAuthoritativeRolls: WeeklyAuthoritativeRollRewardContract
    readonly newCollectorPassport: NewCollectorPassportRewardContract
    readonly communityDie: CommunityDieRewardContract
  }
  readonly duplicateConversion: {
    readonly currencyId: 'dust'
    readonly balanceBucket: 'earned'
    readonly amountByTier: Readonly<Record<EarnedEconomyTierId | 'community', number>>
  }
}

export type EarnedRewardClaimKind = 'passport' | 'community'

export type EarnedRewardOutcomeKind = 'entitlement' | 'dust'

export type PassportRewardState = 'not_enrolled' | 'active' | 'complete'

export type CommunityRewardState = 'not_enrolled' | 'waiting' | 'claimable'

export interface EarnedRewardStatus {
  readonly programId: string
  readonly economyEditionId: string
  readonly asOf: string
  readonly weekStart: string
  readonly weeklyRolls: {
    readonly creditedRolls: number
    readonly maximumCreditedRolls: 10
    readonly starsPerRoll: 160
    readonly starsEarned: number
  }
  readonly passport: {
    readonly state: PassportRewardState
    readonly enrolledPeriodStart: string | null
    readonly claimedCount: number
    readonly availableClaimCount: number
    readonly catchUpClaimCount: number
    readonly maximumClaims: 12
  }
  readonly community: {
    readonly state: CommunityRewardState
    readonly claimedCount: number
    readonly availableClaimCount: number
    readonly catchUpClaimCount: number
    readonly intervalWeeks: 4
    readonly nextEligiblePeriodStart: string | null
  }
}

export type EarnedRewardClaimOutcome = Readonly<{
  id: string
  programId: string
  accountId: string
  userId: string
  claimKind: EarnedRewardClaimKind
  claimIndex: number
  eligiblePeriodStart: string
  idempotencyKey: string
  outcomeKind: EarnedRewardOutcomeKind
  catalogItemId: string | null
  entitlementId: string | null
  walletLedgerEntryId: number | null
  dustAmount: number
  claimedAt: string
}>
