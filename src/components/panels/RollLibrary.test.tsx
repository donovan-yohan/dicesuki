import { buildCreatureKit } from '../../lib/rollLibrary'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { SavedRollsPanel } from './SavedRollsPanel'
import { useAuthStore } from '../../store/useAuthStore'
import { useRollLibraryStore } from '../../store/useRollLibraryStore'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import { buildCreatureKitV2 } from '../../lib/monsterManual/features'
import { catalog } from '../../lib/monsterManual/catalog'
import legacyPriest from '../../test/fixtures/legacyPriestKit.json'
import { executeAdmittedRoll } from '../../lib/monsterManual/execution'
vi.mock('./BottomSheet',()=>({BottomSheet:({children,isOpen}:{children:React.ReactNode;isOpen:boolean})=>isOpen?<div>{children}</div>:null}))
vi.mock('../../contexts/DiceBackendContext',()=>({useDiceBackend:()=>({})}))
vi.mock('../../lib/monsterManual/execution',()=>({quickActionState:()=> 'ready',executeAdmittedRoll:vi.fn()}))
beforeEach(()=>{localStorage.clear();useAuthStore.setState({status:'loading',user:null});useAuthStore.setState({status:'guest'});useSavedRollsStore.setState({savedRolls:[],deletedRolls:{}});vi.clearAllMocks();HTMLElement.prototype.scrollIntoView=vi.fn();vi.spyOn(window,'confirm').mockReturnValue(true)})
it('browsing never imports, explicit double Add saves one complete kit, repeat Add makes independent instance',async()=>{
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 for(let n=0;n<2;n++){
  fireEvent.click(screen.getByRole('button',{name:'Add creature'}));fireEvent.click(screen.getByRole('button',{name:/^Guard · NPC · 5e/}))
  expect(useRollLibraryStore.getState().data.instances).toHaveLength(n)
  const add=screen.getByRole('button',{name:'Add creature kit'});fireEvent.click(add);fireEvent.click(add)
  expect(useRollLibraryStore.getState().data.instances).toHaveLength(n+1)
  await waitFor(()=>expect(screen.getByText('Guard added · 9 rolls')).toBeInTheDocument())
 }
 expect(useRollLibraryStore.getState().data.instances.map(i=>i.displayName)).toEqual(['Guard','Guard 2'])
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
})
it('group search/move/remove keeps personal identity/formula/revision and duplicate/favorite available',()=>{
 const roll={id:'personal',createdAt:1,updatedAt:4,name:'Lucky',flatBonus:3,dice:[{id:'d',type:'d6' as const,quantity:2,perDieBonus:0}]}
 useSavedRollsStore.setState({savedRolls:[roll]});render(<SavedRollsPanel isOpen onClose={()=>{}}/>)
 fireEvent.click(screen.getByRole('button',{name:'New group'}));fireEvent.change(screen.getByLabelText('Group name'),{target:{value:'Combat'}});fireEvent.click(screen.getByRole('button',{name:'Save'}))
 fireEvent.click(screen.getByText('More'));fireEvent.click(screen.getByRole('button',{name:'Move to group'}));const group=useRollLibraryStore.getState().data.groups[0]
 fireEvent.change(screen.getByLabelText('Destination group'),{target:{value:group.id}});fireEvent.click(screen.getByRole('button',{name:'Apply'}))
 expect(within(screen.getByRole('region',{name:'Combat group'})).getByRole('button',{name:'Roll Lucky'})).toBeInTheDocument()
 fireEvent.click(screen.getByText('Remove group'));expect(useSavedRollsStore.getState().savedRolls).toEqual([roll]);expect(useRollLibraryStore.getState().data.memberships.personal).toBeUndefined()
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
})
it('auth loading clears previous instance/editor and quota errors keep chooser without success',()=>{
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}));fireEvent.click(screen.getByRole('button',{name:'Add creature'}));fireEvent.click(screen.getByRole('button',{name:/^Priest · NPC · 5e/}))
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')})
 fireEvent.click(screen.getByRole('button',{name:'Add creature kit'}));expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);expect(useRollLibraryStore.getState().data.instances).toHaveLength(0);storage.mockRestore()
 fireEvent.click(screen.getByRole('button',{name:'Back to roster'}));fireEvent.click(screen.getByRole('tab',{name:'Personal rolls'}));fireEvent.click(screen.getByRole('button',{name:'New group'}))
 fireEvent.change(screen.getByLabelText('Group name'),{target:{value:'Secret'}})
 // External auth transition uses the real synchronous store subscription.
 act(()=>useAuthStore.setState({status:'loading'}))
 expect(useRollLibraryStore.getState().data.groups).toEqual([])
})

