import { create } from 'zustand'
import { useAuthStore } from './useAuthStore'
import { createClientId } from '../lib/clientId'
import { LIBRARY_LIMITS, text, validateKit, type CreatureKit } from '../lib/rollLibrary'

interface Group { id: string; name: string; collapsed: boolean }
interface Instance { id: string; displayName: string; collapsed: boolean; createdAt: number; kit: CreatureKit }
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
      const instance={id:id(i.id),displayName:name(i.displayName),collapsed:bool(i.collapsed),createdAt,kit:validateKit(i.kit)}
      if(data.instances.some(i=>i.id===instance.id)) throw new Error('Duplicate instance'); data.instances.push(instance)
    } catch { dropped=true }
  }
  try {
    const entries=Object.entries(object(v.memberships)); if(entries.length>LIBRARY_LIMITS.memberships) throw new Error('Too many memberships')
    data.memberships=Object.fromEntries(entries.flatMap(([roll,group])=> {
      try { id(roll); const g=id(group); return data.groups.some(x=>x.id===g) ? [[roll,g]] : [] } catch {dropped=true;return []}
    }))
  } catch {dropped=true}
  data.ungroupedCollapsed=typeof v.ungroupedCollapsed==='boolean' ? v.ungroupedCollapsed : false
  return {data,dropped}
}
export function currentLibraryScope(): string | null {
  const auth=useAuthStore.getState()
  if(auth.status==='loading') return null
  if(auth.status==='guest') return 'dicesuki-roll-library:v1:guest'
  return auth.user?.id ? `dicesuki-roll-library:v1:user:${auth.user.id}` : null
}
interface Store {
  scope: string | null; token: string | null; data: LibraryData; notice: string | null
  addGroup: (token: string, name: string) => string
  editGroup: (token: string, id: string, delta: Partial<Pick<Group,'name'|'collapsed'>>) => void
  removeGroup: (token: string, id: string) => void
  moveRoll: (token: string, roll: string, group: string | null) => void
  collapseUngrouped: (token: string, collapsed: boolean) => void
  addCreature: (token: string, kit: CreatureKit) => string
  editInstance: (token: string, id: string, delta: Partial<Pick<Instance,'displayName'|'collapsed'>>) => void
  removeInstance: (token: string, id: string) => void
  resetCurrentScope: (token: string) => void
}
let epoch=0
export const useRollLibraryStore=create<Store>((set,get)=> {
  function commit(token: string, change: (data: LibraryData)=>LibraryData) {
    const state=get()
    if(!token || state.token!==token || !state.scope || state.scope!==currentLibraryScope()) throw new Error('Library account changed. Try again.')
    const data=change(state.data)
    // Storage commits before memory. Failed quota/permission never announces success.
    try {
      const encoded=JSON.stringify(data)
      if(new TextEncoder().encode(encoded).length>LIBRARY_LIMITS.bytes) throw new Error('Library storage limit reached')
      localStorage.setItem(state.scope,encoded)
    } catch {set({notice:'Could not save on this device. Free storage or allow site storage, then retry.'});throw new Error('Could not save library on this device.')}
    set({data,notice:null})
  }
  return { scope:null,token:null,data:empty(),notice:null,
    addGroup:(token,value)=>{const group={id:createClientId('group'),name:name(value),collapsed:false};commit(token,d=>{if(d.groups.length>=50)throw new Error('Maximum 50 groups');return {...d,groups:[...d.groups,group]}});return group.id},
    editGroup:(token,id,delta)=>commit(token,d=>({...d,groups:d.groups.map(g=>g.id===id?{...g,...(delta.name===undefined?{}:{name:name(delta.name)}),...(delta.collapsed===undefined?{}:{collapsed:bool(delta.collapsed)})}:g)})),
    removeGroup:(token,id)=>commit(token,d=>({...d,groups:d.groups.filter(g=>g.id!==id),memberships:Object.fromEntries(Object.entries(d.memberships).filter(([,g])=>g!==id))})),
    moveRoll:(token,roll,group)=>commit(token,d=>{id(roll);if(group!==null&&!d.groups.some(g=>g.id===group))throw new Error('Group no longer exists');const memberships={...d.memberships};delete memberships[roll];if(group)memberships[roll]=group;if(Object.keys(memberships).length>1000)throw new Error('Maximum 1000 memberships');return {...d,memberships,groups:d.groups.map(g=>g.id===group?{...g,collapsed:false}:g),ungroupedCollapsed:group?d.ungroupedCollapsed:false}}),
    collapseUngrouped:(token,collapsed)=>commit(token,d=>({...d,ungroupedCollapsed:bool(collapsed)})),
    addCreature:(token,value)=>{
      const kit=validateKit(value);const instanceId=createClientId('creature')
      commit(token,d=>{
        if(d.instances.length>=50)throw new Error('Maximum 50 creature kits')
        let displayName=kit.name;for(let n=2;d.instances.some(i=>i.displayName===displayName);n++)displayName=`${kit.name.slice(0,70)} ${n}`
        return {...d,instances:[...d.instances,{id:instanceId,displayName,collapsed:false,createdAt:Date.now(),kit}]}
      });return instanceId
    },
    editInstance:(token,id,delta)=>commit(token,d=>({...d,instances:d.instances.map(i=>i.id===id?{...i,...(delta.displayName===undefined?{}:{displayName:name(delta.displayName)}),...(delta.collapsed===undefined?{}:{collapsed:bool(delta.collapsed)})}:i)})),
    removeInstance:(token,id)=>commit(token,d=>({...d,instances:d.instances.filter(i=>i.id!==id)})),
    resetCurrentScope:token=>{commit(token,empty);set({token:`${++epoch}:${get().scope}`})},
  }
})
function selectScope() {
  const scope=currentLibraryScope();if(scope===useRollLibraryStore.getState().scope)return
  let data=empty();let notice: string|null=null
  if(scope)try {
    const raw=localStorage.getItem(scope)
    if(raw){if(new TextEncoder().encode(raw).length>LIBRARY_LIMITS.bytes)throw new Error('Oversized library');const checked=validateData(JSON.parse(raw));data=checked.data;if(checked.dropped)notice='Some invalid saved library entries were ignored.'}
  }catch {notice='Saved library could not be read. Personal rolls are unchanged.'}
  useRollLibraryStore.setState({scope,token:scope?`${++epoch}:${scope}`:null,data,notice})
}
// One synchronous app-lifetime subscription: no previous account paint or async scope effect.
useAuthStore.subscribe(selectScope)
selectScope()
