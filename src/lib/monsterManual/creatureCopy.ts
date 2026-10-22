/** Presentation compatibility for the exact prose added to early v1 imports.
 * Never rewrite stored snapshots or broadly strip source words such as “manual”.
 */
const appProse = [
  'Normal damage only; critical damage must be resolved manually.',
  'Informational only; resource-dependent spells/abilities are not automated.',
  'Informational only; conditions, reactions and ability automation unsupported. See source for requirements.',
  'Traits/resources resolve manually; normal damage only.',
  'Multiattack sequence only; roll individual attacks separately.',
  'Multiple-attack penalty applies only to selected in-turn strike. Reaction automation and out-of-turn strikes unsupported; resolve manually.',
  '; not included in ordinary own-save rolls. Apply manually when appropriate. Persistent acid rolls are manual; no automatic recurrence or splash adjudication.',
  '; resolve requirements/basic save manually',
  '; resolve manually',
]
export function creatureText(value: string): string {
  let result = value
  // Constants have a complete parenthetical, so remove that before its suffix.
  result = result.split(' (no dice; resolve manually)').join('')
  for (const phrase of appProse) result = result.split(phrase).join('')
  return result.split(' · venom stages/conditions resolve manually').join(' · venom stages/conditions').replace(/:\s*$/, '').replace(/[^\S\n]+\./g, '.').trim()
}
export function creatureNotes(notes: readonly string[]): string[] {
  return notes.map(creatureText).filter(Boolean)
}
