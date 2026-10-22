import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { useAuthStore } from './useAuthStore'
import { useRollLibraryStore as library } from './useRollLibraryStore'
import { useSavedRollsStore } from './useSavedRollsStore'
import { catalog } from '../lib/monsterManual/catalog'
import legacy from '../test/fixtures/legacyPriestKit.json'
import { buildCreatureKitV2, kitFingerprint, validateStoredKit } from '../lib/monsterManual/features'
import { buildCreatureKit, LIBRARY_LIMITS } from '../lib/rollLibrary'
const user = (id: string) => ({ id } as User)
const token = () => library.getState().token!
beforeEach(() => { localStorage.clear(); useAuthStore.setState({ status: 'loading', user: null }); useAuthStore.setState({ status: 'guest' }) })
describe('transactional device-local library', () => {
 it('applies sequential stale-view mutations to the latest validated disk library', () => {
  const t=token(),l=library.getState(),kit=buildCreatureKitV2(catalog.find(c=>c.name==='Priest')!)
  const instance=l.addCreature(t,validateStoredKit(legacy)),group=l.addGroup(t,'Original')
  const scope=library.getState().scope!,disk=JSON.parse(localStorage.getItem(scope)!)
  disk.groups.push({id:'other-tab',name:'Other tab',collapsed:false})
  disk.instances[0].displayName='Other tab alias';disk.instances[0].kit=kit
  disk.memberships.remote='other-tab';localStorage.setItem(scope,JSON.stringify(disk))
  expect(library.getState().data.groups).toHaveLength(1)
  l.collapseUngrouped(t,true)
  expect(JSON.parse(localStorage.getItem(scope)!)).toEqual({...disk,ungroupedCollapsed:true})
  l.addGroup(t,'Local addition')
  expect(library.getState().data.groups.map(g=>g.name)).toEqual(['Original','Other tab','Local addition'])
  expect(library.getState().data.instances[0]).toMatchObject({id:instance,displayName:'Other tab alias',kit})
  expect(library.getState().data.memberships.remote).toBe('other-tab')
  l.removeGroup(t,group)
  expect(library.getState().data.groups.map(g=>g.id)).toContain('other-tab')
 })
 it('checks kit compare-and-swap against disk rather than a stale tab snapshot', () => {
  const t=token(),l=library.getState(),old=validateStoredKit(legacy),instance=l.addCreature(t,old)
  const scope=library.getState().scope!,disk=JSON.parse(localStorage.getItem(scope)!)
  disk.instances[0].kit=buildCreatureKitV2(catalog.find(c=>c.name==='Priest')!)
  const bytes=JSON.stringify(disk);localStorage.setItem(scope,bytes)
  expect(()=>l.updateInstanceKit(t,instance,kitFingerprint(old),disk.instances[0].kit)).toThrow(/kit changed/i)
  expect(localStorage.getItem(scope)).toBe(bytes)
 })
 it('repeats atomic kit imports as independent instances, persists collapse/name and preserves source snapshot', () => {
  const t = token(); const kit = buildCreatureKit(catalog[0]); const a = library.getState().addCreature(t, kit); const b = library.getState().addCreature(t, kit)
  expect(a).not.toBe(b); expect(library.getState().data.instances.map(i => i.displayName)).toEqual([kit.name, `${kit.name} 2`])
  library.getState().editInstance(t, a, { displayName: 'Alpha', collapsed: true })
  useAuthStore.setState({ status: 'loading' }); useAuthStore.setState({ status: 'guest' })
  expect(library.getState().data.instances[0]).toMatchObject({ displayName: 'Alpha', collapsed: true, kit })
  library.getState().removeInstance(token(), a); expect(library.getState().data.instances.map(i => i.id)).toEqual([b])
 })
 it('groups move/remove without changing personal rolls, revisions or tombstones', () => {
  const personal = { id:'p', name:'Personal', createdAt:1, updatedAt:3, flatBonus:0, dice:[] }
  useSavedRollsStore.setState({ savedRolls:[personal], deletedRolls:{ gone:4 } })
  const t=token(); const g=library.getState().addGroup(t,'Combat')
  library.getState().moveRoll(t,'p',g); library.getState().editGroup(t,g,{ name:'Fight',collapsed:true })
  expect(library.getState().data.memberships.p).toBe(g)
  library.getState().moveRoll(t,'p',null);expect(library.getState().data.memberships.p).toBeUndefined();library.getState().moveRoll(t,'p',g)
  library.getState().removeGroup(t,g)
  expect(library.getState().data.memberships.p).toBeUndefined()
  expect(useSavedRollsStore.getState().savedRolls).toEqual([personal]); expect(useSavedRollsStore.getState().deletedRolls).toEqual({ gone:4 })
 })
 it('partitions guest/A/B/loading, rejects stale and ABA callbacks, same-user refresh retains token', () => {
  const guest=token(); library.getState().addGroup(guest,'Guest')
  useAuthStore.setState({ status:'authenticated',user:user('A') }); const a=token(); library.getState().addGroup(a,'A')
  useAuthStore.setState({ user:user('A') }); expect(token()).toBe(a)
  useAuthStore.setState({ status:'loading' }); expect(library.getState().data.groups).toEqual([])
  expect(() => library.getState().addGroup(a,'late')).toThrow()
  useAuthStore.setState({ status:'authenticated',user:user('B') }); expect(library.getState().data.groups).toEqual([])
  useAuthStore.setState({ user:user('A') }); expect(library.getState().data.groups[0].name).toBe('A')
  expect(() => library.getState().addGroup(a,'ABA')).toThrow()
  useAuthStore.setState({ status:'guest',user:null }); expect(library.getState().data.groups[0].name).toBe('Guest')
 })
 it('quota failure never commits or claims successful save; reset only clears current partition', () => {
  library.getState().addGroup(token(),'Guest'); const before=library.getState().data
  const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('quota')})
  expect(() => library.getState().addCreature(token(),buildCreatureKit(catalog[0]))).toThrow(/save/i)
  expect(library.getState().data).toBe(before); storage.mockRestore()
  useAuthStore.setState({status:'authenticated',user:user('A')}); library.getState().addGroup(token(),'A'); const beforeReset=token(); library.getState().resetCurrentScope(beforeReset);expect(token()).not.toBe(beforeReset);expect(()=>library.getState().addCreature(beforeReset,buildCreatureKit(catalog[0]))).toThrow(/account changed/i)
  useAuthStore.setState({status:'guest',user:null}); expect(library.getState().data.groups[0].name).toBe('Guest')
 })
 it('isolates malformed kit entries and retains valid groups and personal data', () => {
  const t=token(); library.getState().addGroup(t,'Good'); library.getState().addCreature(t,buildCreatureKit(catalog[0]))
  const key=library.getState().scope!; const raw=JSON.parse(localStorage.getItem(key)!); raw.instances.push({id:'bad',kit:{}});const malformed=structuredClone(raw.instances[0]);malformed.id='bad-role';malformed.kit.cards[0].role=['attack'];raw.instances.push(malformed);const personalBefore=useSavedRollsStore.getState().savedRolls;localStorage.setItem(key,JSON.stringify(raw))
  useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})
  expect(library.getState().data.instances).toHaveLength(1);expect(useSavedRollsStore.getState().savedRolls).toBe(personalBefore);expect(library.getState().data.groups[0].name).toBe('Good');expect(library.getState().notice).toMatch(/invalid/i)
 })
 it('rejects asynchronous import completion after scope reset and preserves pending hydration membership without resurrection', async () => {
  const old=token(); const kit=buildCreatureKit(catalog[0]); const group=library.getState().addGroup(old,'Hydrating')
  library.getState().moveRoll(old,'remote',group)
  useSavedRollsStore.setState({savedRolls:[],deletedRolls:{remote:8}})
  expect(library.getState().data.memberships.remote).toBe(group)
  expect(useSavedRollsStore.getState().savedRolls).toEqual([])
  const pending=Promise.resolve().then(()=>library.getState().addCreature(old,kit))
  useAuthStore.setState({status:'authenticated',user:user('next')})
  await expect(pending).rejects.toThrow(/account changed/i)
  expect(library.getState().data.instances).toEqual([])
  useAuthStore.setState({status:'guest',user:null})
  expect(library.getState().data.memberships.remote).toBe(group)
  expect(useSavedRollsStore.getState().deletedRolls.remote).toBe(8)
 })

})

