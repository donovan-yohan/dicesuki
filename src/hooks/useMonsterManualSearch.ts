import { useCallback, useEffect, useRef, useState } from 'react'
import { catalog } from '../lib/monsterManual/catalog'
import { refreshProvider, type ProviderReceipt } from '../lib/monsterManual/providers'
import type { ProviderId } from '../lib/monsterManual/types'

export function useMonsterManualSearch(isOpen: boolean, scope: string) {
  const [receipts, setReceipts] = useState<Record<ProviderId, ProviderReceipt>>(() => ({
    dnd5eapi: { provider: 'dnd5eapi', status: 'imported', records: catalog.filter(c => c.provider === 'dnd5eapi') },
    'foundry-pf2e': { provider: 'foundry-pf2e', status: 'imported', records: catalog.filter(c => c.provider === 'foundry-pf2e') },
  }))
  const [online, setOnline] = useState(navigator.onLine)
  const requests = useRef(new Map<ProviderId, AbortController>())
  const generation = useRef(0)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    const activeRequests = requests.current
    const generationRef = generation
    generationRef.current++
    for (const controller of activeRequests.values()) controller.abort()
    activeRequests.clear()
    setReceipts(previous => Object.fromEntries(Object.entries(previous).map(([id, r]) => [id, r.status === 'refreshing' ? { ...r, status: 'imported' } : r])) as Record<ProviderId, ProviderReceipt>)
    return () => {
      generationRef.current++
      for (const controller of activeRequests.values()) controller.abort()
      activeRequests.clear()
    }
  }, [isOpen, scope])
  const refresh = useCallback(async (provider: ProviderId) => {
    if (!isOpen) return
    requests.current.get(provider)?.abort()
    const controller = new AbortController()
    const requestGeneration = generation.current
    requests.current.set(provider, controller)
    setReceipts(previous => ({ ...previous, [provider]: { ...previous[provider], status: 'refreshing' } }))
    const timeout = window.setTimeout(() => controller.abort(new Error('Source request timed out')), 15000)
    try {
      const receipt = await refreshProvider(provider, controller.signal, fetch, online)
      if (generation.current === requestGeneration && requests.current.get(provider) === controller) setReceipts(previous => ({ ...previous, [provider]: receipt }))
    } catch {
      if (generation.current === requestGeneration && requests.current.get(provider) === controller) setReceipts(previous => ({ ...previous, [provider]: { ...previous[provider], status: online ? 'unavailable' : 'offline' } }))
    } finally {
      window.clearTimeout(timeout)
      if (requests.current.get(provider) === controller) requests.current.delete(provider)
    }
  }, [isOpen, online])
  return { receipts, online, refresh }
}
