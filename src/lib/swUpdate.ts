import { registerSW } from 'virtual:pwa-register'
import {
  useMultiplayerStore,
  type ConnectionStatus,
  type RoomTransportKind,
} from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'

/**
 * Service-worker update + safe-reload policy (issue #256).
 *
 * `registerType: 'autoUpdate'` (see `vite.config.ts`) makes a new deploy's
 * service worker `skipWaiting()` + `clientsClaim()`, so it takes control of open
 * tabs immediately. That is only half the story: taking control does NOT swap
 * the JS already running in the page. Without an app-side reload the tab keeps
 * executing the old bundle until the user hard-refreshes — the "stale bundle on
 * revisit" bug. The plugin's bare injected `navigator.serviceWorker.register()`
 * script does nothing about this, which is why this module exists and why
 * `injectRegister` is now `null`.
 *
 * Two jobs:
 *
 * 1. **Notice deploys.** A tab left open for hours never re-checks `sw.js` on its
 *    own. We poll `registration.update()` on registration, every
 *    {@link SW_UPDATE_CHECK_INTERVAL_MS}, and whenever the document becomes
 *    visible (the cheap, high-signal moment — the user just came back).
 * 2. **Reload without yanking anyone.** `vite-plugin-pwa` would call
 *    `window.location.reload()` the instant the new worker activates. Passing
 *    `onNeedReload` takes that decision back so a reload can never land in the
 *    middle of play — see {@link isSessionActive}.
 */

/**
 * How often a long-lived tab re-checks the server for a new service worker.
 *
 * Recommended range: 5-60 min. 15 min is the balance point — short enough that a
 * tab parked on the table picks up a deploy within one coffee break, long enough
 * that an always-open tab costs a trivial number of conditional requests per day
 * (`registration.update()` is a byte-comparison fetch of `sw.js`, not the bundle).
 */
export const SW_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

/**
 * Suppression window for the cross-reload loop guard.
 *
 * A module flag stops a double reload inside one page instance, but it cannot
 * see the page instance before it. If a deploy is half-broken (the new worker
 * activates, the page reloads, the same worker activates again) the tab would
 * reload forever. Persisting the last reload timestamp in `sessionStorage` caps
 * that at one reload per minute per tab while still letting a genuinely later
 * deploy through.
 */
export const SW_RELOAD_GUARD_WINDOW_MS = 60_000

/** `sessionStorage` key holding the epoch-ms timestamp of the last SW reload. */
export const SW_RELOAD_GUARD_KEY = 'dicesuki:sw-reloaded-at'

/**
 * The slice of room/roll state the reload policy cares about.
 *
 * Declared structurally rather than imported from the stores so
 * {@link isSessionActive} is a pure function that tests can drive directly.
 */
export interface SessionSnapshot {
  /** Room connection status. Anything but `'disconnected'` means a room is live or coming up. */
  connectionStatus: ConnectionStatus
  /** The joined room, or `null` when the player is not in one. */
  roomId: string | null
  /** `'worker'` = the local solo wasm room, `'websocket'` = a shared server room. */
  transport: RoomTransportKind | null
  /** Dice currently on the table. */
  diceOnTable: number
  /** True while dice are tumbling or a roll cycle / saved-roll wave sequence is open. */
  rollInFlight: boolean
}

/**
 * Is the player in something a reload would destroy?
 *
 * "Active" is deliberately narrower than "the app is open", because the common
 * stale-bundle case — a returning visitor sitting on an empty solo table — is
 * exactly the case where an instant reload is invisible and correct.
 *
 * Active means, in order:
 * - **Dice in flight.** A roll cycle or saved-roll wave sequence in progress is
 *   never interruptible, in any mode.
 * - **A shared server room.** Multiplayer costs more than local state: the seat,
 *   the reconnect handshake, and the other players watching. Never reload while
 *   connected, connecting, or mid-reconnect (`'error'`).
 * - **A solo table with dice on it.** The solo wasm room lives entirely in the
 *   Web Worker and is not resumable (`useMultiplayerStore` treats a worker close
 *   as terminal); reloading discards every die on the table. An *empty* solo
 *   table has nothing to lose, so it is not active.
 */
export function isSessionActive(snapshot: SessionSnapshot): boolean {
  if (snapshot.rollInFlight) return true
  const inRoom = snapshot.roomId !== null && snapshot.connectionStatus !== 'disconnected'
  if (!inRoom) return false
  if (snapshot.transport === 'websocket') return true
  return snapshot.diceOnTable > 0
}

