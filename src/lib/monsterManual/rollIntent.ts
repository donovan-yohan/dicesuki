import type { SavedRoll } from '../../types/savedRolls'
import type { Creature, Intent, Recipe } from './types'
import { catalog, systemLabels } from './catalog'
import { createClientId } from '../clientId'
import { fiveED20 } from './rules/fiveE'
import { pfStrikeBonus } from './rules/pf2e'

export function parseRecipe(value: string): Recipe {
  if (typeof value !== 'string' || value.length > 32) throw new Error('Invalid dice recipe')
  const match = /^(\d+)d(4|6|8|10|12|20)(?:\s*([+-])\s*(\d+))?$/.exec(value.trim())
  if (!match) {
    if (/^\d{1,3}$/.test(value) && Number(value) <= 100) return { count: 0, sides: 6, bonus: Number(value) }
    throw new Error('Unsupported dice recipe')
  }
  const count = Number(match[1])
  const bonus = Number(match[4] ?? 0) * (match[3] === '-' ? -1 : 1)
  if (count < 1 || count > 30 || Math.abs(bonus) > 100) throw new Error('Recipe outside physical bounds')
  return { count, sides: Number(match[2]) as Recipe['sides'], bonus }
}

export function recipeLabel(recipe: Recipe): string {
  const bonus = recipe.bonus === 0 ? '' : ` ${recipe.bonus > 0 ? '+' : '−'}${Math.abs(recipe.bonus)}`
  return recipe.count === 0 ? String(recipe.bonus) : `${recipe.count}d${recipe.sides}${bonus}`
}

/** IDs resolve against the reviewed catalog; callers cannot supply executable formulas. */
export function compileIntent(creature: Creature, intent: Intent): SavedRoll {
  if (!catalog.includes(creature)) throw new Error('Unreviewed creature revision')
  const keys = intent.role === 'own-save' ? ['role', 'saveId', 'mode', 'ordinal']
    : intent.role === 'attack' ? ['role', 'actionId', 'mode', 'ordinal']
      : intent.role === 'damage' ? ['role', 'actionId', 'componentId', 'mode', 'ordinal'] : []
  if (!keys.length || Object.keys(intent).some(k => !keys.includes(k))) throw new Error('Unsupported roll intent')
  if (creature.system === '5e' && intent.ordinal !== undefined) throw new Error('PF2e option on 5e action')
  if (creature.system === 'pf2e' && intent.mode !== undefined) throw new Error('5e option on PF2e action')
  if (intent.role !== 'attack' && intent.ordinal !== undefined) throw new Error('MAP applies only to strikes')
  if (intent.role === 'damage' && intent.mode !== undefined) throw new Error('Damage advantage unsupported')
  let recipe: Recipe = { count: 1, sides: 20, bonus: 0 }
  let label: string
  let damageType: string | undefined
  if (intent.role === 'own-save') {
    const save = creature.saves.find(s => s.id === intent.saveId)
    if (!save) throw new Error('Unknown own saving throw')
    recipe.bonus = save.bonus
    label = `${save.name} save`
  } else {
    const action = creature.actions.find(a => a.id === intent.actionId)
    if (!action) throw new Error('Unknown action')
    if (intent.role === 'attack') {
      if (action.attackBonus === undefined) throw new Error('This action has no supported attack roll')
      recipe.bonus = creature.system === 'pf2e' ? pfStrikeBonus(action.attackBonus, action.traits, intent.ordinal) : action.attackBonus
      label = `${action.name} attack`
    } else {
      const component = action.damage.find(d => d.id === intent.componentId)
      if (!component || component.recipe.count === 0) throw new Error('This component has no physical dice')
      recipe = component.recipe
      damageType = component.type
      label = `${action.name} ${component.timing} ${component.type}${component.choice ? ` (${component.choice})` : ''}`
    }
  }
  if (!Number.isInteger(recipe.bonus) || Math.abs(recipe.bonus) > 100 || !Number.isInteger(recipe.count) || recipe.count < 1 || recipe.count > 30 || ![4, 6, 8, 10, 12, 20].includes(recipe.sides)) throw new Error('Invalid reviewed recipe')
  const d20 = intent.role !== 'damage' && creature.system === '5e' ? fiveED20(intent.mode) : {}
  return {
    id: createClientId('monster-roll'), createdAt: Date.now(),
    name: `${creature.name} · ${systemLabels[creature.system]} · ${label}`,
    description: `${creature.source.url} · ${creature.source.revision}`, damageType,
    flatBonus: recipe.bonus,
    dice: [{ id: createClientId('monster-dice'), type: `d${recipe.sides}`, quantity: recipe.count, perDieBonus: 0, ...d20 }],
  }
}
