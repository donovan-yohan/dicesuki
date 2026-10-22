import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { refreshProvider, verifySource, verifySpellSource } from './providers'
import { catalog } from './catalog'
import { validateFiveESource } from './providers/dnd5eapi'
import { validatePfSource } from './providers/foundryPf2e'

afterEach(() => vi.unstubAllGlobals())

describe('bounded online providers', () => {
  it('normalizes malformed spell JSON as a changed source',async()=>{
    await expect(verifySpellSource('https://www.dnd5eapi.co/api/2014/spells/light','{broken')).rejects.toThrow('Source changed or invalid JSON')
  })
  it('classifies HTTP 200 malformed spell refreshes as changed rather than unavailable',async()=>{
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).includes('/spells/'))return new Response('{broken',{status:200})
      throw new Error('network unavailable')
    })
    const receipt=await refreshProvider('dnd5eapi',new AbortController().signal,fetcher,true)
    expect(receipt.status).toBe('changed')
    expect(receipt.records).toEqual(catalog.filter(c=>c.provider==='dnd5eapi'))
    expect(fetcher.mock.calls).toHaveLength(14)
  })
  it('validates source/provider edition identity independently of rules math', () => {
    const five = catalog.find(c => c.provider === 'dnd5eapi')!
    const raw = { index: five.source.sourceId, name: five.name, url: `/api/2014/monsters/${five.source.sourceId}`, actions: [] }
    expect(() => validateFiveESource(five, raw)).not.toThrow()
    expect(() => validateFiveESource(five, { ...raw, url: `/api/2024/monsters/${five.source.sourceId}` })).toThrow()
    const pf = catalog[0]
    const actor = { _id: pf.source.sourceId, name: pf.name, type: 'npc', items: [], system: { details: { publication: { license: 'ORC', remaster: true, title: pf.source.publication } } } }
    expect(() => validatePfSource(pf, actor)).not.toThrow()
    expect(() => validatePfSource(pf, { ...actor, system: { details: { publication: { license: 'OGL', remaster: false } } } })).toThrow()
  })
  it('rejects plausible identity with unreviewed bytes using actual SHA-256', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const c = catalog.find(c => c.provider === 'dnd5eapi')!
    const text = JSON.stringify({ index: c.source.sourceId, name: c.name, url: `/api/2014/monsters/${c.source.sourceId}`, actions: [] })
    await expect(verifySource(c, text)).rejects.toThrow('Source changed; reviewed import retained')
  })
  it('rejects changed mechanics, wrong identity, and oversized payloads', async () => {
    const c = catalog[0]
    await expect(verifySource(c, '{}')).rejects.toThrow()
    await expect(verifySource(c, 'x'.repeat(262145))).rejects.toThrow()
    await expect(verifySource(c, '{"_id":"evil","name":"Guard"}')).rejects.toThrow()
  })
  it('retains imported records and reports network failure per provider', async () => {
    const receipt = await refreshProvider('dnd5eapi', new AbortController().signal, vi.fn().mockRejectedValue(new Error('network unavailable')))
    expect(receipt.status).toBe('unavailable')
    expect(receipt.records).toHaveLength(4)
    expect(receipt.provider).toBe('dnd5eapi')
  })
  it('reports offline without making network requests', async () => {
    const fetcher = vi.fn()
    const receipt = await refreshProvider('foundry-pf2e', new AbortController().signal, fetcher, false)
    expect(receipt.status).toBe('offline')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not claim online when changed payload arrives', async () => {
    const receipt = await refreshProvider('foundry-pf2e', new AbortController().signal, vi.fn().mockResolvedValue(new Response('{}')))
    expect(receipt.status).toBe('changed')
    expect(receipt.records).toEqual(catalog.filter(c => c.provider === 'foundry-pf2e'))
  })
  it('propagates cancellation rather than replacing truthful state with failure', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(refreshProvider('dnd5eapi', controller.signal, vi.fn())).rejects.toThrow()
  })
})

it('checks the ten pinned spell sources with the creature provider and rejects forged spell bytes',async()=>{
 vi.stubGlobal('crypto',webcrypto)
 const requests=vi.fn().mockRejectedValue(new Error('offline network'))
 await refreshProvider('dnd5eapi',new AbortController().signal,requests,true)
 expect(requests.mock.calls.map(([url])=>url).filter((url:string)=>url.includes('/spells/'))).toHaveLength(10)
 await expect(verifySpellSource('https://evil.example/spells/light','{}')).rejects.toThrow()
 await expect(verifySpellSource('https://www.dnd5eapi.co/api/2014/spells/light',JSON.stringify({index:'light',url:'/api/2014/spells/light',desc:['forged']}))).rejects.toThrow(/Source changed/)
})