/** Project the live stores onto the {@link SessionSnapshot} the policy reads. */
export function readSessionSnapshot(): SessionSnapshot {
  const room = useMultiplayerStore.getState()
  const rolls = useDiceStore.getState()
  return {
    connectionStatus: room.connectionStatus,
    roomId: room.roomId,
    transport: room.lastJoin?.transport ?? null,
    diceOnTable: room.dice.size,
    rollInFlight:
      rolls.rollingDice.size > 0 ||
      rolls.currentRollCycleDice.size > 0 ||
      rolls.savedRollWavesPending,
  }
}

/** Seams the tests replace; production uses the real browser + plugin. */
export interface ServiceWorkerUpdateDeps {
  /** `registerSW` from `virtual:pwa-register`. */
  register?: typeof registerSW
  /** Poll period for `registration.update()`. */
  intervalMs?: number
  /** How the page is replaced once a reload is judged safe. */
  reload?: () => void
  /** Clock used by the loop guard. */
  now?: () => number
}

function readReloadGuard(): number | null {
  try {
    const raw = window.sessionStorage.getItem(SW_RELOAD_GUARD_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    // Storage can throw (Safari private mode, blocked third-party contexts).
    // Losing the guard is survivable; the module flag still covers this page.
    return null
  }
}

function writeReloadGuard(at: number): void {
  try {
    window.sessionStorage.setItem(SW_RELOAD_GUARD_KEY, String(at))
  } catch {
    // See readReloadGuard.
  }
}

/**
 * Wire up service-worker update checks and the deferred-reload policy.
 *
 * Call once from the app entry. Returns a teardown that removes every listener,
 * timer and store subscription — used by tests, and harmless in production where
 * it is simply never called.
 */
export function startServiceWorkerUpdates(deps: ServiceWorkerUpdateDeps = {}): () => void {
  const {
    register = registerSW,
    intervalMs = SW_UPDATE_CHECK_INTERVAL_MS,
    reload = () => window.location.reload(),
    now = () => Date.now(),
  } = deps

  const cleanups: Array<() => void> = []
  /** One reload per page instance, however many signals ask for it. */
  let reloadStarted = false
  /** A newer worker has taken control; the page owes itself a reload. */
  let reloadPending = false
  /** Set once the registration resolves. */
  let checkForUpdate: (() => void) | null = null
  /** Lazily attached so the 60Hz snapshot stream isn't taxed until it matters. */
  let unsubscribeStores: (() => void) | null = null

  const reloadNow = () => {
    if (reloadStarted) return
    const lastReload = readReloadGuard()
    if (lastReload !== null && now() - lastReload < SW_RELOAD_GUARD_WINDOW_MS) {
      // A worker activated again within the guard window — treat it as a loop
      // and stay on this bundle rather than reloading the user in circles.
      return
    }
    reloadStarted = true
    writeReloadGuard(now())
    reload()
  }

  const flushIfSafe = () => {
    if (!reloadPending || reloadStarted) return
    // A hidden tab has no session to protect: nobody is watching the dice.
    if (document.visibilityState === 'hidden' || !isSessionActive(readSessionSnapshot())) {
      reloadNow()
    }
  }

  // Invariant: at most one pair of store subscriptions is ever live, and the
  // cleanup below is self-disarming, so unsubscribing twice is impossible even
  // if a future caller drops the guard on the way in.
  const watchStores = () => {
    if (unsubscribeStores) return
    const unsubRoom = useMultiplayerStore.subscribe(flushIfSafe)
    const unsubRolls = useDiceStore.subscribe(flushIfSafe)
    unsubscribeStores = () => {
      unsubscribeStores = null
      unsubRoom()
      unsubRolls()
    }
    cleanups.push(() => unsubscribeStores?.())
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') checkForUpdate?.()
    flushIfSafe()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))

  register({
    immediate: true,
    /**
     * Fired by `vite-plugin-pwa` when the new worker has activated — the exact
     * moment it would otherwise have called `window.location.reload()`.
     */
    onNeedReload: () => {
      reloadPending = true
      // Watch for the session going idle (room left, roll settled) so a deferred
      // reload lands at the first safe moment instead of waiting for a refresh.
      watchStores()
      flushIfSafe()
    },
    onRegisteredSW: (_swScriptUrl, registration) => {
      if (!registration) return
      const check = () => {
        // Offline / transient failures are expected; the next tick retries.
        void registration.update().catch(() => {})
      }
      checkForUpdate = check
      check()
      const timer = window.setInterval(check, intervalMs)
      cleanups.push(() => window.clearInterval(timer))
    },
  })

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    unsubscribeStores = null
    checkForUpdate = null
  }
}
