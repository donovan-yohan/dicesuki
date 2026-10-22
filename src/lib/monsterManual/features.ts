import type { Creature, Recipe } from './types'
import type { SavedRoll } from '../../types/savedRolls'
import templates from '../../generated/monsterFeatures.json'
import { catalog } from './catalog'
import { compileRecipe } from './rollIntent'
import { pfStrikeBonus } from './rules/pf2e'
import { createClientId } from '../clientId'
import { array, buildCreatureKit, exact, integer, record, text, url, validateKit, validateKitRoll, type CreatureKit } from '../rollLibrary'

export type FeatureKind = 'spell' | 'ability' | 'recharge'
export type FeatureRollKind = 'spell-attack' | 'damage' | 'healing' | 'check' | 'recharge'
export type Selection = Readonly<Record<string, string>>
export interface SourceProof {
  system: Creature['system']; edition: string; provider: Creature['provider']
  sourceId: string; url: string; revision: string; sha256: string
  publication: string; license: string; licenseUrl: string; noticeUrl: string
  pointer: string; fragment?: string
}
export interface FeatureSelector { id: string; label: string; options: readonly { id: string; label: string }[] }
export interface FeatureVariant { id: string; label: string; selection: Selection; roll: SavedRoll }
export interface FeatureRoll {
  id: string; label: string; kind: FeatureRollKind; damageType?: string
  timing?: 'immediate' | 'conditional' | 'persistent' | 'splash'
  selectors: readonly FeatureSelector[]; variants: readonly FeatureVariant[]
}
export interface FeatureDefinition {
  id: string; name: string; kind: FeatureKind; mechanics: readonly string[]; target?: string
  sources: readonly SourceProof[]; rolls: readonly FeatureRoll[]
}
export interface CreatureKitV2 extends Omit<CreatureKit, 'version'> { version: 2; features: FeatureDefinition[] }
export type StoredKit = CreatureKit | CreatureKitV2
interface Template extends Omit<FeatureDefinition, 'rolls'> { rolls: (Omit<FeatureRoll,'variants'> & {variants: {id:string;label:string;selection:Selection;recipe:Recipe}[]})[] }
const featureTemplates = templates as unknown as Record<string, Template[]>
export function getCreatureFeatures(creature: Creature): readonly FeatureDefinition[] {
  if (!catalog.includes(creature)) throw new Error('Unreviewed creature revision')
  return structuredClone(featureTemplates[creature.key] ?? []).map(feature => ({...feature, rolls: feature.rolls.map(roll => ({...roll,variants:roll.variants.map(variant=>{
    const recipe={...variant.recipe}
    if(roll.kind==='spell-attack' && creature.system==='pf2e')recipe.bonus=pfStrikeBonus(recipe.bonus,[],Number(variant.selection.ordinal))
    const mode=creature.system==='5e'&&(roll.kind==='spell-attack'||roll.kind==='check')?variant.selection.mode:undefined
    return {id:variant.id,label:variant.label,selection:{...variant.selection},roll:compileRecipe(creature,recipe,`${feature.name} · ${roll.label}`,roll.damageType??variant.selection.damageType,mode)}
  })}))}))
}
export function resolveFeatureVariant(roll: FeatureRoll, selection: Selection): FeatureVariant {
  const supplied=record(selection)
  if(Object.keys(supplied).length!==roll.selectors.length || Object.keys(supplied).some(key=>!roll.selectors.some(s=>s.id===key)))throw new Error('Invalid feature selection keys')
  for(const selector of roll.selectors)if(typeof supplied[selector.id]!=='string'||!selector.options.some(o=>o.id===supplied[selector.id]))throw new Error('Invalid feature selection value')
  const variant=roll.variants.find(v=>roll.selectors.every(s=>v.selection[s.id]===selection[s.id]))
  if(!variant)throw new Error('Feature combination is unavailable')
  return variant
}
export function freshFeatureRoll(roll: SavedRoll): SavedRoll {
  return {...validateKitRoll(roll),id:createClientId('feature-roll'),createdAt:Date.now(),dice:roll.dice.map(d=>({...d,id:createClientId('feature-dice')}))}
}
export function compileFeatureIntent(creature: Creature, featureId: string, rollId: string, selection: Selection): SavedRoll {
  const feature=getCreatureFeatures(creature).find(f=>f.id===featureId)
  const roll=feature?.rolls.find(r=>r.id===rollId)
  if(!roll)throw new Error('Unknown creature feature roll')
  return freshFeatureRoll(resolveFeatureVariant(roll,selection).roll)
}
export function buildCreatureKitV2(creature: Creature): CreatureKitV2 {
  return validateStoredKit({...buildCreatureKit(creature),version:2,features:getCreatureFeatures(creature)}) as CreatureKitV2
}
const unique = <T extends {id:string}>(values:T[]):T[] => {if(new Set(values.map(v=>v.id)).size!==values.length)throw new Error('Duplicate feature identifier');return values}
function sourceProof(value:unknown,system:Creature['system'],provider:Creature['provider']):SourceProof {
  const v=record(value);exact(v,['system','edition','provider','sourceId','url','revision','sha256','publication','license','licenseUrl','noticeUrl','pointer','fragment'])
  if(v.system!==system || v.provider!==provider)throw new Error('Feature source system mismatch')
  const sha256=text(v.sha256);if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Invalid feature source hash')
  const pointer=text(v.pointer,1000);if(!pointer.startsWith('/'))throw new Error('Invalid source pointer')
  return {system,provider,edition:text(v.edition),sourceId:text(v.sourceId),url:url(v.url),revision:text(v.revision),sha256,publication:text(v.publication),license:text(v.license),licenseUrl:url(v.licenseUrl,true),noticeUrl:url(v.noticeUrl,true),pointer,...(v.fragment===undefined?{}:{fragment:text(v.fragment,8000)})}
}
export function validateStoredKit(value: unknown): StoredKit {
  const v=record(value)
  if(v.version===1)return validateKit(value)
  if(v.version!==2)throw new Error('Unsupported saved kit version')
  exact(v,['version','name','provenance','cards','constants','notes','features'])
  const base=validateKit({version:1,name:v.name,provenance:v.provenance,cards:v.cards,constants:v.constants,notes:v.notes})
  const features=unique(array(v.features,64).map(value=>{
    const f=record(value);exact(f,['id','name','kind','mechanics','target','sources','rolls'])
    if(typeof f.kind!=='string'||!['spell','ability','recharge'].includes(f.kind))throw new Error('Invalid feature kind')
    const sources=array(f.sources,16).map(s=>sourceProof(s,base.provenance.system,base.provenance.provider));if(!sources.length)throw new Error('Missing feature source')
    const rolls=unique(array(f.rolls,8).map(value=>{
      const r=record(value);exact(r,['id','label','kind','damageType','timing','selectors','variants'])
      if(typeof r.kind!=='string'||!['spell-attack','damage','healing','check','recharge'].includes(r.kind))throw new Error('Invalid feature roll kind')
      if(r.timing!==undefined&&(typeof r.timing!=='string'||!['immediate','conditional','persistent','splash'].includes(r.timing)))throw new Error('Invalid feature timing')
      const selectors=unique(array(r.selectors,4).map(value=>{const s=record(value);exact(s,['id','label','options']);const options=unique(array(s.options,16).map(value=>{const o=record(value);exact(o,['id','label']);return{id:text(o.id,80),label:text(o.label,200)}}));if(!options.length)throw new Error('Empty feature selector');return{id:text(s.id,80),label:text(s.label,200),options}}))
      for(const selector of selectors){
        if(!['slot','rank','stage','actions','mode','ordinal','damageType'].includes(selector.id))throw new Error('Unknown feature selector')
        if(['slot','stage','actions','ordinal'].includes(selector.id)&&selector.options.some(o=>!['1','2','3'].includes(o.id)))throw new Error('Invalid bounded selector')
        if(selector.id==='rank'&&selector.options.some(o=>o.id!=='1'))throw new Error('Rank outside actor bounds')
        if(selector.id==='damageType'&&selector.options.some(o=>!['radiant','necrotic'].includes(o.id)))throw new Error('Invalid damage alternative')
      }
      const modeOptions=selectors.find(s=>s.id==='mode')?.options.map(o=>o.id).join('|')
      const ordinalOptions=selectors.find(s=>s.id==='ordinal')?.options.map(o=>o.id).join('|')
      if(base.provenance.system==='5e'&&['spell-attack','check'].includes(r.kind as string)&&modeOptions!=='normal|advantage|disadvantage')throw new Error('Missing 5e d20 modes')
      if(base.provenance.system==='pf2e'&&r.kind==='spell-attack'&&ordinalOptions!=='1|2|3')throw new Error('Missing PF attack ordinals')
      const combinations=selectors.reduce((n,s)=>n*s.options.length,1);if(combinations>32)throw new Error('Too many feature combinations')
      const variants=unique(array(r.variants,32).map(value=>{
        const v=record(value);exact(v,['id','label','selection','roll']);const selection=record(v.selection)
        if(Object.keys(selection).length!==selectors.length||Object.keys(selection).some(key=>!selectors.some(s=>s.id===key)))throw new Error('Invalid stored selection keys')
        const checked:Record<string,string>={};for(const s of selectors){checked[s.id]=text(selection[s.id],80);if(!s.options.some(o=>o.id===checked[s.id]))throw new Error('Invalid stored selection')}
        const roll=validateKitRoll(v.roll),die=roll.dice[0]
        if(['spell-attack','check'].includes(r.kind as string)&&(die.type!=='d20'||die.quantity!==1))throw new Error('Invalid feature d20')
        if(r.kind==='recharge'&&(die.type!=='d6'||die.quantity!==1||roll.flatBonus!==0))throw new Error('Invalid recharge recipe')
        const mode=checked.mode,ordinal=checked.ordinal
        if(mode!==undefined&&(base.provenance.system!=='5e'||!['spell-attack','check'].includes(r.kind as string)||!['normal','advantage','disadvantage'].includes(mode)))throw new Error('Invalid feature d20 mode')
        if(ordinal!==undefined&&(base.provenance.system!=='pf2e'||r.kind!=='spell-attack'||!['1','2','3'].includes(ordinal)))throw new Error('Invalid feature MAP')
        if(mode==='advantage'||mode==='disadvantage') {if(die.rollCount!==2||die.keepMode!==(mode==='advantage'?'highest':'lowest'))throw new Error('Invalid feature keep mode')}
        else if(die.keepMode||(die.rollCount!==undefined&&die.rollCount!==die.quantity))throw new Error('Unexpected feature keep mode')
        // Slot/rank/stage/action bounds are additionally actor-defined by the stored selector's finite set.
        for(const key of ['slot','rank','stage','actions'])if(checked[key]!==undefined)integer(Number(checked[key]),1,key==='rank'?1:3)
        return{id:text(v.id,200),label:text(v.label,500),selection:checked,roll}
      }))
      const keys=variants.map(v=>JSON.stringify(selectors.map(s=>v.selection[s.id])));if(variants.length!==combinations||new Set(keys).size!==keys.length)throw new Error('Incomplete or duplicate feature combinations')
      return {id:text(r.id),label:text(r.label),kind:r.kind as FeatureRollKind,selectors,variants,...(r.damageType===undefined?{}:{damageType:text(r.damageType)}),...(r.timing===undefined?{}:{timing:r.timing as FeatureRoll['timing']})}
    }))
    return {id:text(f.id),name:text(f.name),kind:f.kind as FeatureKind,mechanics:array(f.mechanics,32).map(n=>text(n,8000)),sources,rolls,...(f.target===undefined?{}:{target:text(f.target,2000)})}
  }))
  return {...base,version:2,features}
}
/** Exact serialized snapshot for synchronous stale-update comparison; bounded by library envelope. */
export function kitFingerprint(kit: StoredKit): string { return JSON.stringify(kit) }