it('late base acknowledgement cannot close or mark a new account library', async()=>{
 const roll={id:'shared-id',name:'Before switch',createdAt:1,flatBonus:0,dice:[{id:'d',type:'d20' as const,quantity:1,perDieBonus:0}]}
 useSavedRollsStore.setState({savedRolls:[roll]})
 let acknowledge!:()=>void;let finish!:()=>void
 vi.mocked(executeAdmittedRoll).mockImplementationOnce(async(_roll,_backend,onBase)=>{acknowledge=onBase;await new Promise<void>(resolve=>{finish=resolve})})
 const onClose=vi.fn();render(<SavedRollsPanel isOpen onClose={onClose}/>);fireEvent.click(screen.getByRole('button',{name:'Roll Before switch'}))
 act(()=>{useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})})
 await act(async()=>{acknowledge();finish()})
 expect(onClose).not.toHaveBeenCalled();expect(useSavedRollsStore.getState().savedRolls[0].lastUsed).toBeUndefined()
})

it('keeps explicit Roll names and separate Add without permanent replacement prose',()=>{
 const notice="Roll now replaces your table dice. Other players' dice stay."
 useSavedRollsStore.setState({savedRolls:[{id:'personal',createdAt:1,name:'Lucky',flatBonus:3,dice:[{id:'d',type:'d6',quantity:2,perDieBonus:0}]}]})
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>)
 function checkNotice(){
  expect(screen.queryByText(notice)).not.toBeInTheDocument()
  for(const roll of screen.getAllByRole('button',{name:/^Roll /}))expect(roll).toHaveAccessibleName(/^Roll /)
 }
 checkNotice()
 fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 fireEvent.click(screen.getByRole('button',{name:'Add creature'}))
 expect(screen.queryByText(notice)).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:/^Guard · NPC · 5e/}))
 fireEvent.click(screen.getByRole('button',{name:'Add creature kit'}))
 checkNotice()
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
})

it('renders the actual legacy v1 Priest quietly without rewriting alias, group, provenance or recipes',()=>{
 const scope=useRollLibraryStore.getState().scope!
 const data={version:1,groups:[{id:'kept-group',name:'Combat',collapsed:false}],memberships:{lucky:'kept-group'},ungroupedCollapsed:false,instances:[{id:'legacy-priest',displayName:'Sister Mira',collapsed:false,createdAt:1,kit:legacyPriest}]}
 localStorage.setItem(scope,JSON.stringify(data))
 act(()=>{useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})})
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>)
 fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 const creature=screen.getByRole('region',{name:'Sister Mira saved creature'})
 fireEvent.click(within(creature).getByText(/Source & kit details|Abilities & details/))
 expect(creature.textContent).not.toMatch(/Saved snapshot|source refresh|Revision:|SHA-256|informational only|not automated|resolve manually|normal damage only/i)
 expect(creature).toHaveTextContent('extra 10 (3d6) radiant damage')
 expect(creature).toHaveTextContent('spell save DC 13, +5 to hit with spell attacks')
 expect(creature).toHaveTextContent('1st level (4 slots): cure wounds, guiding bolt, sanctuary')
 const footer=within(creature).getByRole('contentinfo',{name:'Creature sources'})
 expect(within(footer).getByRole('link',{name:'Source'})).toHaveAttribute('href',legacyPriest.provenance.source.url)
 expect(within(footer).getByRole('link',{name:'CC BY 4.0'})).toHaveAttribute('href',legacyPriest.provenance.source.licenseUrl)
 expect(within(footer).getByRole('link',{name:'Attribution'})).toHaveAttribute('href',legacyPriest.provenance.source.noticeUrl)
 expect(useRollLibraryStore.getState().data).toEqual(data)
 expect(JSON.parse(localStorage.getItem(scope)!)).toEqual(data)
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
})

