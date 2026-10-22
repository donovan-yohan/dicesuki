export type SystemId = '5e' | 'pf2e'
export type ProviderId = 'dnd5eapi' | 'foundry-pf2e'
export interface Recipe { count: number; sides: 4 | 6 | 8 | 10 | 12 | 20; bonus: number }
export interface DamageComponent {
  id: string
  type: string
  timing: 'immediate' | 'conditional' | 'persistent' | 'splash'
  recipe: Recipe
  choice?: string
  pointer: string
}
export interface CreatureAction {
  id: string
  name: string
  attackBonus?: number
  traits: string[]
  damage: DamageComponent[]
  target?: string
  note: string
  pointer: string
}
export interface Creature {
  id: string
  key: string
  name: string
  system: SystemId
  edition: string
  provider: ProviderId
  kind: 'npc' | 'monster'
  source: {
    sourceId: string
    url: string
    revision: string
    sha256: string
    importedAt: string
    publication: string
    license: string
    licenseUrl: string
    noticeUrl: string
  }
  actions: CreatureAction[]
  saves: { id: string; name: string; bonus: number; pointer: string }[]
  notes: string[]
  overrides: { pointer: string; fragment: string }[]
}
export type Intent =
  | { role: 'attack'; actionId: string; mode?: string; ordinal?: number }
  | { role: 'damage'; actionId: string; componentId: string; mode?: string; ordinal?: number }
  | { role: 'own-save'; saveId: string; mode?: string; ordinal?: number }
