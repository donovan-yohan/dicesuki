import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { useAuthStore } from './useAuthStore'
import { useRollLibraryStore as library } from './useRollLibraryStore'
import { useSavedRollsStore } from './useSavedRollsStore'
import { catalog } from '../lib/monsterManual/catalog'
import { buildCreatureKit } from '../lib/rollLibrary'
const user = (id: string) => ({ id } as User)
const token = () => library.getState().token!
beforeEach(() => { localStorage.clear(); useAuthStore.setState({ status: 'loading', user: null }); useAuthStore.setState({ status: 'guest' }) })
describe('transactional device-local library', () => {
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
