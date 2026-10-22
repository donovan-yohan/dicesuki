export function pfStrikeBonus(bonus: number, traits: readonly string[], ordinal = 1): number {
  if (![1, 2, 3].includes(ordinal)) throw new Error('Unsupported PF2e attack ordinal')
  return bonus - (ordinal - 1) * (traits.includes('agile') ? 4 : 5)
}
