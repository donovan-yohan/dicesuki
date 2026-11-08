import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { dieChipLabel, isBasicDiePresentation } from '../lib/basicDice'
import { formatDiceShapeLabel } from '../lib/percentileRolls'

const source = readFileSync('src/components/Scene.tsx', 'utf8')
const parsed = ts.createSourceFile('Scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map<string, ts.FunctionDeclaration>()
for (const statement of parsed.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement)
}

function labelFunction(name: string) {
  const declaration = declarations.get(name)
  if (!declaration) throw new Error(`Missing Scene label function ${name}`)
  const compiled = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  return new Function('dieChipLabel', 'formatDiceShapeLabel', 'isBasicDiePresentation', `${compiled}; return ${name}`)(
    dieChipLabel, formatDiceShapeLabel, isBasicDiePresentation,
  ) as (die: Record<string, unknown>, inventory?: Map<string, unknown>) => string
}

describe('compact result labels', () => {
  it('uses the shape while named managed dice are rolling', () => {
    const label = labelFunction('getRollingDieLabel')
    expect(label({ diceType: 'd12', presentation: { displayName: 'Monster Dungeon Mimic D12' } }, new Map())).toBe('D12')
  })

  it('does not fall back to an inventory nickname while rolling', () => {
    const label = labelFunction('getRollingDieLabel')
    expect(label({ diceType: 'd6', presentation: { inventoryDieId: 'lucky' } }, new Map([
      ['lucky', { name: 'A Very Long Lucky Six' }],
    ]))).toBe('D6')
  })

  it('uses the shape after settlement without changing saved identity', () => {
    const label = labelFunction('getResultDieLabel')
    const presentation = { displayName: 'CUTLINE D20', customAssetId: 'cyberpunk-cutline-set/d20' }
    expect(label({ type: 'd20', presentation })).toBe('D20')
    expect(presentation.displayName).toBe('CUTLINE D20')
  })
})
