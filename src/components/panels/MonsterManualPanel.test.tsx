import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MonsterManualPanel } from './MonsterManualPanel'
import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import type { DiceBackendState } from '../../contexts/DiceBackendContext'
import { useMultiplayerStore, type MultiplayerDie } from '../../store/useMultiplayerStore'
import { useDiceStore } from '../../store/useDiceStore'

function renderPanel() {
  const backend: DiceBackendState = { mode: 'multiplayer', roll: vi.fn(), clearAll: vi.fn(), removeDie: vi.fn(), addDie: vi.fn(), addGenericDie: vi.fn(), rollHistory: [], clearHistory: vi.fn(), multiplayer: null }
  render(<DiceBackendProvider value={backend}><MonsterManualPanel isOpen onClose={vi.fn()} /></DiceBackendProvider>)
  return backend
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  useDiceStore.getState().cancelSavedRollExecution()
  useDiceStore.setState({ savedRollWavesPending: false, savedRollExecution: null })
  useMultiplayerStore.setState({ connectionStatus: 'connected', localPlayerId: 'local', dice: new Map(), pendingLocalRolls: [], pendingInventoryDieIds: new Set(), pendingSpawnRollBarriers: new Map() })
})

describe('native catalog panel', () => {
  it('disambiguates Guards, preserves query across system filters and reports bounded empty results', () => {
    renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Name, e.g. Guard'), { target: { value: 'Guard' } })
    expect(screen.getAllByRole('button', { name: /^Guard · NPC/ })).toHaveLength(2)
    fireEvent.change(screen.getByRole('combobox', { name: 'System' }), { target: { value: 'pf2e' } })
    expect(screen.getAllByRole('button', { name: /^Guard · NPC/ })).toHaveLength(1)
    expect(screen.getByPlaceholderText('Name, e.g. Guard')).toHaveValue('Guard')
    fireEvent.change(screen.getByPlaceholderText('Name, e.g. Guard'), { target: { value: 'unknown creature' } })
    expect(screen.getByText('No creatures match “unknown creature”.')).toBeInTheDocument()
  })
  it('exposes target DC text, separate typed damage and own saves; options never execute', () => {
    const backend = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^Young Red Dragon · Monster/ }))
    const breath = screen.getByRole('region', { name: 'Fire Breath' })
    expect(within(breath).getByText(/Target: Dexterity save DC 17/)).toBeInTheDocument()
    expect(within(breath).queryByRole('button', { name: /Roll attack/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Roll Dexterity save · 1d20 \+4/ })).toBeEnabled()
    fireEvent.change(screen.getByRole('combobox', { name: /Bite attack mode/ }), { target: { value: 'advantage' } })
    expect(screen.getByRole('button', { name: /Roll attack · 2d20 keep highest \+10/ })).toBeInTheDocument()
    expect(backend.clearAll).not.toHaveBeenCalled()
    expect(screen.queryByText(/Roll now replaces/)).not.toBeInTheDocument()
  })
  it('blocks disconnected action controls while source browsing remains', () => {
    useMultiplayerStore.setState({ connectionStatus: 'disconnected' })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^Guard · NPC · PF2e/ }))
    for (const control of screen.getAllByRole('button', { name: /Roll attack · 1d20 \+7/ })) expect(control).toBeDisabled()
    expect(screen.getByText('Room not connected. Reconnect to roll.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Source' })).toBeInTheDocument()
  })
  it('reports native capacity error without clearing table or changing selection', async () => {
    useMultiplayerStore.setState({ dice: new Map(Array.from({ length: 30 }, (_, i) => [String(i), { id: String(i), ownerId: 'remote', isRolling: false } as MultiplayerDie])) })
    const backend = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^Guard · NPC · 5e/ }))
    fireEvent.click(screen.getByRole('button', { name: /Roll attack · 1d20 \+3/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/room|dice|capacity/i))
    expect(backend.clearAll).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Guard' })).toBeInTheDocument()
  })
})

it('shows Priest mechanics before a compact legal footer in the source browser',()=>{
 renderPanel();fireEvent.click(screen.getByRole('button',{name:/^Priest · NPC/}))
 expect(screen.getAllByText(/extra 10 \(3d6\) radiant damage/).length).toBeGreaterThan(0)
 expect(screen.getByText(/spell save DC 13, \+5 to hit with spell attacks/)).toBeInTheDocument()
 const manual=screen.getByTestId('monster-manual')
 expect(manual.textContent).not.toMatch(/Informational only|not automated|Revision:|SHA-256|Rules\/support|Mechanical data normalized|Roll now replaces/i)
 const footer=screen.getByRole('contentinfo',{name:'Creature sources'})
 expect(within(footer).getAllByRole('link').map(a=>a.textContent)).toEqual(['Source','CC BY 4.0','Attribution'])
})
