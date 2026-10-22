import { create } from 'zustand'
import { useAuthStore } from './useAuthStore'
import { createClientId } from '../lib/clientId'
import { LIBRARY_LIMITS, text } from '../lib/rollLibrary'
import { kitFingerprint, validateStoredKit, type StoredKit } from '../lib/monsterManual/features'

interface Group { id: string; name: string; collapsed: boolean }
interface Instance { id: string; displayName: string; collapsed: boolean; createdAt: number; kit: StoredKit }
export interface LibraryData { version: 1; groups: Group[]; memberships: Record<string, string>; instances: Instance[]; ungroupedCollapsed: boolean }
const empty = (): LibraryData => ({ version: 1, groups: [], memberships: {}, instances: [], ungroupedCollapsed: false })
const name = (v: unknown) => text(v, LIBRARY_LIMITS.name).trim()
const id = (v: unknown) => { const s = text(v, 200); if (['__proto__','constructor','prototype'].includes(s)) throw new Error('Invalid library ID'); return s }
function bool(v: unknown) { if (typeof v !== 'boolean') throw new Error('Invalid library collapse'); return v }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid library object'); return v as Record<string, unknown> }
function validateData(value: unknown): { data: LibraryData; dropped: boolean } {
  const v = object(value)
  if (v.version !== 1 || !Array.isArray(v.groups) || !Array.isArray(v.instances) || v.groups.length > 50 || v.instances.length > 50) throw new Error('Unsupported library format or limits')
  const data = empty(); let dropped = false
  for (const raw of v.groups) {
    try { const g=object(raw); const group={ id:id(g.id),name:name(g.name),collapsed:bool(g.collapsed) }; if(data.groups.some(g=>g.id===group.id)) throw new Error('Duplicate group'); data.groups.push(group) } catch { dropped=true }
  }
  for (const raw of v.instances) {
    try {
      const i=object(raw); const createdAt=i.createdAt
      if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('Invalid instance time')
      const instance={id:id(i.id),displayName:name(i.displayName),collapsed:bool(i.collapsed),createdAt,kit:validateStoredKit(i.kit)}
      if(data.instances.some(i=>i.id===instance.id)) throw new Error('Duplicate instance'); data.instances.push(instance)
    } catch { dropped=true }
  }
  try {
    const entries=Object.entries(object(v.memberships)); if(entries.length>LIBRARY_LIMITS.memberships) throw new Error('Too many memberships')
    data.memberships=Object.fromEntries(entries.flatMap(([roll,group])=> {
      try { id(roll); const g=id(group); if(!data.groups.some(x=>x.id===g))throw new Error('Missing group'); return [[roll,g]] } catch {dropped=true;return []}
    }))
  } catch {dropped=true}
  try { data.ungroupedCollapsed=bool(v.ungroupedCollapsed) } catch {dropped=true}
  return {data,dropped}
}
function readScope(scope: string): { data: LibraryData; canWrite: boolean; notice: string | null } {
  const recovery='Library is read-only until its saved data is repaired or you reset this library. Personal rolls are unchanged.'
  try {
    const raw=localStorage.getItem(scope)
    if(raw===null)return {data:empty(),canWrite:true,notice:null}
    if(raw.length>LIBRARY_LIMITS.bytes || new TextEncoder().encode(raw).length>LIBRARY_LIMITS.bytes)throw new Error('Oversized library')
    const checked=validateData(JSON.parse(raw))
    return {data:checked.data,canWrite:!checked.dropped,notice:checked.dropped?`Some invalid saved library entries could not be read. ${recovery}`:null}
  } catch {return {data:empty(),canWrite:false,notice:`Saved library could not be read. ${recovery}`}}
}
export function currentLibraryScope(): string | null {
  const auth=useAuthStore.getState()
  if(auth.status==='loading') return null
  if(auth.status==='guest') return 'dicesuki-roll-library:v1:guest'
  return auth.user?.id ? `dicesuki-roll-library:v1:user:${auth.user.id}` : null
}
interface Store {
  scope: string | null; token: string | null; data: LibraryData; notice: string | null; canWrite: boolean
  addGroup: (token: string, name: string) => string
  editGroup: (token: string, id: string, delta: Partial<Pick<Group,'name'|'collapsed'>>) => void
  removeGroup: (token: string, id: string) => void
  moveRoll: (token: string, roll: string, group: string | null) => void
  collapseUngrouped: (token: string, collapsed: boolean) => void
  addCreature: (token: string, kit: StoredKit) => string
  updateInstanceKit: (token: string, instanceId: string, expectedKitFingerprint: string, nextKit: StoredKit) => void
  editInstance: (token: string, id: string, delta: Partial<Pick<Instance,'displayName'|'collapsed'>>) => void
  removeInstance: (token: string, id: string) => void
  resetCurrentScope: (token: string) => void
}
let epoch=0
export const useRollLibraryStore=create<Store>((set,get)=> {
  function commit(token: string, change: (data: LibraryData)=>LibraryData, reset=false) {
    const state=get()
    if(!token || state.token!==token || !state.scope || state.scope!==currentLibraryScope()) throw new Error('Library account changed. Try again.')
    // Rebase sequential stale-tab writes; localStorage is not a cross-tab transaction.
    const latest=reset?{data:empty(),canWrite:true,notice:null}:readScope(state.scope)
    if(!latest.canWrite){set({canWrite:false,notice:latest.notice});throw new Error(latest.notice!)}
    const data=change(latest.data)
    // Storage commits before memory. Failed quota/permission never announces success.
    try {
      const encoded=JSON.stringify(data)
      if(new TextEncoder().encode(encoded).length>LIBRARY_LIMITS.bytes) throw new Error('Library storage limit reached')
      localStorage.setItem(state.scope,encoded)
    } catch {set({notice:'Could not save on this device. Free storage or allow site storage, then retry.'});throw new Error('Could not save library on this device.')}
    set({data,notice:null,canWrite:true})
  }
  return { scope:null,token:null,data:empty(),notice:null,canWrite:false,
    addGroup:(token,value)=>{const group={id:createClientId('group'),name:name(value),collapsed:false};commit(token,d=>{if(d.groups.length>=50)throw new Error('Maximum 50 groups');return {...d,groups:[...d.groups,group]}});return group.id},
    editGroup:(token,id,delta)=>commit(token,d=>({...d,groups:d.groups.map(g=>g.id===id?{...g,...(delta.name===undefined?{}:{name:name(delta.name)}),...(delta.collapsed===undefined?{}:{collapsed:bool(delta.collapsed)})}:g)})),
    removeGroup:(token,id)=>commit(token,d=>({...d,groups:d.groups.filter(g=>g.id!==id),memberships:Object.fromEntries(Object.entries(d.memberships).filter(([,g])=>g!==id))})),
    moveRoll:(token,roll,group)=>commit(token,d=>{id(roll);if(group!==null&&!d.groups.some(g=>g.id===group))throw new Error('Group no longer exists');const memberships={...d.memberships};delete memberships[roll];if(group)memberships[roll]=group;if(Object.keys(memberships).length>1000)throw new Error('Maximum 1000 memberships');return {...d,memberships,groups:d.groups.map(g=>g.id===group?{...g,collapsed:false}:g),ungroupedCollapsed:group?d.ungroupedCollapsed:false}}),
    collapseUngrouped:(token,collapsed)=>commit(token,d=>({...d,ungroupedCollapsed:bool(collapsed)})),
    addCreature:(token,value)=>{
      const kit=validateStoredKit(value);const instanceId=createClientId('creature')
      commit(token,d=>{
        if(d.instances.length>=50)throw new Error('Maximum 50 creature kits')
        let displayName=kit.name;for(let n=2;d.instances.some(i=>i.displayName===displayName);n++)displayName=`${kit.name.slice(0,70)} ${n}`
        return {...d,instances:[...d.instances,{id:instanceId,displayName,collapsed:false,createdAt:Date.now(),kit}]}
      });return instanceId
    },
    updateInstanceKit:(token,instanceId,expected,nextKit)=>commit(token,d=>{
      const index=d.instances.findIndex(i=>i.id===instanceId)
      if(index<0)throw new Error('Creature no longer saved')
      if(typeof expected!=='string'||expected.length>LIBRARY_LIMITS.bytes||kitFingerprint(d.instances[index].kit)!==expected)throw new Error('Creature kit changed. Try again.')
      const kit=validateStoredKit(nextKit)
      if(kit.provenance.key!==d.instances[index].kit.provenance.key)throw new Error('Creature update source mismatch')
      return {...d,instances:d.instances.map((i,n)=>n===index?{...i,kit}:i)}
    }),
    editInstance:(token,id,delta)=>commit(token,d=>({...d,instances:d.instances.map(i=>i.id===id?{...i,...(delta.displayName===undefined?{}:{displayName:name(delta.displayName)}),...(delta.collapsed===undefined?{}:{collapsed:bool(delta.collapsed)})}:i)})),
    removeInstance:(token,id)=>commit(token,d=>({...d,instances:d.instances.filter(i=>i.id!==id)})),
    resetCurrentScope:token=>{commit(token,empty,true);set({token:`${++epoch}:${get().scope}`})},
  }
})
function selectScope() {
  const scope=currentLibraryScope();if(scope===useRollLibraryStore.getState().scope)return
  const loaded=scope?readScope(scope):{data:empty(),canWrite:false,notice:null}
  useRollLibraryStore.setState({scope,token:scope?`${++epoch}:${scope}`:null,...loaded})
}
// One synchronous app-lifetime subscription: no previous account paint or async scope effect.
useAuthStore.subscribe(selectScope)
selectScope()