it('updates an existing alias only on explicit request and rolls actor-bound healing through shared admission',async()=>{
 const scope=useRollLibraryStore.getState().scope!
 const saved={version:1,groups:[],memberships:{},ungroupedCollapsed:false,instances:[{id:'legacy-feature',displayName:'Sister Mira',collapsed:false,createdAt:1,kit:legacyPriest}]}
 localStorage.setItem(scope,JSON.stringify(saved));act(()=>{useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})})
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 const instance=screen.getByRole('region',{name:'Sister Mira saved creature'})
 expect(useRollLibraryStore.getState().data.instances[0].kit.version).toBe(1)
 fireEvent.click(within(instance).getByLabelText('Creature options for Sister Mira'));fireEvent.click(within(instance).getByRole('button',{name:'Update spells & abilities'}))
 expect(useRollLibraryStore.getState().data.instances[0]).toMatchObject({id:'legacy-feature',displayName:'Sister Mira',createdAt:1,kit:{version:2}})
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
 const spellbook=within(instance).getByRole('region',{name:'Spellbook'})
 fireEvent.click(within(spellbook).getByText('Light',{selector:'summary'}));const light=within(spellbook).getByText('Light',{selector:'summary'}).closest('details')!
 expect(within(light).queryByRole('button',{name:/Roll/})).not.toBeInTheDocument()
 fireEvent.click(within(spellbook).getByText('Cure Wounds',{selector:'summary'}))
 fireEvent.change(within(spellbook).getByLabelText('Cure Wounds Healing Spell slot'),{target:{value:'3'}})
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
 fireEvent.click(within(spellbook).getByRole('button',{name:'Roll Cure Wounds · Healing · 3d8 + 3'}))
 await waitFor(()=>expect(executeAdmittedRoll).toHaveBeenCalledTimes(1))
 expect(vi.mocked(executeAdmittedRoll).mock.calls[0][0]).toMatchObject({name:expect.stringContaining('Sister Mira'),flatBonus:3,dice:[expect.objectContaining({type:'d8',quantity:3,perDieBonus:0})]})
})

it('retains selected slot and open spell across sheet close/reopen',async()=>{
 const lib=useRollLibraryStore.getState();lib.addCreature(lib.token!,buildCreatureKitV2(catalog.find(c=>c.name==='Priest')!))
 const props={onClose:()=>{}};const view=render(<SavedRollsPanel isOpen {...props}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}));fireEvent.click(screen.getByText('Cure Wounds',{selector:'summary'}));fireEvent.change(screen.getByLabelText('Cure Wounds Healing Spell slot'),{target:{value:'3'}})
 await waitFor(()=>expect(screen.getByLabelText('Cure Wounds Healing Spell slot')).toHaveValue('3'))
 view.rerender(<SavedRollsPanel isOpen={false} {...props}/>);view.rerender(<SavedRollsPanel isOpen {...props}/>)
 expect(screen.getByLabelText('Cure Wounds Healing Spell slot')).toHaveValue('3')
 expect(screen.getByText('Cure Wounds',{selector:'summary'}).closest('details')).toHaveAttribute('open')
})

