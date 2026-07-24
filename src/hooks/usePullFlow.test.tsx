import { act, renderHook } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PULL_SESSION_STORAGE_KEY,
  persistPullSession,
  toPersistedPullSession,
} from '../lib/pullFlow'
import type {
  PullIntent,
  PullPrepareReceipt,
} from '../types/pull'
import { usePullFlow } from './usePullFlow'

const ownerId = 'user-a'
const sessionId = '11111111-1111-4111-8111-111111111111'
const bannerVersionId = 'standard-banner@2'
const preparedAt = '2026-07-24T00:00:00.000Z'
const expiresAt = '2026-07-24T00:02:00.000Z'

const prepareData = [{
  session_id: sessionId,
  banner_version_id: bannerVersionId,
  pull_count: 1,
  held_amount: 1,
  prepared_at: preparedAt,
  expires_at: expiresAt,
  commitment_scheme: 'sha256-result-v1+sha256-root-v1',
  commitment_root: 'a'.repeat(64),
  rng_scheme: 'hmac-sha256-seed-v1',
}]

const revealData = {
  session_id: sessionId,
  banner_version_id: bannerVersionId,
  pull_count: 1,
  held_amount: 1,
  committed_at: '2026-07-24T00:00:00.100Z',
  commitment_scheme: 'sha256-result-v1+sha256-root-v1',
  commitment_root: 'a'.repeat(64),
  rng_scheme: 'hmac-sha256-seed-v1',
  rng_seed: 'b'.repeat(64),
  results: [{
    position: 1,
    catalog_item_id: 'item-a',
    tier_id: 'signature',
    tier_rank: 3,
    selected_target_catalog_item_id: null,
    reason: 'base',
    rare_before: 0,
    rare_after: 0,
    epic_before: 0,
    epic_after: 0,
    selected_before: 0,
    selected_after: 0,
    is_duplicate: false,
    is_first_copy: true,
    duplicate_dust_amount: 0,
    nonce: 'c'.repeat(64),
    commitment: 'd'.repeat(64),
  }],
}

function clientWith(
  rpc: (operation: string, parameters: Record<string, unknown>) => Promise<{
    data: unknown
    error: { message: string; code?: string } | null
  }>,
): SupabaseClient {
  return { rpc } as unknown as SupabaseClient
}

const unavailableInventory = async () => {
  throw new Error('inventory temporarily unavailable')
}

