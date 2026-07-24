import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMyDiceCopies } from './diceCopies'

function clientWith(data: unknown): SupabaseClient {
  return {
    from: () => ({
      select: async () => ({ data, error: null }),
    }),
  } as unknown as SupabaseClient
}

describe('fetchMyDiceCopies', () => {
  it('groups only live copies while retaining the scrapped first-copy ever-owned latch', async () => {
    const result = await fetchMyDiceCopies(clientWith([
      {
        id: 'copy-first',
        catalog_item_id: 'item-a',
        source_kind: 'pull',
        acquired_at: '2026-07-01T00:00:00Z',
        is_first_copy: true,
        scrapped_at: '2026-07-02T00:00:00Z',
      },
      {
        id: 'copy-live',
        catalog_item_id: 'item-a',
        source_kind: 'reward',
        acquired_at: '2026-07-03T00:00:00Z',
        is_first_copy: false,
        scrapped_at: null,
      },
      {
        id: 'scrapped-only',
        catalog_item_id: 'item-b',
        source_kind: 'craft',
        acquired_at: '2026-07-04T00:00:00Z',
        is_first_copy: true,
        scrapped_at: '2026-07-05T00:00:00Z',
      },
    ]))

    expect(result['item-a']).toEqual({
      catalogItemId: 'item-a',
      liveCount: 1,
      everOwned: true,
      firstCopyAcquiredAt: '2026-07-01T00:00:00Z',
      copies: [{
        id: 'copy-live',
        sourceKind: 'reward',
        acquiredAt: '2026-07-03T00:00:00Z',
        isFirstCopy: false,
      }],
    })
    expect(result['item-b']).toMatchObject({
      liveCount: 0,
      everOwned: true,
      copies: [],
    })
  })

  it('rejects malformed rows rather than inventing ownership', async () => {
    await expect(fetchMyDiceCopies(clientWith([{
      id: 'copy',
      catalog_item_id: 'item',
      source_kind: 'mystery',
      acquired_at: 'not-a-date',
      is_first_copy: false,
      scrapped_at: null,
    }]))).rejects.toThrow(/unsupported source kind|malformed timestamp/)
  })
})