it('updating one creature clears only its feature choices even with prefix-shaped legacy IDs',async()=>{
 const kit=buildCreatureKitV2(catalog.find(c=>c.name==='Priest')!),scope=useRollLibraryStore.getState().scope!
 localStorage.setItem(scope,JSON.stringify({version:1,groups:[],memberships:{},ungroupedCollapsed:false,instances:[{id:'a',displayName:'Priest A',collapsed:false,createdAt:1,kit},{id:'a:b',displayName:'Priest B',collapsed:false,createdAt:2,kit}]}))
 act(()=>{useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})})
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 const a=screen.getByRole('region',{name:'Priest A saved creature'}),b=screen.getByRole('region',{name:'Priest B saved creature'})
 for(const [region,value]of [[a,'3'],[b,'2']] as const){fireEvent.click(within(region).getByText('Cure Wounds',{selector:'summary'}));fireEvent.change(within(region).getByLabelText('Cure Wounds Healing Spell slot'),{target:{value}})}
 fireEvent.click(within(a).getByLabelText('Creature options for Priest A'));fireEvent.click(within(a).getByRole('button',{name:'Update spells & abilities'}))
 await waitFor(()=>expect(within(a).getByLabelText('Cure Wounds Healing Spell slot')).toHaveValue('1'))
 expect(within(b).getByLabelText('Cure Wounds Healing Spell slot')).toHaveValue('2')
 expect(within(b).getByText('Cure Wounds',{selector:'summary'}).closest('details')).toHaveAttribute('open')
 expect(executeAdmittedRoll).not.toHaveBeenCalled()
})


it('opts restored v2 venom into source d10 scoring without rewriting the kit', async()=>{
 const lib=useRollLibraryStore.getState();lib.addCreature(lib.token!,buildCreatureKitV2(catalog.find(c=>c.name==='Giant Scorpion')!))
 const original=JSON.stringify(useRollLibraryStore.getState().data)
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 fireEvent.click(screen.getByText('Giant Scorpion Venom',{selector:'summary'}));fireEvent.change(screen.getByLabelText('Giant Scorpion Venom Poison damage Venom stage'),{target:{value:'3'}})
 fireEvent.click(screen.getByRole('button',{name:'Roll Giant Scorpion Venom · Poison damage · 2d10'}))
 await waitFor(()=>expect(executeAdmittedRoll).toHaveBeenCalledTimes(1))
 expect(vi.mocked(executeAdmittedRoll).mock.calls[0][3]).toEqual({d10ZeroIsTen:true})
 expect(vi.mocked(executeAdmittedRoll).mock.calls[0][0]).toMatchObject({dice:[expect.objectContaining({type:'d10',quantity:2})]})
 expect(JSON.stringify(useRollLibraryStore.getState().data)).toBe(original)
})


it.each([1,2])('opts stored v%s base Dragon Bite into source reading without rewriting its snapshot', async version=>{
 const dragon=catalog.find(c=>c.name==='Young Red Dragon')!,scope=useRollLibraryStore.getState().scope!
 const kit=version===1?buildCreatureKit(dragon):buildCreatureKitV2(dragon)
 const data={version:1,groups:[],memberships:{},ungroupedCollapsed:false,instances:[{id:'stored-dragon',displayName:'Ember',collapsed:false,createdAt:37,kit}]}
 localStorage.setItem(scope,JSON.stringify(data));act(()=>{useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})})
 render(<SavedRollsPanel isOpen onClose={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Monster Manual'}))
 fireEvent.click(screen.getByRole('button',{name:/^Roll Ember .*2d10 \+ 6$/}))
 await waitFor(()=>expect(executeAdmittedRoll).toHaveBeenCalledTimes(1))
 expect(vi.mocked(executeAdmittedRoll).mock.calls[0][3]).toEqual({d10ZeroIsTen:true})
 expect(vi.mocked(executeAdmittedRoll).mock.calls[0][0]).toMatchObject({flatBonus:6,dice:[expect.objectContaining({type:'d10',quantity:2})]})
 expect(useRollLibraryStore.getState().data).toEqual(data)
 expect(JSON.parse(localStorage.getItem(scope)!)).toEqual(data)
})
