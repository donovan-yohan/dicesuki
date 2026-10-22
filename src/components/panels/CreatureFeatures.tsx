import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react'
import { resolveFeatureVariant, type FeatureDefinition, type Selection } from '../../lib/monsterManual/features'
import { formatSavedRoll } from '../../lib/diceHelpers'

export interface FeatureUiState { choices: Record<string, Selection>; queries: Record<string,string>; expanded: Record<string,boolean> }
interface Props {
  features: readonly FeatureDefinition[]
  disabled?: boolean
  onRoll?: (featureId:string, rollId:string, selection:Selection)=>void
  state?: FeatureUiState
  onStateChange?: Dispatch<SetStateAction<FeatureUiState>>
  prefix?: string
  sourceUrl: string
}
const field='field-focus-ring min-h-11 w-full min-w-0 rounded-lg bg-theme-bg px-2 py-2 text-sm text-theme-text'
export function CreatureFeatures({features,disabled=false,onRoll,sourceUrl,state,onStateChange,prefix=''}:Props) {
  const searchId=useId()
  const [local,setLocal]=useState<FeatureUiState>({choices:{},queries:{},expanded:{}})
  const ui=state??local,change=onStateChange??setLocal
  const query=ui.queries[prefix]??'',choices=ui.choices
  useEffect(()=>{if(!state)setLocal({choices:{},queries:{},expanded:{}})},[features,state])
  const matching=features.filter(f=>f.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <>{!!features.length&&<label htmlFor={searchId} className="block text-sm">Find spell or ability<input id={searchId} type="search" className={field} maxLength={120} value={query} onChange={e=>{const value=e.target.value;change(previous=>({...previous,queries:{...previous.queries,[prefix]:value}}))}}/></label>}{!!features.length&&!matching.length&&<p className="text-sm text-theme-text-secondary">No matching spells or abilities.</p>}{(['spell','ability'] as const).map(group=>{
    const entries=matching.filter(f=>group==='spell'?f.kind==='spell':f.kind!=='spell')
    if(!entries.length)return null
    return <section key={group} className="space-y-3" aria-label={group==='spell'?'Spellbook':'Special abilities'}>
      <h3 className="font-semibold">{group==='spell'?'Spellbook':'Special abilities'}</h3>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">{entries.map(feature=><details key={feature.id} className="min-w-0 rounded-xl border border-theme-border p-3" data-feature-id={feature.id} open={!!ui.expanded[`${prefix}${feature.id}`]} onToggle={e=>{const open=e.currentTarget.open,key=`${prefix}${feature.id}`;change(previous=>previous.expanded[key]===open?previous:{...previous,expanded:{...previous.expanded,[key]:open}})}}>
        <summary className="field-focus-ring min-h-11 cursor-pointer rounded py-2 font-semibold">{feature.name}</summary>
        <div className="space-y-3 pt-2 text-sm [overflow-wrap:anywhere]">
          {feature.mechanics.map((line,i)=><p key={i} className="whitespace-pre-line text-theme-text-secondary">{line}</p>)}
          {feature.target&&<p className="font-medium">{feature.target}</p>}
          {feature.rolls.map(roll=>{
            const key=`${prefix}${feature.id}:${roll.id}`
            const selection=Object.fromEntries(roll.selectors.map(s=>[s.id,s.options.some(o=>o.id===choices[key]?.[s.id])?choices[key][s.id]:s.options[0].id]))
            const variant=resolveFeatureVariant(roll,selection)
            return <div key={roll.id} className="space-y-2 rounded-lg bg-theme-bg/40 p-2" data-feature-roll={roll.id}>
              <div className="grid grid-cols-2 gap-2">{roll.selectors.map(selector=><label key={selector.id} className="min-w-0 text-xs">{selector.label}<select aria-label={`${feature.name} ${roll.label} ${selector.label}`} className={field} value={selection[selector.id]} onChange={e=>{const value=e.target.value;change(previous=>({...previous,choices:{...previous.choices,[key]:{...selection,[selector.id]:value}}}))}}>{selector.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>)}</div>
              {onRoll?<button className="field-focus-ring min-h-[88px] w-full rounded-lg bg-theme-bg p-3 text-left disabled:opacity-50" disabled={disabled} aria-label={`Roll ${feature.name} · ${roll.label} · ${formatSavedRoll(variant.roll)}`} onClick={()=>onRoll(feature.id,roll.id,selection)}><span className="block font-semibold">Roll {roll.label}</span><span className="font-mono text-theme-accent">{formatSavedRoll(variant.roll)}</span></button>:<p>{roll.label} · <span className="font-mono">{formatSavedRoll(variant.roll)}</span></p>}
            </div>
          })}
        </div>
      </details>)}</div>
    </section>
  })}
  {features.some(f=>f.sources.some(s=>s.url!==sourceUrl))&&<details className="text-xs text-theme-text-secondary"><summary className="field-focus-ring cursor-pointer rounded py-1">Spell sources</summary><div className="flex flex-wrap gap-x-3 gap-y-1 py-2">{Array.from(new Map(features.flatMap(f=>f.sources.filter(s=>s.url!==sourceUrl).map(s=>[s.url,{name:f.name,url:s.url}]))).values()).map(s=><a key={s.url} className="field-focus-ring rounded underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>)}</div></details>}
  </>
}
