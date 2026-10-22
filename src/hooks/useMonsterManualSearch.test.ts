import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMonsterManualSearch } from './useMonsterManualSearch'

afterEach(() => vi.unstubAllGlobals())
describe('independent source receipts and request identity', () => {
  it('rejects a late response after system/query change even when transport ignores abort', async () => {
    let reject!: (reason: Error) => void
    const pending = new Promise<Response>((_resolve, rejectRequest) => { reject = rejectRequest })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    const { result, rerender } = renderHook(({ scope }) => useMonsterManualSearch(true, scope), { initialProps: { scope: 'all' } })
    let request!: Promise<void>
    act(() => { request = result.current.refresh('dnd5eapi') })
    expect(result.current.receipts.dnd5eapi.status).toBe('refreshing')
    rerender({ scope: 'pf2e' })
    await act(async () => { reject(new Error('late old query failure')); await request })
    expect(result.current.receipts.dnd5eapi.status).toBe('imported')
    expect(result.current.receipts['foundry-pf2e'].status).toBe('imported')
  })
  it('settles failures independently and retains all supported data', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('dnd5eapi') ? Promise.reject(new Error('network failed')) : Promise.resolve(new Response('{}'))))
    const { result } = renderHook(() => useMonsterManualSearch(true, 'all'))
    await act(async () => { await Promise.all([result.current.refresh('dnd5eapi'), result.current.refresh('foundry-pf2e')]) })
    expect(result.current.receipts.dnd5eapi.status).toBe('unavailable')
    expect(result.current.receipts['foundry-pf2e'].status).toBe('changed')
    expect(result.current.receipts.dnd5eapi.records).toHaveLength(4)
    expect(result.current.receipts['foundry-pf2e'].records).toHaveLength(4)
  })
  it('cancels panel-owned retrieval on close and observes offline events', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      signals.push(options.signal!)
      return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    }))
    const { result, rerender } = renderHook(({ open }) => useMonsterManualSearch(open, 'all'), { initialProps: { open: true } })
    let request!: Promise<void>
    act(() => { request = result.current.refresh('foundry-pf2e') })
    rerender({ open: false })
    await act(async () => { await request })
    expect(signals.every(s => s.aborted)).toBe(true)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    await waitFor(() => expect(result.current.online).toBe(false))
    vi.restoreAllMocks()
  })
})
