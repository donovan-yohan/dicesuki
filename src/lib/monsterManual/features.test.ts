import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { getCreatureFeatures, compileFeatureIntent, buildCreatureKitV2, validateStoredKit } from './features'
import oracles from '../../test/fixtures/featureOracles.json'
import legacy from '../../test/fixtures/legacyPriestKit.json'
const actor = (id: string) => catalog.find(c => c.source.sourceId === ({priest:'priest',dragon:'young-red-dragon',spider:'giant-spider',scorpion:'BWm17BRQYGMLqtNe',kobold:'JFmFuoOzCwc3hA1H'}[id]))!
function lookup(id: string) {
 const parts=id.split(':'); let feature=id,roll='damage'
 if(['attack','damage','check','diversion','living','undead'].includes(parts[2])){feature=parts.slice(0,2).join(':');roll=({attack:'spell-attack',diversion:'check',living:'healing',undead:'damage'} as Record<string,string>)[parts[2]]??parts[2]}
 if(id==='priest:cure-wounds')roll='healing'
 if(id==='kobold:tangle-vine')roll='spell-attack'
 if(id.endsWith(':recharge'))roll='recharge'
 return {feature,roll}
}
describe('reviewed actor-bounded feature compiler',()=>{
 it.each(oracles.cases)('matches source oracle $id $selection',oracle=>{
  const {feature,roll}=lookup(oracle.id);const selection=Object.fromEntries(Object.entries(oracle.selection).filter(([k])=>k!=='casterLevel').map(([k,v])=>[k,String(v)]))
  const def=getCreatureFeatures(actor(oracle.id.split(':')[0])).find(f=>f.id===feature)!
  const output=def.rolls.find(r=>r.id===roll)!
  for(const selector of output.selectors)selection[selector.id]??=selector.options[0].id
  const result=compileFeatureIntent(actor(oracle.id.split(':')[0]),feature,roll,selection)
  expect(result.flatBonus).toBe(oracle.expected.flatBonus);expect(result.dice[0]).toMatchObject({quantity:oracle.expected.count,type:`d${oracle.expected.sides}`,perDieBonus:0})
  if('damageType' in oracle)expect(result.damageType).toBe(oracle.damageType)
 })
 it('has ten Priest and nine PF spells with useful no-roll entries',()=>{
  expect(getCreatureFeatures(actor('priest')).filter(f=>f.kind==='spell')).toHaveLength(10)
  expect(getCreatureFeatures(actor('kobold')).filter(f=>f.kind==='spell')).toHaveLength(9)
  for(const o of oracles.noCasterRoll){const c=o.spellbook==='Priest'?actor('priest'):actor('kobold');const f=getCreatureFeatures(c).find(f=>f.id.endsWith(`:${o.id}`))!;expect(f.rolls).toEqual([]);expect(f.mechanics.join(' ').length).toBeGreaterThan(30)}
 })
 it('rejects undeclared slots, ranks, modes, extra and missing choices, and unreviewed clones',()=>{
  for(const selection of [{slot:'4'},{slot:'0'},{slot:'1.5'},{slot:'NaN'},{slot:1},{slot:'1',mode:'advantage'},{}])expect(()=>compileFeatureIntent(actor('priest'),'priest:cure-wounds','healing',selection as Record<string,string>)).toThrow()
  expect(()=>compileFeatureIntent(actor('kobold'),'kobold:tangle-vine','spell-attack',{rank:'2',ordinal:'1'})).toThrow()
  expect(()=>compileFeatureIntent(actor('kobold'),'kobold:tangle-vine','spell-attack',{rank:'1',ordinal:'1',mode:'advantage'})).toThrow()
  expect(()=>getCreatureFeatures(structuredClone(actor('priest')))).toThrow()
 })
 it('roundtrips v1 unchanged and bounded v2, and returns fresh execution copies',()=>{
  expect(validateStoredKit(legacy)).toEqual(legacy)
  for(const c of catalog){const kit=buildCreatureKitV2(c);expect(validateStoredKit(JSON.parse(JSON.stringify(kit)))).toEqual(kit)}
  const selection={slot:'1'};const a=compileFeatureIntent(actor('priest'),'priest:cure-wounds','healing',selection);a.flatBonus=90
  expect(compileFeatureIntent(actor('priest'),'priest:cure-wounds','healing',selection).flatBonus).toBe(3)
 })
})

describe('nested feature snapshot rejection',()=>{
 it.each(['extra','role','url','hash','duplicate','selection','quantity','rank','macro'] as const)('rejects malformed %s without weakening legacy v1',kind=>{
  const kit=JSON.parse(JSON.stringify(buildCreatureKitV2(actor(kind==='rank'?'kobold':'priest'))))
  const f=kit.features.find((f:{rolls:unknown[]})=>f.rolls.length),r=f.rolls[0]
  if(kind==='extra')f.extra='discard'
  if(kind==='role')r.kind=['damage']
  if(kind==='url')f.sources[0].url='javascript:alert(1)'
  if(kind==='hash')f.sources[0].sha256='changed'
  if(kind==='duplicate')kit.features.push(structuredClone(f))
  if(kind==='selection')r.variants[0].selection.unlisted='1'
  if(kind==='quantity')r.variants[0].roll.dice[0].quantity=31
  if(kind==='rank'){r.selectors.find((s:{id:string})=>s.id==='rank').options[0].id='2';r.variants.forEach((v:{selection:Record<string,string>})=>v.selection.rank='2')}
  if(kind==='macro')r.variants[0].roll.dice[0].formula='@Damage[1d6]'
  expect(()=>validateStoredKit(kit)).toThrow();expect(validateStoredKit(legacy)).toEqual(legacy)
 })
})

it('renders Sacred Flame at caster level 5 without generic first-level damage or resource counters',()=>{
 const features=getCreatureFeatures(actor('priest'))
 const sacred=features.find(f=>f.id==='priest:sacred-flame')!
 expect(sacred.mechanics.join(' ')).toContain('2d8 radiant')
 expect(sacred.mechanics.join(' ')).not.toContain('take 1d8')
 expect(features.flatMap(f=>f.mechanics).join(' ')).not.toContain('available')
})
