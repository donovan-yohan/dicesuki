// Reviewed, actor-bounded translations. Source bytes/pointers are checked before emission.
import registry from './feature-registry.json' with { type: 'json' }

function at(raw, pointer) {
  const value = pointer.split('/').slice(1).reduce((v, key) => v?.[key], raw)
  if (value === undefined) throw new Error(`Missing reviewed feature pointer: ${pointer}`)
  return value
}
export async function importFeatures(creatures, rawActors, readSource, parse) {
  const result = {}
  const sourceRows = new Map()
  for (const row of registry) {
    const raw = JSON.parse((await readSource(row)).toString('utf8'))
    if (row.system === '5e' && (raw.index !== row.file.slice(3, -5) || raw.url !== `/api/2014/spells/${raw.index}`)) throw new Error('Spell source identity mismatch')
    sourceRows.set(row.file, { raw, row })
  }
  const proof = (c, raw, pointer, fragment, row) => {
    const value = at(raw, pointer)
    if (fragment !== undefined && (typeof value !== 'string' || !value.includes(fragment))) throw new Error(`Feature fragment changed: ${pointer}`)
    const s = row ? {sourceId: raw.index ?? raw._id, url:row.url, revision:row.revision, sha256:row.sha256,publication:row.publication,license:row.license,licenseUrl:row.system==='5e'?'https://creativecommons.org/licenses/by/4.0/':c.source.licenseUrl,noticeUrl:row.system==='5e'?'/licenses/monster-manual/5e-attribution.txt':c.source.noticeUrl} : c.source
    return {system:c.system,edition:c.edition,provider:c.provider,...Object.fromEntries(Object.entries(s).filter(([k])=>k!=='importedAt')),pointer,...(fragment===undefined?{}:{fragment})}
  }
  const selector = (id,label,values) => ({id,label,options:values.map(v=>({id:String(v),label:String(v)}))})
  const mode = selector('mode','Roll mode',['normal','advantage','disadvantage'])
  const ordinal = {id:'ordinal',label:'Attack this turn',options:[{id:'1',label:'1st attack'},{id:'2',label:'2nd attack · −5 MAP'},{id:'3',label:'3rd+ attack · −10 MAP'}]}
  function roll(c,id,label,kind,selectors,values,damageType) {
    const d20 = kind==='spell-attack'||(kind==='check'&&c.system==='5e')
    const extra = d20 ? c.system==='5e'?mode:ordinal : null
    const options = extra ? values.flatMap(v=>extra.options.map(o=>({...v,selection:{...v.selection,[extra.id]:o.id}}))) : values
    return {id,label,kind,...(damageType?{damageType}:{}),...(kind==='damage'?{timing:'immediate'}:{}),selectors:extra?[...selectors,extra]:selectors,variants:options.map((v,i)=>({id:String(i),label:Object.values(v.selection).join(' · ')||'Normal',selection:v.selection,recipe:parse(v.formula)}))}
  }
  const fixed = formula => [{selection:{},formula}]
  for(const c of creatures) {
    const raw=rawActors.get(c.source.sourceId), list=[]
    const add=(id,name,kind,mechanics,sources,rolls=[],target)=>{list.push({id,name,kind,mechanics,sources,rolls,...(target?{target}:{})})}
    if(c.source.sourceId==='priest') {
      const casting=raw.special_abilities[1].spellcasting
      if(casting.level!==5 || casting.modifier!==5 || casting.dc!==13 || raw.wisdom!==16)throw new Error('Priest casting contract changed')
      const ability=Math.floor((raw.wisdom-10)/2),dc=casting.dc,attack=casting.modifier
      const casterProof=proof(c,raw,'/special_abilities/1/spellcasting')
      for(const slug of ['light','sacred-flame','thaumaturgy','cure-wounds','guiding-bolt','sanctuary','lesser-restoration','spiritual-weapon','dispel-magic','spirit-guardians']) {
        const {raw:s,row}=sourceRows.get(`5e-${slug}.json`)
        if(!casting.spells.some(entry=>entry.url===`/api/2014/spells/${slug}`))throw new Error('Spell absent from prepared list')
        const sources=[proof(c,s,'/desc',undefined,row),casterProof],rolls=[]
        let mechanics=[`${s.casting_time} · ${s.range} · ${s.concentration?'Concentration · ':''}${s.duration}`, ...(slug==='spiritual-weapon'?s.desc.slice(0,2):slug==='spirit-guardians'?['15-foot aura. Creatures you designate are unaffected; other creatures have halved Speed. On entry or start of turn: Wisdom save, half damage on success. Good/neutral: radiant; evil: necrotic.']:s.desc)]
        if(slug==='guiding-bolt')mechanics=[mechanics[0],'Ranged spell attack; radiant damage. The next attack against the target before the end of your next turn has advantage.']
        if(slug==='sacred-flame')mechanics=[mechanics[0],'Caster level 5 · 2d8 radiant. The target gains no benefit from cover.']
        const slots=Array.from({length:4-Math.max(1,s.level)},(_,i)=>String(Math.max(1,s.level)+i))
        const slotSelector=selector('slot','Spell slot',slots)
        const substitute=formula=>{
          if(formula.includes('MOD')){if(!/^\d+d8 \+ MOD$/.test(formula))throw new Error('Unexpected modifier expression');return formula.replace('MOD',String(ability))}
          return formula
        }
        if(['guiding-bolt','spiritual-weapon'].includes(slug)){
          at(s,'/attack_type');rolls.push(roll(c,'spell-attack','Spell attack','spell-attack',[],fixed(`1d20+${attack}`)))
          const values=slots.map(slot=>({selection:{slot},formula:substitute(at(s,`/damage/0/damage_at_slot_level/${slot}`))}))
          slots.forEach(slot=>sources.push(proof(c,s,`/damage/0/damage_at_slot_level/${slot}`,undefined,row)))
          rolls.push(roll(c,'damage','Damage','damage',[slotSelector],values,s.damage[0].damage_type.index))
        }
        if(slug==='cure-wounds'){
          const values=slots.map(slot=>({selection:{slot},formula:substitute(at(s,`/heal_at_slot_level/${slot}`))}))
          slots.forEach(slot=>sources.push(proof(c,s,`/heal_at_slot_level/${slot}`,undefined,row)))
          sources.push(proof(c,raw,'/wisdom'));rolls.push(roll(c,'healing','Healing','healing',[slotSelector],values))
        }
        if(slug==='sacred-flame'){
          sources.push(proof(c,s,'/damage/0/damage_at_character_level/5',undefined,row));rolls.push(roll(c,'damage','Radiant damage','damage',[],fixed(at(s,'/damage/0/damage_at_character_level/5')),'radiant'))
        }
        if(slug==='spirit-guardians'){
          sources.push(proof(c,s,'/desc/1','3d8 radiant damage',row),proof(c,s,'/desc/1','3d8 necrotic damage',row))
          const r=roll(c,'damage','Damage','damage',[slotSelector,selector('damageType','Damage type',['radiant','necrotic'])],['radiant','necrotic'].map(damageType=>({selection:{slot:'3',damageType},formula:'3d8'})))
          rolls.push(r)
        }
        if(slug==='dispel-magic'){
          sources.push(proof(c,s,'/desc/0',"10 + the spell's level",row),proof(c,raw,'/wisdom'))
          rolls.push(roll(c,'check','Wisdom check','check',[],fixed(`1d20+${ability}`)))
        }
        if(s.level>0)mechanics.push(`Slot capacity: ${slots.map(slot=>`${slot} × ${({1:4,2:3,3:2})[slot]}`).join(', ')}`)
        const target=['sacred-flame','light'].includes(slug)?`Target: Dexterity save DC ${dc}${slug==='sacred-flame'?' · no damage on success':' · hostile held/worn object'}`:slug==='spirit-guardians'?`Target: Wisdom save DC ${dc} · half on success`:slug==='sanctuary'?`Attacker: Wisdom save DC ${dc}`:slug==='dispel-magic'?'Spell level ≤3: ends without a check. Level ≥4: Wisdom check DC 10 + target spell level.':undefined
        add(`priest:${slug}`,s.name,'spell',mechanics,sources,rolls,target)
      }
      const fragment='extra damage increases by 1d6 for each level above 1st'
      add('priest:divine-eminence','Divine Eminence','ability',[raw.special_abilities[0].desc],[proof(c,raw,'/special_abilities/0/desc',fragment)],[roll(c,'damage','Extra radiant damage','damage',[selector('slot','Spell slot',[1,2,3])],[1,2,3].map(slot=>({selection:{slot:String(slot)},formula:`${slot+2}d6`})),'radiant')])
    }
    for(const [index,a] of (raw.actions??[]).entries())if(a.usage?.type==='recharge on roll'){
      if(a.usage.dice!=='1d6'||a.usage.min_value!==5)throw new Error('Recharge contract changed')
      const prefix=c.source.sourceId==='young-red-dragon'?'dragon':'spider'
      add(`${prefix}:recharge`,`${a.name} recharge`,'recharge',['Roll 1d6; recharges on 5–6.'],[proof(c,raw,`/actions/${index}/usage`)],[roll(c,'recharge','Recharge','recharge',[],fixed(a.usage.dice))])
      if(prefix==='dragon')add('dragon:fire-breath',a.name,'ability',[a.desc],[proof(c,raw,`/actions/${index}/damage/0/damage_dice`)],[roll(c,'damage','Fire damage','damage',[],fixed(a.damage[0].damage_dice),'fire')],'Target: Dexterity save DC 17 · half on success')
    }
    if(c.source.sourceId==='BWm17BRQYGMLqtNe'){
      add('scorpion:constrict','Constrict','ability',['Requires a grabbed creature.'],[proof(c,raw,'/items/4/system/description/value','@Damage[(1d6+4)[bludgeoning]]')],[roll(c,'damage','Bludgeoning damage','damage',[],fixed('1d6+4'),'bludgeoning')],'Target: Fortitude save DC 20 · basic save')
      add('scorpion:venom','Giant Scorpion Venom','ability',['Stage 1: 1d10 poison, enfeebled 1. Stage 2: 2d10 poison, enfeebled 1. Stage 3: 2d10 poison, enfeebled 2. Each stage lasts 1 round; maximum duration 6 rounds.'],[proof(c,raw,'/items/5/system/description/value','1d10')],[roll(c,'damage','Poison damage','damage',[selector('stage','Venom stage',[1,2,3])],[1,2,3].map(stage=>({selection:{stage:String(stage)},formula:`${stage===1?1:2}d10`})),'poison')],'Target: Fortitude save DC 18')
    }
    if(c.source.sourceId==='JFmFuoOzCwc3hA1H'){
      const entry=raw.items[0];if(entry.system.spelldc.value!==10||entry.system.spelldc.dc!==18||entry.system.slots.slot1.max!==4||raw.system.details.level.value!==2)throw new Error('PF caster contract changed')
      const rank=selector('rank','Spell rank',[1])
      const descriptions={
        'caustic-blast':['2 actions · 30 feet · 5-foot burst.','1d8 acid; basic Reflex save. Critical failure also causes 1 persistent acid damage.'],
        'detect-magic':['2 actions · 30-foot emanation.','Detect presence or absence of magic; you can ignore known magic. Illusions are detected only when lower rank than this spell.'],
        figment:['2 actions · 30 feet · sustained.','Create a simple illusory sound (no words or elaborate music) or crude vision in a 5-foot cube. On casting or sustaining, you can Create a Diversion with a +2 circumstance bonus to Deception. Failure causes the creature to disbelieve.'],
        'fleet-step':['2 actions · 1 minute.','Gain a +30-foot status bonus to Speed.'],
        heal:['Rank 1 · 4 spell slots.','1 action: touch. 2 actions: 30 feet, +8 healing to a willing living creature. 3 actions: 30-foot emanation, all living and undead creatures. Undead take vitality damage with a basic Fortitude save; the +8 applies only to living healing.'],
        'know-the-way':['2 actions.','Know north and the direction to a location visited within the last 24 hours.'],
        'pummeling-rubble':['2 actions · 15-foot cone.','Reflex save: critical success no damage; success half; failure full damage and pushed 5 feet; critical failure double damage and pushed 10 feet.'],
        'runic-weapon':['2 actions · touch · 1 minute.','One unattended weapon or weapon held by a willing creature becomes a +1 striking weapon.'],
        'tangle-vine':['2 actions · 30 feet · 1 creature.','Spell attack: success gives −10-foot circumstance penalty to Speed for 1 round; critical success also immobilizes. Escape against spell DC 18 removes the effects. Failure has no effect.'],
      }
      for(let i=1;i<=9;i++){
        const item=raw.items[i],s=item.system,slug=s.slug
        if(item.type!=='spell'||s.publication.license!=='ORC'||!s.publication.remaster||s.publication.title!=='Pathfinder Player Core'||s.location.value!==entry._id||s.level.value!==1)throw new Error('Invalid embedded spell publication/location/rank')
        const pointer=`/items/${i}/system`,sources=[proof(c,raw,`${pointer}/description/value`),proof(c,raw,'/items/0/system/spelldc')],rolls=[]
        if(['caustic-blast','pummeling-rubble'].includes(slug)){
          const [key,d]=Object.entries(s.damage)[0];sources.push(proof(c,raw,`${pointer}/damage/${key}/formula`))
          rolls.push(roll(c,'damage','Damage','damage',[rank],[{selection:{rank:'1'},formula:d.formula}],d.type))
        }
        if(slug==='heal'){
          sources.push(proof(c,raw,`${pointer}/description/value`,'increase the Hit Points restored by 8'))
          for(const kind of ['healing','damage'])rolls.push(roll(c,kind,kind==='healing'?'Living healing':'Undead damage',kind,[rank,selector('actions','Actions',[1,2,3])],[1,2,3].map(actions=>({selection:{rank:'1',actions:String(actions)},formula:kind==='healing'&&actions===2?'1d8+8':'1d8'})),kind==='damage'?'vitality':undefined))
        }
        if(slug==='figment'){
          sources.push(proof(c,raw,`${pointer}/description/value`,'+2 circumstance bonus'),proof(c,raw,'/system/skills/deception/base'))
          rolls.push(roll(c,'check','Create a Diversion','check',[rank],[{selection:{rank:'1'},formula:`1d20+${raw.system.skills.deception.base+2}`}]))
        }
        if(slug==='tangle-vine')rolls.push(roll(c,'spell-attack','Spell attack','spell-attack',[rank],[{selection:{rank:'1'},formula:`1d20+${entry.system.spelldc.value}`}]))
        const target=slug==='heal'?'Undead target: Fortitude save DC 18 · basic save':slug==='caustic-blast'?'Target: Reflex save DC 18 · basic save':slug==='pummeling-rubble'?'Target: Reflex save DC 18 · degrees listed above':slug==='tangle-vine'?'Target: spell attack; Escape DC 18':undefined
        add(`kobold:${slug}`,item.name,'spell',descriptions[slug],sources,rolls,target)
      }
    }
    result[c.key]=list
  }
  return result
}
