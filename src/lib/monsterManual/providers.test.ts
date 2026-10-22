import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { refreshProvider, verifySource } from './providers'
import { catalog } from './catalog'
import { validateFiveESource } from './providers/dnd5eapi'
import { validatePfSource } from './providers/foundryPf2e'

afterEach(() => vi.unstubAllGlobals())

describe('bounded online providers', () => {
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
