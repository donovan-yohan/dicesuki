import type { Creature, ProviderId } from './types'
import { catalog } from './catalog'
import { validateFiveESource } from './providers/dnd5eapi'
import spellSources from '../../../scripts/monster-manual/feature-registry.json'
import { validatePfSource } from './providers/foundryPf2e'

export interface ProviderReceipt {
  provider: ProviderId
  status: 'imported' | 'refreshing' | 'online' | 'offline' | 'unavailable' | 'changed'
  records: readonly Creature[]
  checkedAt?: string
}
const MAX_BYTES = 262144
export async function verifySource(c: Creature, text: string): Promise<void> {
  if (!catalog.includes(c) || text.length > MAX_BYTES) throw new Error('Source changed or payload too large')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Source changed or invalid JSON') }
  if (c.provider === 'dnd5eapi') validateFiveESource(c, raw)
  else validatePfSource(c, raw)
  await verifyHash(text,c.source.sha256)
}
export async function verifySpellSource(url: string, text: string): Promise<void> {
  const source=spellSources.find(s=>s.system==='5e'&&s.url===url)
  if(!source||text.length>MAX_BYTES)throw new Error('Source changed or unreviewed spell URL')
  let raw
  try { raw=JSON.parse(text) } catch { throw new Error('Source changed or invalid JSON') }
  if(raw?.index!==source.file.slice(3,-5)||raw?.url!==new URL(source.url).pathname||!Array.isArray(raw.desc)||raw.desc.some((d:unknown)=>typeof d!=='string'))throw new Error('Source changed or invalid spell identity')
  await verifyHash(text,source.sha256)
}
async function verifyHash(text:string,expected:string):Promise<void> {
  const bytes = new TextEncoder().encode(text)
  if(bytes.length>MAX_BYTES)throw new Error('Source changed or payload too large')
  const digest=await crypto.subtle.digest('SHA-256',bytes)
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
  if(hash!==expected)throw new Error('Source changed; reviewed import retained')
}

async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES) throw new Error('Source changed or payload too large')
  if (!response.body) throw new Error('Source changed or empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    let finished = false
    while (!finished) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) { finished = true; continue }
      size += value.length
      if (size > MAX_BYTES) throw new Error('Source changed or payload too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function refreshProvider(provider: ProviderId, signal: AbortSignal, fetcher: typeof fetch = fetch, online = navigator.onLine): Promise<ProviderReceipt> {
  signal.throwIfAborted()
  const records = catalog.filter(c => c.provider === provider)
  if (!records.length) throw new Error('Unknown provider')
  if (!online) return { provider, status: 'offline', records }
  const sources=[...records.map(c=>({url:c.source.url,verify:(text:string)=>verifySource(c,text)})),...spellSources.filter(s=>s.system==='5e'&&s.provider===provider).map(s=>({url:s.url,verify:(text:string)=>verifySpellSource(s.url,text)}))]
  const results = await Promise.allSettled(sources.map(async source => {
    const response = await fetcher(source.url, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await source.verify(await boundedText(response, signal))
  }))
  signal.throwIfAborted()
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  const status = failures.length ? failures.some(r => String(r.reason).includes('Source changed')) ? 'changed' : 'unavailable' : 'online'
  return { provider, status, records, checkedAt: new Date().toISOString() }
}
