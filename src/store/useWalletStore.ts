import type { SupabaseClient } from '@supabase/supabase-js'
import { create } from 'zustand'
import {
  convertStarsToStandardRoll,
  fetchLunarSubscription,
  fetchRollTicketBalances,
  fetchWalletBalances,
  subscribeLunarSubscription,
  subscribeWalletBalances,
  type LunarSubscriptionSnapshot,
  type RollTicketBalances,
  type StarsToStandardRollReceipt,
  type WalletBalanceSnapshot,
  type WalletBalances,
} from '../lib/walletBalances'

const EMPTY_WALLET: WalletBalances = {
  stars: { promotional: 0 },
  dust: { earned: 0 },
}
const EMPTY_TICKETS: RollTicketBalances = {
  standard_roll: 0,
  premium_roll: 0,
}

/** Invalidates delayed reads whenever sign-out/account replacement occurs. */
let walletSessionGeneration = 0
let conversionInFlight: Promise<StarsToStandardRollReceipt> | null = null

interface WalletStore {
  wallet: WalletBalances
  tickets: RollTicketBalances
  subscription: LunarSubscriptionSnapshot | null
  loading: boolean
  stale: boolean
  userId: string | null
  setUserId: (userId: string) => void
  refresh: (client?: SupabaseClient | null) => Promise<void>
  applyRealtime: (snapshot: WalletBalanceSnapshot) => void
  connectRealtime: (userId: string, client?: SupabaseClient | null) => () => void
  resetOnSignOut: () => void
  convertStarsToStandardRoll: (
    count: number,
    client?: SupabaseClient | null,
  ) => Promise<StarsToStandardRollReceipt>
}

/**
 * Server-authoritative economy state is intentionally not persisted. Persisting
 * it would turn a stale client cache into apparent wallet truth; refresh and
 * Realtime repopulate this dedicated Frontend-ADR-002 domain after sign-in.
 */
export const useWalletStore = create<WalletStore>((set, get) => ({
  wallet: EMPTY_WALLET,
  tickets: EMPTY_TICKETS,
  subscription: null,
  loading: false,
  stale: true,
  userId: null,

  setUserId: (userId) => {
    if (get().userId === userId) return
    walletSessionGeneration += 1
    const switchingAccounts = get().userId !== null
    set(switchingAccounts
      ? {
          userId,
          wallet: EMPTY_WALLET,
          tickets: EMPTY_TICKETS,
          subscription: null,
          loading: false,
          stale: true,
        }
      : { userId })
  },

  refresh: async (client) => {
    const generation = walletSessionGeneration
    const userId = get().userId
    set({ loading: true })
    try {
      const [wallet, tickets, subscription] = await Promise.all([
        fetchWalletBalances(client),
        fetchRollTicketBalances(client),
        fetchLunarSubscription(client),
      ])
      if (
        generation === walletSessionGeneration &&
        get().userId === userId
      ) {
        set({ wallet, tickets, subscription, loading: false, stale: false })
      }
    } catch (error) {
      if (
        generation === walletSessionGeneration &&
        get().userId === userId
      ) {
        set({ loading: false, stale: true })
      }
      throw error
    }
  },

  applyRealtime: (snapshot) => {
    set({ wallet: snapshot.wallet, tickets: snapshot.tickets, stale: false })
  },

  connectRealtime: (userId, client) => {
    get().setUserId(userId)
    const generation = ++walletSessionGeneration
    const stopBalances = subscribeWalletBalances(
      userId,
      snapshot => {
        if (
          generation === walletSessionGeneration &&
          get().userId === userId
        ) {
          get().applyRealtime(snapshot)
        }
      },
      client,
    )
    const stopSubscription = subscribeLunarSubscription(
      userId,
      () => {
        void fetchLunarSubscription(client)
          .then(subscription => {
            if (
              generation === walletSessionGeneration &&
              get().userId === userId
            ) {
              set({ subscription, stale: false })
            }
          })
          .catch(() => {
            if (
              generation === walletSessionGeneration &&
              get().userId === userId
            ) {
              set({ stale: true })
            }
          })
      },
      client,
    )
    return () => {
      stopBalances()
      stopSubscription()
    }
  },

  resetOnSignOut: () => {
    walletSessionGeneration += 1
    conversionInFlight = null
    set({
      wallet: EMPTY_WALLET,
      tickets: EMPTY_TICKETS,
      subscription: null,
      loading: false,
      stale: true,
      userId: null,
    })
  },

  convertStarsToStandardRoll: (count, client) => {
    if (conversionInFlight) return conversionInFlight
    const attempt = (async () => {
      const generation = walletSessionGeneration
      const userId = get().userId
      const receipt = await convertStarsToStandardRoll(count, client)
      if (
        generation !== walletSessionGeneration ||
        get().userId !== userId
      ) {
        return receipt
      }
      set(state => ({
        wallet: {
          ...state.wallet,
          stars: {
            ...state.wallet.stars,
            promotional: receipt.promotionalStarsBalanceAfter,
          },
        },
        tickets: {
          ...state.tickets,
          standard_roll: receipt.standardRollQuantityAfter,
        },
        stale: false,
      }))
      // The atomic RPC receipt is success truth. Reconciliation is best-effort
      // and must never turn a committed conversion into a client-visible failure.
      void get().refresh(client).catch(() => {
        if (
          generation === walletSessionGeneration &&
          get().userId === userId
        ) {
          set({ stale: true })
        }
      })
      return receipt
    })()
    const guardedAttempt = attempt.finally(() => {
      if (conversionInFlight === guardedAttempt) {
        conversionInFlight = null
      }
    })
    conversionInFlight = guardedAttempt
    return guardedAttempt
  },
}))
