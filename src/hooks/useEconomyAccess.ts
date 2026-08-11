import { useAuthStore } from '../store/useAuthStore'

/**
 * THE single predicate that decides whether economy chrome is allowed to
 * render (shop entry, wallet HUD, banners/pulls, Stars→rolls conversion,
 * odds/fairness modal, Lunar Pass, purchase notifications).
 *
 * Every economy surface MUST consult this hook rather than inventing its own
 * condition — `src/components/economy/economyAccessGate.guard.test.ts` scans
 * the component tree and fails when a new economy surface appears outside the
 * gated subtree.
 *
 * False for guests, for signed-out users, while auth is still loading, and
 * whenever Supabase is unconfigured. Only an authenticated account that an
 * operator has explicitly flagged on returns true.
 *
 * This is presentation only. It never gates a network call, an RPC, or an
 * earned faucet: Stars keep accruing server-side for un-flagged players, and
 * the wallet becomes visible retroactively the moment the flag flips on.
 */
export function useEconomyAccess(): boolean {
  return useAuthStore(state => state.status === 'authenticated' && state.economyAccess)
}