describe('rejected library write barrier',()=>{
 const kit=validateStoredKit(legacy)
 const valid=()=>({version:1,groups:[{id:'kept',name:'Kept',collapsed:false}],memberships:{personal:'kept'},ungroupedCollapsed:false,instances:[{id:'saved',displayName:'Priest',collapsed:false,createdAt:1,kit}]})
 const mutations={
  addGroup:()=>library.getState().addGroup(token(),'New'),
  editGroup:()=>library.getState().editGroup(token(),'kept',{name:'Changed'}),
  removeGroup:()=>library.getState().removeGroup(token(),'kept'),
  moveRoll:()=>library.getState().moveRoll(token(),'personal',null),
  collapse:()=>library.getState().collapseUngrouped(token(),true),
  addCreature:()=>library.getState().addCreature(token(),kit),
  updateKit:()=>library.getState().updateInstanceKit(token(),'saved',kitFingerprint(kit),kit),
  editInstance:()=>library.getState().editInstance(token(),'saved',{displayName:'Changed'}),
  removeInstance:()=>library.getState().removeInstance(token(),'saved'),
 }
 const rejected=[
  ['invalid JSON',()=>'{broken'],
  ['empty bytes',()=>''],
  ['future version',()=>JSON.stringify({...valid(),version:2})],
  ['oversized bytes',()=>JSON.stringify(valid())+' '.repeat(LIBRARY_LIMITS.bytes)],
  ['partial nested kit',()=>JSON.stringify({...valid(),instances:[...valid().instances,{...valid().instances[0],id:'invalid',kit:{...kit,cards:[{...kit.cards[0],role:['attack']}]}}]})],
  ['partial group',()=>JSON.stringify({...valid(),groups:[...valid().groups,{id:'bad',name:42,collapsed:false}]})],
  ['dangling membership',()=>JSON.stringify({...valid(),memberships:{personal:'missing'}})],
  ['invalid collapse',()=>JSON.stringify({...valid(),ungroupedCollapsed:'false'})],
 ] as const
 for(const phase of ['on load','after load'] as const)it.each(rejected)(`preserves %s ${phase} across every ordinary mutation`,(_label,bytes)=>{
  const scope=library.getState().scope!,personal=useSavedRollsStore.getState(),raw=bytes()
  if(phase==='after load'){
   localStorage.setItem(scope,JSON.stringify(valid()));useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})
  }
  localStorage.setItem(scope,raw)
  if(phase==='on load'){useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})}
  for(const [action,mutate] of Object.entries(mutations)){
   expect.soft(mutate,action).toThrow()
   expect.soft(localStorage.getItem(scope)===raw,`${action} must preserve original bytes`).toBe(true)
  }
  expect(library.getState().token).toBeTruthy()
  expect(library.getState().canWrite).toBe(false)
  expect(library.getState().notice).toMatch(/read.only|could not be read/i)
  expect(useSavedRollsStore.getState()).toBe(personal)
 })
 it.each(['on load','after load'])('blocks unreadable storage %s without losing original bytes',phase=>{
  const scope=library.getState().scope!,raw=JSON.stringify(valid());localStorage.setItem(scope,raw)
  const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('storage denied')})
  try{
   if(phase==='on load'){useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})}
   for(const [action,mutate] of Object.entries(mutations))expect.soft(mutate,action).toThrow()
   expect(library.getState().canWrite).toBe(false)
   expect(library.getState().token).toBeTruthy()
  }finally{read.mockRestore()}
  expect(localStorage.getItem(scope)).toBe(raw)
 })
 it('allows only explicit current-scope reset to discard rejected data and retires old callbacks',()=>{
  const guest=library.getState().scope!,raw='{guest-invalid';localStorage.setItem(guest,raw)
  useAuthStore.setState({status:'authenticated',user:user('A')})
  const scope=library.getState().scope!,personal=useSavedRollsStore.getState();localStorage.setItem(scope,'{"version":99}')
  useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'authenticated',user:user('A')})
  const old=token();expect(library.getState().canWrite).toBe(false)
  library.getState().resetCurrentScope(old)
  expect(library.getState().canWrite).toBe(true);expect(token()).not.toBe(old)
  expect(JSON.parse(localStorage.getItem(scope)!)).toEqual({version:1,groups:[],memberships:{},instances:[],ungroupedCollapsed:false})
  expect(localStorage.getItem(guest)).toBe(raw);expect(useSavedRollsStore.getState()).toBe(personal)
  expect(()=>library.getState().resetCurrentScope(old)).toThrow(/account changed/i)
  library.getState().addGroup(token(),'After reset')
 })
 it('can save again after backing data is repaired without resetting valid recovered rows',()=>{
  const scope=library.getState().scope!;localStorage.setItem(scope,JSON.stringify({...valid(),instances:[...valid().instances,{id:'bad'}]}))
  useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})
  expect(library.getState().canWrite).toBe(false);expect(library.getState().data.instances).toHaveLength(1)
  localStorage.setItem(scope,JSON.stringify(valid()))
  library.getState().addGroup(token(),'After repair')
  expect(library.getState().canWrite).toBe(true);expect(library.getState().notice).toBeNull()
  expect(library.getState().data.instances).toEqual(valid().instances)
 })
 it('keeps missing fresh scopes writable without a recovery notice',()=>{
  expect(library.getState().canWrite).toBe(true);expect(library.getState().notice).toBeNull()
  library.getState().addGroup(token(),'First group');expect(library.getState().data.groups[0].name).toBe('First group')
 })
})