describe('usePullFlow', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(preparedAt))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('holds an instant commit behind the >=800ms sealing beat', async () => {
    const rpc = vi.fn(async (operation: string) => ({
      data: operation === 'prepare_pull' ? prepareData : revealData,
      error: null,
    }))
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))

    await act(async () => {
      await result.current.startPull(bannerVersionId, 1)
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('sealing')

    await act(async () => { await vi.advanceTimersByTimeAsync(799) })
    expect(result.current.state.status).toBe('sealing')
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(result.current.state.status).toBe('revealed')
    expect(rpc).toHaveBeenCalledWith('prepare_pull', expect.objectContaining({
      p_idempotency_key: expect.stringMatching(/^pull:/),
    }))
  })

  it('escalates a stalled commit at 2s and can cancel without clearing early', async () => {
    let resolveCommit!: (value: { data: unknown; error: null }) => void
    const commit = new Promise<{ data: unknown; error: null }>(resolve => {
      resolveCommit = resolve
    })
    const rpc = vi.fn(async (operation: string) => {
      if (operation === 'prepare_pull') return { data: prepareData, error: null }
      if (operation === 'commit_pull_session') return commit
      if (operation === 'cancel_pull_session') {
        return {
          data: { session_id: sessionId, kind: 'cancelled', created_at: preparedAt },
          error: null,
        }
      }
      return { data: null, error: { message: 'unexpected' } }
    })
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))

    await act(async () => { await result.current.startPull(bannerVersionId, 1) })
    expect(localStorage.getItem(PULL_SESSION_STORAGE_KEY)).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.state.status).toBe('hold')
    await act(async () => { await result.current.cancel() })
    expect(result.current.state.status).toBe('cancelled')
    expect(localStorage.getItem(PULL_SESSION_STORAGE_KEY)).toBeNull()

    resolveCommit({ data: revealData, error: null })
    await act(async () => { await Promise.resolve() })
    expect(result.current.state.status).toBe('cancelled')
  })

  it('restores a persisted prepared session through committed reveal read', async () => {
    const intent: PullIntent = {
      ownerId,
      bannerVersionId,
      pullCount: 1,
      idempotencyKey: 'pull:22222222-2222-4222-8222-222222222222',
      createdAt: preparedAt,
    }
    const preparation: PullPrepareReceipt = {
      sessionId,
      bannerVersionId,
      pullCount: 1,
      heldAmount: 1,
      preparedAt,
      expiresAt,
      commitmentScheme: 'sha256-result-v1+sha256-root-v1',
      commitmentRoot: 'a'.repeat(64),
      rngScheme: 'hmac-sha256-seed-v1',
    }
    persistPullSession(toPersistedPullSession(intent, preparation, 'prepared'))
    const rpc = vi.fn(async () => ({ data: revealData, error: null }))
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('revealed')
    expect(rpc).toHaveBeenCalledWith('get_committed_pull_reveal', {
      p_session_id: sessionId,
    })
  })

  it('probes durable reveal before expiring a client-clock-expired session', async () => {
    const intent: PullIntent = {
      ownerId,
      bannerVersionId,
      pullCount: 1,
      idempotencyKey: 'pull:33333333-3333-4333-8333-333333333333',
      createdAt: preparedAt,
    }
    const preparation: PullPrepareReceipt = {
      sessionId,
      bannerVersionId,
      pullCount: 1,
      heldAmount: 1,
      preparedAt,
      expiresAt,
      commitmentScheme: 'sha256-result-v1+sha256-root-v1',
      commitmentRoot: 'a'.repeat(64),
      rngScheme: 'hmac-sha256-seed-v1',
    }
    persistPullSession(toPersistedPullSession(intent, preparation, 'prepared'))
    vi.setSystemTime(new Date('2026-07-24T00:03:00.000Z'))
    const rpc = vi.fn(async () => ({ data: revealData, error: null }))
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('revealed')
    expect(rpc).toHaveBeenCalledWith('get_committed_pull_reveal', {
      p_session_id: sessionId,
    })
  })

  it('expires only after the reveal probe proves no committed receipt', async () => {
    const intent: PullIntent = {
      ownerId,
      bannerVersionId,
      pullCount: 1,
      idempotencyKey: 'pull:44444444-4444-4444-8444-444444444444',
      createdAt: preparedAt,
    }
    const preparation: PullPrepareReceipt = {
      sessionId,
      bannerVersionId,
      pullCount: 1,
      heldAmount: 1,
      preparedAt,
      expiresAt,
      commitmentScheme: 'sha256-result-v1+sha256-root-v1',
      commitmentRoot: 'a'.repeat(64),
      rngScheme: 'hmac-sha256-seed-v1',
    }
    persistPullSession(toPersistedPullSession(intent, preparation, 'prepared'))
    vi.setSystemTime(new Date('2026-07-24T00:03:00.000Z'))
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'Pull session is not committed', code: '55000' },
    }))
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('expired')
    expect(localStorage.getItem(PULL_SESSION_STORAGE_KEY)).toBeNull()
    expect(rpc).not.toHaveBeenCalledWith('cancel_pull_session', expect.anything())
  })

  it('retains a failed restore pointer and retryRestore re-reads it', async () => {
    const intent: PullIntent = {
      ownerId,
      bannerVersionId,
      pullCount: 1,
      idempotencyKey: 'pull:55555555-5555-4555-8555-555555555555',
      createdAt: preparedAt,
    }
    const preparation: PullPrepareReceipt = {
      sessionId,
      bannerVersionId,
      pullCount: 1,
      heldAmount: 1,
      preparedAt,
      expiresAt,
      commitmentScheme: 'sha256-result-v1+sha256-root-v1',
      commitmentRoot: 'a'.repeat(64),
      rngScheme: 'hmac-sha256-seed-v1',
    }
    persistPullSession(toPersistedPullSession(intent, preparation, 'prepared'))
    let reads = 0
    const rpc = vi.fn(async () => {
      reads += 1
      return reads === 1
        ? { data: null, error: { message: 'token refresh failed', code: '42501' } }
        : { data: revealData, error: null }
    })
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(result.current.state).toMatchObject({ status: 'error', stage: 'restore' })
    expect(localStorage.getItem(PULL_SESSION_STORAGE_KEY)).not.toBeNull()

    await act(async () => { await result.current.retryRestore() })
    expect(result.current.state.status).toBe('revealed')
    expect(reads).toBe(2)
  })

  it('retains the session through auth loss and resumes after the owner returns', async () => {
    const intent: PullIntent = {
      ownerId,
      bannerVersionId,
      pullCount: 1,
      idempotencyKey: 'pull:66666666-6666-4666-8666-666666666666',
      createdAt: preparedAt,
    }
    const preparation: PullPrepareReceipt = {
      sessionId,
      bannerVersionId,
      pullCount: 1,
      heldAmount: 1,
      preparedAt,
      expiresAt,
      commitmentScheme: 'sha256-result-v1+sha256-root-v1',
      commitmentRoot: 'a'.repeat(64),
      rngScheme: 'hmac-sha256-seed-v1',
    }
    persistPullSession(toPersistedPullSession(intent, preparation, 'prepared'))
    let reads = 0
    const rpc = vi.fn(async () => {
      reads += 1
      return reads === 1
        ? {
            data: null,
            error: { message: 'Pull session is not committed', code: '55000' },
          }
        : { data: revealData, error: null }
    })
    const client = clientWith(rpc)
    const { result, rerender } = renderHook(
      ({ currentOwner }: { currentOwner: string | null }) => usePullFlow({
        client,
        ownerId: currentOwner,
        inventoryRefresh: unavailableInventory,
      }),
      { initialProps: { currentOwner: ownerId as string | null } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('hold')

    rerender({ currentOwner: null })
    await act(async () => { await Promise.resolve() })
    expect(result.current.state).toMatchObject({
      status: 'auth-required',
      persisted: { ownerId },
    })
    expect(localStorage.getItem(PULL_SESSION_STORAGE_KEY)).not.toBeNull()

    rerender({ currentOwner: ownerId })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('revealed')
    expect(reads).toBe(2)
  })

  it('routes countdown expiry through reveal proof rather than cancellation', async () => {
    let commitCalls = 0
    const rpc = vi.fn(async (operation: string) => {
      if (operation === 'prepare_pull') return { data: prepareData, error: null }
      if (operation === 'commit_pull_session') {
        commitCalls += 1
        return {
          data: null,
          error: commitCalls === 1
            ? { message: 'commit did not finish', code: '57014' }
            : { message: 'Pull session is expired', code: '55000' },
        }
      }
      if (operation === 'get_committed_pull_reveal') {
        return {
          data: null,
          error: { message: 'Pull session is not committed', code: '55000' },
        }
      }
      return { data: null, error: { message: 'cancel must not run', code: 'P0001' } }
    })
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))
    await act(async () => { await result.current.startPull(bannerVersionId, 1) })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })

    await act(async () => { await result.current.expire() })
    expect(result.current.state.status).toBe('expired')
    expect(rpc).toHaveBeenCalledWith('get_committed_pull_reveal', {
      p_session_id: sessionId,
    })
    expect(rpc).not.toHaveBeenCalledWith('cancel_pull_session', expect.anything())
  })

  it('expires without waiting for a never-settling original commit transport', async () => {
    const neverSettles = new Promise<{ data: unknown; error: null }>(() => {})
    let commitCalls = 0
    const rpc = vi.fn(async (operation: string) => {
      if (operation === 'prepare_pull') return { data: prepareData, error: null }
      if (operation === 'commit_pull_session') {
        commitCalls += 1
        if (commitCalls === 1) return neverSettles
        return {
          data: null,
          error: { message: 'Pull session is expired', code: '55000' },
        }
      }
      if (operation === 'get_committed_pull_reveal') {
        return {
          data: null,
          error: { message: 'Pull session is not committed', code: '55000' },
        }
      }
      return { data: null, error: { message: 'unexpected operation', code: 'P0001' } }
    })
    const { result } = renderHook(() => usePullFlow({
      client: clientWith(rpc),
      ownerId,
      inventoryRefresh: unavailableInventory,
    }))
    await act(async () => { await result.current.startPull(bannerVersionId, 1) })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(result.current.state.status).toBe('hold')

    await act(async () => { await result.current.expire() })
    expect(result.current.state.status).toBe('expired')
    expect(commitCalls).toBe(2)
  })
})
