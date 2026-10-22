import { expect, test, type Page, type Locator } from '@playwright/test'
async function boot(page: Page) {
  await page.addInitScript(()=>{if(!sessionStorage.getItem('qol-init')){localStorage.clear();sessionStorage.setItem('qol-init','1')}})
  await page.goto('/')
  const room=page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status','connected',{timeout:60000})
  await expect(room).toHaveAttribute('data-engine-ready','true')
  await expect(room).toHaveAttribute('data-table-revealed','true',{timeout:60000})
  return room
}
async function library(page: Page) {
  const panel=page.getByRole('dialog',{name:'My Dice Rolls',exact:true})
  if(!await panel.isVisible())await page.getByRole('button',{name:'My Dice Rolls',exact:true}).click()
  return panel
}
async function roster(page: Page){const panel=await library(page);await panel.getByRole('tab',{name:'Monster Manual',exact:true}).click();return panel}
async function add(page: Page,name: string,system: string){
  const panel=await roster(page);await panel.getByRole('button',{name:'Add creature',exact:true}).click()
  await panel.getByRole('button',{name:new RegExp(`^${name} · (NPC|Monster) · ${system}`)}).click()
  const addButton=panel.getByRole('button',{name:'Add creature kit',exact:true})
  await addButton.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()})
  await expect(panel.getByRole('status').filter({hasText:`${name} added`})).toBeVisible()
  return panel
}
async function total(page:Page,room:Locator,sequence:number,types:string[],bonus:number,keep=false){
  await expect(room).toHaveAttribute('data-roll-started-sequence',String(sequence),{timeout:30000})
  await expect(room).toHaveAttribute('data-room-dice-types',types.sort().join(','))
  await expect(page.getByRole('dialog',{name:'My Dice Rolls',exact:true})).toHaveCount(0)
  await expect(page.getByTestId('roll-grand-total')).toHaveText(/^-?\d+$/,{timeout:30000})
  const faces=(await page.getByTestId('result-die-chip').locator('span.text-lg').allTextContents()).map(Number)
  expect(faces).toHaveLength(types.length)
  expect(Number(await page.getByTestId('roll-grand-total').textContent())).toBe((keep?Math.max(...faces):faces.reduce((a,b)=>a+b,0))+bonus)
}
test('all eight complete kits persist, coexist, refresh safely and organization never rolls',async({page},info)=>{
  test.setTimeout(180000);const room=await boot(page)
  for(const [name,system] of [['Guard','5e'],['Priest','5e'],['Giant Spider','5e'],['Young Red Dragon','5e'],['Guard','PF2e'],['Apothecary','PF2e'],['Giant Scorpion','PF2e'],['Ogre Warrior','PF2e']])await add(page,name,system)
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dicesuki-roll-library:v1:guest')!))
  const saved=await read();expect(saved.instances).toHaveLength(8);expect(saved.instances.map((i:{kit:{cards:unknown[]}})=>i.kit.cards.length)).toEqual([9,8,10,12,9,9,8,7])
  await expect(room).toHaveAttribute('data-roll-started-sequence','0')
  const panel=await roster(page)
  await panel.getByRole('button',{name:'Add creature',exact:true}).click()
  await panel.getByRole('button',{name:'Refresh 5e SRD API'}).click()
  await expect(panel.locator('[data-provider="dnd5eapi"]')).toHaveAttribute('data-source-status','online',{timeout:25000})
  expect((await read()).instances).toEqual(saved.instances)
  await panel.getByRole('button',{name:'Back to roster'}).click()
  await panel.getByRole('region',{name:'Priest saved creature'}).getByRole('button',{name:/^▾ Priest/}).click()
  await page.reload();await expect(room).toHaveAttribute('data-table-revealed','true',{timeout:60000})
  await roster(page);await expect(panel.getByRole('region',{name:'Priest saved creature'}).getByRole('button',{name:/Priest · 8 rolls/})).toHaveAttribute('aria-expanded','false')
  expect((await read()).instances).toHaveLength(8)
  await expect(room).toHaveAttribute('data-roll-started-sequence','0')
  await info.attach('all-eight-kit-inventory',{body:JSON.stringify(await read(),null,2),contentType:'application/json'})
  const apothecary=panel.getByRole('region',{name:'Apothecary saved creature'});await apothecary.getByLabel('Creature options for Apothecary').click();page.once('dialog',d=>d.accept());await apothecary.getByRole('button',{name:'Remove instance'}).click();expect((await read()).instances).toHaveLength(7);await page.reload();await expect(room).toHaveAttribute('data-table-revealed','true',{timeout:60000});await roster(page);await expect(panel.getByRole('region',{name:'Apothecary saved creature'})).toHaveCount(0);await expect(panel.getByRole('region',{name:'Guard saved creature',exact:true})).toBeVisible()
})
test('new roster native attacks, damage, own saves, negative modifiers, MAP and keep-highest',async({page},info)=>{
 test.setTimeout(240000);const room=await boot(page)
 await add(page,'Guard','5e');await add(page,'Giant Spider','5e');await add(page,'Guard','PF2e');await add(page,'Young Red Dragon','5e')
 const scenarios=[
  {name:'Guard',pattern:/Spear · 1d20 \+ 3$/,types:['d20'],bonus:3},
  {name:'Guard',pattern:/Spear · piercing · immediate · Two-handed.*1d8 \+ 1$/,types:['d8'],bonus:1},
  {name:'Giant Spider',pattern:/Intelligence save · 1d20 - 4$/,types:['d20'],bonus:-4},
  {name:'Guard 2',pattern:/Fist · 1d20 - 1$/,option:'Guard 2 Fist attack this turn',value:'3',types:['d20'],bonus:-1},
  {name:'Young Red Dragon',pattern:/Bite · fire · immediate · 1d6$/,types:['d6'],bonus:0},
  {name:'Guard',pattern:/Spear · 2d20 kh1 \+ 3$/,option:'Guard Spear roll mode',value:'advantage',types:['d20','d20'],bonus:3,keep:true},
 ]
 let sequence=0;const receipts=[]
 for(const s of scenarios){const panel=await roster(page);const instance=panel.getByRole('region',{name:`${s.name} saved creature`,exact:true});if(s.option)await instance.getByRole('combobox',{name:s.option,exact:true}).selectOption(s.value!)
  const button=instance.getByRole('button',{name:s.pattern});await expect(button).toBeEnabled({timeout:30000});await button.click();await total(page,room,++sequence,[...s.types],s.bonus,s.keep)
  receipts.push({...s,pattern:String(s.pattern),sequence,total:await page.getByTestId('roll-grand-total').textContent()});await page.screenshot({path:info.outputPath(`native-${sequence}.png`)})
 }
 await info.attach('native-roster-receipts',{body:JSON.stringify(receipts,null,2),contentType:'application/json'})
})
test('personal groups, move, rename, duplicate, pin and removal preserve rolls',async({page})=>{
 const room=await boot(page)
 await page.evaluate(async()=>{
  const {useSavedRollsStore}=await import('/src/store/useSavedRollsStore.ts' as string)
  useSavedRollsStore.getState().addRoll({id:'legacy',name:'Lucky check',createdAt:1,flatBonus:2,dice:[{id:'d',type:'d20',quantity:1,perDieBonus:0}]})
 })
 const panel=await library(page);await panel.getByRole('button',{name:'New group'}).click();await panel.getByLabel('Group name').fill('Combat');await panel.getByRole('button',{name:'Save',exact:true}).click()
 await panel.getByLabel('More actions for Lucky check').click();await panel.getByRole('button',{name:'Move to group'}).click();await panel.getByLabel('Destination group').selectOption({label:'Combat'});await panel.getByRole('button',{name:'Apply',exact:true}).click()
 const group=panel.getByRole('region',{name:'Combat group'});await expect(group.getByRole('button',{name:'Roll Lucky check',exact:true})).toBeVisible()
 await group.getByLabel('Add to favorites').click();await group.getByLabel('More actions for Lucky check').click();await group.getByRole('button',{name:'Duplicate',exact:true}).click()
 await panel.getByLabel('Group options for Combat').click();await panel.getByRole('button',{name:'Rename group'}).click();await panel.getByLabel('Group name').fill('Battle');await panel.getByRole('button',{name:'Save',exact:true}).click()
 page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Remove group'}).click()
 await expect(panel.getByRole('region',{name:'Ungrouped group'}).getByRole('button',{name:'Roll Lucky check',exact:true})).toBeVisible()
 await page.reload();await expect(room).toHaveAttribute('data-table-revealed','true',{timeout:60000});await library(page)
 await expect(panel.getByRole('button',{name:'Roll Lucky check',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Roll Lucky check (Copy)',exact:true})).toBeVisible()
 await expect(room).toHaveAttribute('data-roll-started-sequence','0')
})
test('320/390/1280 tactile grids, keyboard tabs, repeat imports and CSS zoom reflow',async({page},info)=>{
 const room=await boot(page);await add(page,'Giant Spider','5e');await add(page,'Guard','PF2e');const panel=await roster(page)
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await panel.getByLabel('Find saved creatures').fill('Giant Spider')
  await expect(panel.getByRole('button',{name:/Roll Giant Spider.*Intelligence save/})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
  const controls=panel.getByRole('button',{name:/Roll Giant Spider/});const box=await controls.first().boundingBox();expect(box!.height).toBeGreaterThanOrEqual(88)
  await page.screenshot({path:info.outputPath(`grid-${width}.png`)})
 }
 await page.evaluate(()=>{document.documentElement.style.zoom='2'})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('css-zoom-200.png')});await page.evaluate(()=>{document.documentElement.style.zoom=''})
 await panel.getByRole('tab',{name:'Monster Manual',exact:true}).focus();await page.keyboard.press('ArrowLeft');await expect(panel.getByRole('tab',{name:'Personal rolls'})).toBeFocused()
 await page.keyboard.press('ArrowRight');await expect(panel.getByRole('tab',{name:'Monster Manual',exact:true})).toBeFocused()
 await panel.getByLabel('Find saved creatures').fill('');await panel.getByRole('button',{name:'Add creature',exact:true}).click();await page.keyboard.press('Escape');await expect(panel.getByRole('button',{name:'Add creature',exact:true})).toBeVisible()
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(page.getByRole('button',{name:'My Dice Rolls',exact:true})).toBeFocused();await expect(room).toHaveAttribute('data-roll-started-sequence','0')
})