describe('explicit feature snapshot update',()=>{
 it('replaces only the requested kit and keeps alias, collapse, order, time, duplicate and groups',()=>{
  const l=library.getState(),t=token(),priest=catalog.find(c=>c.name==='Priest')!
  const first=l.addCreature(t,validateStoredKit(legacy)),second=l.addCreature(t,validateStoredKit(legacy));l.editInstance(t,first,{displayName:'Sister Mira',collapsed:true});const group=l.addGroup(t,'Combat');l.moveRoll(t,'personal',group)
  const before=library.getState().data,old=before.instances[0],next=buildCreatureKitV2(priest)
  library.getState().updateInstanceKit(t,first,kitFingerprint(old.kit),next)
  expect(library.getState().data).toEqual({...before,instances:[{...old,kit:next},before.instances[1]]})
  expect(library.getState().data.instances[1].id).toBe(second)
  useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})
  expect(library.getState().data.instances.map(i=>i.kit.version)).toEqual([2,1])
 })
 it('rejects stale fingerprints/tokens, removed instances and quota failure without replacing data',()=>{
  const t=token(),id=library.getState().addCreature(t,validateStoredKit(legacy)),old=library.getState().data.instances[0],next=buildCreatureKitV2(catalog.find(c=>c.name==='Priest')!)
  const before=library.getState().data
  expect(()=>library.getState().updateInstanceKit(t,id,'stale',next)).toThrow();expect(library.getState().data).toBe(before)
  const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')})
  expect(()=>library.getState().updateInstanceKit(t,id,kitFingerprint(old.kit),next)).toThrow();expect(library.getState().data).toBe(before);storage.mockRestore()
  library.getState().removeInstance(t,id);expect(()=>library.getState().updateInstanceKit(t,id,kitFingerprint(old.kit),next)).toThrow()
  useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'});expect(()=>library.getState().updateInstanceKit(t,id,kitFingerprint(old.kit),next)).toThrow()
 })
 it('isolates malformed nested v2 while retaining valid v1/v2 and groups on reload',()=>{
  const t=token();library.getState().addGroup(t,'Kept');library.getState().addCreature(t,validateStoredKit(legacy));library.getState().addCreature(t,buildCreatureKitV2(catalog.find(c=>c.name==='Priest')!))
  const scope=library.getState().scope!,raw=JSON.parse(localStorage.getItem(scope)!);const corrupt=structuredClone(raw.instances[1]);corrupt.id='corrupt-feature';corrupt.kit.features[0].sources[0].url='javascript:bad';raw.instances.push(corrupt);localStorage.setItem(scope,JSON.stringify(raw))
  useAuthStore.setState({status:'loading'});useAuthStore.setState({status:'guest'})
  expect(library.getState().data.instances).toHaveLength(2);expect(library.getState().data.groups[0].name).toBe('Kept');expect(library.getState().notice).toMatch(/invalid/)
 })
})
