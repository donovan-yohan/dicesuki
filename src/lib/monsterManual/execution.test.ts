import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiceStore } from '../../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../../store/useMultiplayerStore'
import { quickActionState, executeMonsterIntent, executeAdmittedRoll } from './execution'
import { buildCreatureKit } from '../rollLibrary'
import { createSavedRollPlan } from '../savedRollPlan'
import { catalog } from './catalog'
import { waitFor } from '@testing-library/react'

beforeEach(() => {
  useDiceStore.getState().cancelSavedRollExecution()
  useDiceStore.setState({ savedRollWavesPending: false, savedRollExecution: null })
  useMultiplayerStore.setState({ localPlayerId: 'local', connectionStatus: 'connected', dice: new Map(), pendingLocalRolls: [], pendingInventoryDieIds: new Set(), pendingSpawnRollBarriers: new Map() })
})
describe('native quick action admission', () => {
  it('admits one pre-render intent and never closes without base acknowledgement', async () => {
    const c = catalog.find(c => c.system === '5e' && c.name === 'Guard')!
    const backend = { clearAll: vi.fn(), removeDie: vi.fn(), addDie: vi.fn(() => 'unacknowledged-spawn'), addGenericDie: vi.fn(() => 'unacknowledged-spawn'), roll: vi.fn() }
    const onBase = vi.fn()
    const pending = executeMonsterIntent(c, { role: 'attack', actionId: c.actions[0].id }, backend, onBase)
    // Native reset intentionally cancels the executor without an error notice.
    const canceled = expect(pending).resolves.toBeUndefined()
    await expect(executeMonsterIntent(c, { role: 'attack', actionId: c.actions[0].id }, backend, onBase)).rejects.toThrow('Your dice are still rolling.')
    await waitFor(() => expect(backend.addDie).toHaveBeenCalledTimes(1))
    useMultiplayerStore.getState().disconnect()
    await canceled
    expect(backend.clearAll).toHaveBeenCalledTimes(1)
    expect(backend.roll).not.toHaveBeenCalled()
    expect(onBase).not.toHaveBeenCalled()
  })
  it('shares admission between persisted kit templates and direct/personal entry points', async () => {
    const c = catalog[0]
    const restored = JSON.parse(JSON.stringify(buildCreatureKit(c))).cards[0].variants[0].roll
    const backend = { clearAll: vi.fn(), removeDie: vi.fn(), addDie: vi.fn(() => 'pending-kit'), addGenericDie: vi.fn(() => 'pending-kit'), roll: vi.fn() }
    const pending = executeAdmittedRoll(restored, backend, vi.fn())
    await expect(executeMonsterIntent(c, { role: 'attack', actionId: c.actions[0].id }, backend, vi.fn())).rejects.toThrow('Your dice are still rolling.')
    await waitFor(() => expect(backend.addDie).toHaveBeenCalledTimes(1))
    useMultiplayerStore.getState().disconnect()
    await pending
    expect(backend.clearAll).toHaveBeenCalledTimes(1)
    expect(backend.roll).not.toHaveBeenCalled()
  })
  it('ignores remote moving dice but blocks moving own dice across reopen', () => {
    useMultiplayerStore.setState({ dice: new Map([['remote', { id: 'remote', ownerId: 'remote', isRolling: true } as MultiplayerDie]]) })
    expect(quickActionState()).toBe('ready')
    useMultiplayerStore.setState({ dice: new Map([['own', { id: 'own', ownerId: 'local', isRolling: true } as MultiplayerDie]]) })
    expect(quickActionState()).toBe('rolling')
  })
  it('blocks pending local acknowledgement, waves and disconnected room', () => {
    useMultiplayerStore.setState({ pendingLocalRolls: [1] })
    expect(quickActionState()).toBe('rolling')
    useMultiplayerStore.setState({ pendingLocalRolls: [] })
    useDiceStore.setState({ savedRollWavesPending: true })
    expect(quickActionState()).toBe('rolling')
    useMultiplayerStore.setState({ connectionStatus: 'disconnected' })
    expect(quickActionState()).toBe('disconnected')
  })
  it('uses native capacity-before-clear without mutating a full foreign table', async () => {
    useMultiplayerStore.setState({ dice: new Map(Array.from({ length: 30 }, (_, i) => [String(i), { id: String(i), ownerId: 'remote', isRolling: false } as MultiplayerDie])) })
    const backend = { clearAll: vi.fn(), removeDie: vi.fn(), addDie: vi.fn(), addGenericDie: vi.fn(), roll: vi.fn() }
    const c = catalog.find(c => c.system === '5e' && c.name === 'Guard')!
    await expect(executeMonsterIntent(c, { role: 'attack', actionId: c.actions[0].id }, backend, vi.fn())).rejects.toThrow(/capacity|room|dice/i)
    expect(backend.clearAll).not.toHaveBeenCalled()
    expect(backend.roll).not.toHaveBeenCalled()
  })
  it.each(['saved-kit', 'direct-monster'])('preserves previous signed plan on preflight rejection through %s', async path => {
    const dice=new Map<string,MultiplayerDie>(Array.from({length:29},(_,i)=>[`foreign-${i}`,{id:`foreign-${i}`,ownerId:'remote',isRolling:false} as MultiplayerDie] as const))
    dice.set('old',{id:'old',ownerId:'local',isRolling:false} as MultiplayerDie)
    useMultiplayerStore.setState({dice})
    const guard=buildCreatureKit(catalog.find(c=>c.system==='5e'&&c.name==='Guard')!).cards[0].variants[0].roll
    const plan=createSavedRollPlan(guard);plan.entries[0].groups=[{memberIds:['old']}]
    const previous={name:'Previous Guard',flatBonus:3,perDieBonuses:new Map([['old',0]]),plan}
    const settledDice=new Map([['old',{diceId:'old',type:'d20' as const,value:10,settledAt:1}]])
    useDiceStore.setState({activeSavedRoll:previous,settledDice})
    const dragon=catalog.find(c=>c.name==='Young Red Dragon')!;const action=dragon.actions.find(a=>a.damage.some(d=>d.recipe.count===16))!;const component=action.damage.find(d=>d.recipe.count===16)!
    const roll=buildCreatureKit(dragon).cards.find(c=>c.variants[0].roll.dice[0].quantity===16)!.variants[0].roll
    const backend={clearAll:vi.fn(),removeDie:vi.fn(),addDie:vi.fn(),addGenericDie:vi.fn(),roll:vi.fn()}
    const pending=path==='saved-kit'?executeAdmittedRoll(roll,backend,vi.fn()):executeMonsterIntent(dragon,{role:'damage',actionId:action.id,componentId:component.id},backend,vi.fn())
    await expect(pending).rejects.toThrow(/Only 1|capacity|free/i)
    expect(backend.clearAll).not.toHaveBeenCalled();expect(backend.addDie).not.toHaveBeenCalled();expect(backend.roll).not.toHaveBeenCalled()
    expect(useMultiplayerStore.getState().dice).toBe(dice);expect(useDiceStore.getState().settledDice).toBe(settledDice);expect(useDiceStore.getState().activeSavedRoll).toBe(previous)
    expect(10+useDiceStore.getState().activeSavedRoll!.flatBonus).toBe(13)
  })
  it('cleans previous context after table replacement begins and spawn fails', async()=>{
    const previous={name:'Old',flatBonus:3,perDieBonuses:new Map<string,number>()}
    useDiceStore.setState({activeSavedRoll:previous})
    const roll=buildCreatureKit(catalog[0]).cards[0].variants[0].roll
    const backend={clearAll:vi.fn(),removeDie:vi.fn(),addDie:vi.fn(()=>{throw new Error('spawn failed')}),addGenericDie:vi.fn(),roll:vi.fn()}
    await expect(executeAdmittedRoll(roll,backend,vi.fn())).rejects.toThrow('spawn failed')
    expect(backend.clearAll).toHaveBeenCalledOnce();expect(useDiceStore.getState().activeSavedRoll).toBeNull();expect(backend.roll).not.toHaveBeenCalled()
  })

})
