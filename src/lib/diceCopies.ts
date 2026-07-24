import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'

export type DiceCopySourceKind = 'pull' | 'craft' | 'purchase' | 'reward'

export interface DiceCopy {
  id: string
  sourceKind: DiceCopySourceKind
  acquiredAt: string
  isFirstCopy: boolean
}

export interface DiceCopyGroup {
  catalogItemId: string
  liveCount: number
  everOwned: boolean
  firstCopyAcquiredAt: string | null
  copies: DiceCopy[]
}

export type DiceCopiesByCatalogItem = Record<string, DiceCopyGroup>

export class DiceCopiesReadError extends Error {
  readonly operation = 'fetch_my_dice_copies'
  readonly code?: string

  constructor(message: string, code?: string) {
    super(`fetch_my_dice_copies failed: ${message}`)
    this.name = 'DiceCopiesReadError'
    this.code = code
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DiceCopiesReadError('backend returned a malformed object')
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DiceCopiesReadError('backend returned a malformed string')
  }
  return value
}

function timestamp(value: unknown): string {
  const result = string(value)
  if (Number.isNaN(Date.parse(result))) {
    throw new DiceCopiesReadError('backend returned a malformed timestamp')
  }
  return result
}

export async function fetchMyDiceCopies(
  client?: SupabaseClient | null,
): Promise<DiceCopiesByCatalogItem> {
  const resolved = client === undefined ? getSupabaseClient() : client
  if (!resolved) throw new DiceCopiesReadError('Supabase is not configured')

  let data: unknown
  try {
    const result = await resolved
      .from('dice_copies')
      .select('id, catalog_item_id, source_kind, acquired_at, is_first_copy, scrapped_at')
    if (result.error) {
      throw new DiceCopiesReadError(result.error.message, result.error.code)
    }
    data = result.data
  } catch (error) {
    if (error instanceof DiceCopiesReadError) throw error
    throw new DiceCopiesReadError(
      error instanceof Error ? error.message : 'unknown client failure',
    )
  }
  if (!Array.isArray(data)) {
    throw new DiceCopiesReadError('backend returned a malformed row set')
  }

  const groups: DiceCopiesByCatalogItem = {}
  for (const value of data) {
    const row = object(value)
    const id = string(row.id)
    const catalogItemId = string(row.catalog_item_id)
    const sourceKind = string(row.source_kind)
    if (!['pull', 'craft', 'purchase', 'reward'].includes(sourceKind)) {
      throw new DiceCopiesReadError('backend returned an unsupported source kind')
    }
    const acquiredAt = timestamp(row.acquired_at)
    if (typeof row.is_first_copy !== 'boolean') {
      throw new DiceCopiesReadError('backend returned a malformed first-copy latch')
    }
    if (row.scrapped_at !== null) timestamp(row.scrapped_at)

    const group = groups[catalogItemId] ?? {
      catalogItemId,
      liveCount: 0,
      everOwned: false,
      firstCopyAcquiredAt: null,
      copies: [],
    }
    if (row.is_first_copy) {
      if (group.everOwned) {
        throw new DiceCopiesReadError('backend returned duplicate first-copy latches')
      }
      group.everOwned = true
      group.firstCopyAcquiredAt = acquiredAt
    }
    if (row.scrapped_at === null) {
      group.copies.push({
        id,
        sourceKind: sourceKind as DiceCopySourceKind,
        acquiredAt,
        isFirstCopy: row.is_first_copy,
      })
      group.liveCount += 1
    }
    groups[catalogItemId] = group
  }

  for (const group of Object.values(groups)) {
    group.copies.sort((a, b) => (
      Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt) || a.id.localeCompare(b.id)
    ))
  }
  return groups
}
