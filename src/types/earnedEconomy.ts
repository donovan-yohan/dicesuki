export type WalletCurrencyId = 'stars' | 'dust'

export type WalletBalanceBucket = 'promotional' | 'earned'

export type EarnedEconomyTierId = 'standard' | 'rare' | 'epic' | 'signature'

export interface WalletRewardAmount {
  readonly currencyId: WalletCurrencyId
  readonly balanceBucket: WalletBalanceBucket
  readonly amount: number
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
    readonly weeklyAuthoritativeRolls: Readonly<Record<string, unknown>>
    readonly newCollectorPassport: Readonly<Record<string, unknown>>
    readonly communityDie: Readonly<Record<string, unknown>>
  }
  readonly duplicateConversion: {
    readonly currencyId: 'dust'
    readonly balanceBucket: 'earned'
    readonly amountByTier: Readonly<Record<EarnedEconomyTierId | 'community', number>>
  }
}
