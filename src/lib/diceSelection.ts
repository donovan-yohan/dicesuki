export function selectRandomAvailableDie<T extends { id: string }>(
  dice: T[],
  unavailableIds: ReadonlySet<string>,
) {
  const availableDice = dice.filter(die => !unavailableIds.has(die.id))
  if (availableDice.length === 0) return undefined

  return availableDice[Math.floor(Math.random() * availableDice.length)]
}
