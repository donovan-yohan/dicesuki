import { readFileSync } from 'node:fs'
import * as React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDiceStore, type DieSettledState } from '../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../store/useMultiplayerStore'
import { formatBonus } from '../lib/diceHelpers'
import { groupPercentileResults, percentileSumCorrection } from '../lib/percentileRolls'
import { dieChipLabel } from '../lib/basicDice'
import { aggregateSavedRollPlan, facesFromSettled } from '../lib/savedRollPlan'

// Exercise the production result renderer with real hooks/stores without
// booting Scene's unrelated WebGL/auth/room graph. CSS geometry is qualified
// separately through the full table in e2e/hud-layout.spec.ts.
const source = readFileSync('src/components/Scene.tsx', 'utf8')
const parsed = ts.createSourceFile('Scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['CHIP_STYLES', 'DiceChip', 'ResultDisplay', 'getResultDieLabel', 'getRollingDieLabel'])
const declarations = parsed.statements.filter(node => {
  if (ts.isFunctionDeclaration(node)) return names.has(node.name?.text ?? '')
  return ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(parsed)))
})
const compiled = ts.transpileModule(declarations.map(node => node.getText(parsed)).join('\n'), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText
const ResultDisplay = new Function(
  'React', 'useCallback', 'useMemo', 'useRef', 'useState', 'useEffect',
  'useDiceStore', 'useMultiplayerStore', 'formatBonus', 'groupPercentileResults',
  'percentileSumCorrection', 'dieChipLabel', 'aggregateSavedRollPlan', 'facesFromSettled',
  `${compiled}; return ResultDisplay`,
)(React, React.useCallback, React.useMemo, React.useRef, React.useState, React.useEffect,
  useDiceStore, useMultiplayerStore, formatBonus, groupPercentileResults,
  percentileSumCorrection, dieChipLabel, aggregateSavedRollPlan, facesFromSettled) as React.ComponentType

function settled(diceId: string, value: number): DieSettledState {
  return { diceId, value, type: 'd20', settledAt: 1 }
}

beforeEach(() => {
  useDiceStore.setState({ settledDice: new Map(), rollingDice: new Set(), activeSavedRoll: null, rollNotice: null })
  useMultiplayerStore.setState({ localPlayerId: null, selectedPlayerId: null, dice: new Map() })
})
afterEach(cleanup)

describe('result animation content ownership', () => {
  it('keeps the total, compact die label and status notice in the original result owner', () => {
    useDiceStore.setState({ settledDice: new Map([['one', settled('one', 1)]]), rollNotice: 'Roll complete' })
    render(<ResultDisplay />)
    expect(screen.getByTestId('roll-grand-total')).toHaveTextContent('1')
    const chip = screen.getByTestId('result-die-chip')
    expect(chip).toHaveTextContent('D201')
    expect(chip.querySelector('span[title="D20"]')).not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Roll complete')
    expect(screen.getByTestId('roll-grand-total').closest('div.absolute')).toContainElement(chip)
  })

  it('continues to hide stale totals while dice are rolling', () => {
    useDiceStore.setState({ settledDice: new Map([['one', settled('one', 1)]]) })
    render(<ResultDisplay />)
    act(() => useDiceStore.setState({ rollingDice: new Set(['two']) }))
    expect(screen.getByTestId('roll-grand-total')).toHaveTextContent('?')
    act(() => useDiceStore.setState({ rollingDice: new Set(), settledDice: new Map([['one', settled('one', 1)], ['two', settled('two', 20)]]) }))
    expect(screen.getByTestId('roll-grand-total')).toHaveTextContent('21')
    expect(screen.getAllByTestId('result-die-chip')).toHaveLength(2)
  })

  it('preserves saved-roll name, per-die bonuses and flat bonus semantics', () => {
    useDiceStore.setState({
      settledDice: new Map([['one', settled('one', 3)]]),
      activeSavedRoll: { name: 'Initiative', perDieBonuses: new Map([['one', 2]]), flatBonus: 4 },
    })
    render(<ResultDisplay />)
    expect(screen.getByTestId('roll-grand-total')).toHaveTextContent('9')
    expect(screen.getByText('Initiative')).toBeInTheDocument()
    expect(screen.getByTestId('result-die-chip')).toHaveTextContent('D203+2')
    expect(screen.getByText('+4')).toBeInTheDocument()
  })

  it('keeps selected-player filtering at the authoritative result boundary', () => {
    useDiceStore.setState({ settledDice: new Map([['one', settled('one', 1)], ['two', settled('two', 20)]]) })
    useMultiplayerStore.setState({
      localPlayerId: 'local', selectedPlayerId: 'other',
      dice: new Map([
        ['one', { id: 'one', ownerId: 'other' } as MultiplayerDie],
        ['two', { id: 'two', ownerId: 'local' } as MultiplayerDie],
      ]),
    })
    render(<ResultDisplay />)
    expect(screen.getByTestId('roll-grand-total')).toHaveTextContent('1')
    expect(screen.getAllByTestId('result-die-chip')).toHaveLength(1)
    act(() => useMultiplayerStore.setState({ selectedPlayerId: null }))
    expect(screen.getByTestId('roll-grand-total')).toHaveTextContent('21')
    expect(screen.getAllByTestId('result-die-chip')).toHaveLength(2)
  })
})
