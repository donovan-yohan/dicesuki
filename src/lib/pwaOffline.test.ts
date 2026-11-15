import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, expect, it, vi } from 'vitest'
import { claimCommunityDie } from './earnedEconomy'
import { claimLunarDailyStars } from './lunarPass'
import { convertStarsToStandardRoll } from './walletBalances'
import { preparePull, commitPullSession } from './pullRpc'
import { createCheckoutSession } from './paymentsClient'

afterEach(() => vi.restoreAllMocks())
it('refuses account writers at the consuming RPC boundary while offline without queuing a replay', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const rpc = vi.fn()
  const invoke = vi.fn()
  const from = vi.fn()
  const client = { rpc, from, functions: { invoke } } as unknown as SupabaseClient
  const operations = [
    () => claimCommunityDie(client, 'fixture-key-1'),
    () => claimLunarDailyStars(client),
    () => convertStarsToStandardRoll(1, client, 'fixture-key-1'),
    () => preparePull(client, { bannerVersionId: 'standard-banner@2', pullCount: 1, idempotencyKey: 'fixture-key-1' }),
    () => commitPullSession(client, '11111111-1111-4111-8111-111111111111'),
    () => createCheckoutSession('sku', { client }),
  ]
  for (const operation of operations) await expect(operation()).rejects.toThrow(/offline/i)
  expect(rpc).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
  expect(from).not.toHaveBeenCalled()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await Promise.resolve()
  expect(rpc).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})
