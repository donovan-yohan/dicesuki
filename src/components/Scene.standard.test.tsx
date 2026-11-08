import { readFileSync } from 'node:fs'
import { act, renderHook } from '@testing-library/react'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiceBackendState } from '../contexts/DiceBackendContext'
import { useMultiplayerDiceBackend } from '../hooks/useMultiplayerDiceBackend'
import { useInventoryStore } from '../store/useInventoryStore'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useSettingsStore } from '../store/useSettingsStore'

// Execute Scene's exact routing callback with the real backend and spawn/store
// transport. Canvas/physics rendering is covered separately in the browser.
const source = readFileSync('src/components/Scene.tsx', 'utf8')
const parsed = ts.createSourceFile('Scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let routing: ts.VariableDeclaration | undefined
function findRouting(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleAddDice') routing = node
  ts.forEachChild(node, findRouting)
}
findRouting(parsed)
const compiled = ts.transpileModule(`const ${routing!.getText(parsed)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText
function sceneAddDice(backend: DiceBackendState) {
  return new Function('activeBackend', 'useCallback', `${compiled}; return handleAddDice`)(
    backend, (callback: unknown) => callback,
  ) as (type: string, inventoryDieId?: string) => void
}

describe('Scene standard spawn routing', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    useInventoryStore.getState().reset()
    useSettingsStore.getState().setThemeId('sunlit-glade-cel')
  })

  it('sends a theme-matched standard from a shape-only toolbar action even with a free owned die', () => {
    useInventoryStore.getState().addDie({
      id: 'owned-d20', type: 'd20', setId: 'starter', rarity: 'common',
      appearance: { baseColor: '#8b5cf6', accentColor: '#ffffff', material: 'plastic' },
      vfx: {}, name: 'Owned D20', isFavorite: false, isLocked: false, source: 'starter',
    })
    const inventoryBefore = useInventoryStore.getState()
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1',
    })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => sceneAddDice(result.current)('d20'))
    const presentation = JSON.parse(send.mock.calls[0][0]).dice[0].presentation
    expect(presentation.customAssetId).toBe('woodland-sculpted-set/d20')
    expect(presentation).not.toHaveProperty('inventoryDieId')
    expect(useInventoryStore.getState()).toBe(inventoryBefore)
    expect(useMultiplayerStore.getState().pendingInventoryDieIds.size).toBe(0)
  })

  it('keeps explicit favorite inventory selections on the existing owned path', () => {
    useInventoryStore.getState().addDie({
      id: 'favorite', type: 'd6', setId: 'starter', rarity: 'rare',
      appearance: { baseColor: '#123456', accentColor: '#ffffff', material: 'metal' },
      vfx: {}, name: 'Lucky Six', isFavorite: true, isLocked: false, source: 'starter',
    })
    const send = vi.fn()
    useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => sceneAddDice(result.current)('d6', 'favorite'))
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation).toEqual({
      inventoryDieId: 'favorite', displayName: 'Lucky Six', setId: 'starter', rarity: 'rare',
      baseColor: '#123456', accentColor: '#ffffff', material: 'metal',
    })
  })

  it('routes an explicitly supplied empty inventory ID to addDie rather than the standard action', () => {
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    const addDie = vi.spyOn(result.current, 'addDie')
    const addStandardDie = vi.spyOn(result.current, 'addStandardDie')
    act(() => sceneAddDice(result.current)('d6', ''))
    expect(addDie).toHaveBeenCalledWith('d6', '')
    expect(addStandardDie).not.toHaveBeenCalled()
  })
})
