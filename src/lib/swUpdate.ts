import { registerSW } from 'virtual:pwa-register'
import { createStore } from 'zustand/vanilla'
import { useMultiplayerStore, type ConnectionStatus, type RoomTransportKind } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'
import { usePaymentsStore } from '../store/usePaymentsStore'
import { PULL_SESSION_STORAGE_KEY } from './pullFlow'
import { getPwaActivity, setPwaActivating, subscribePwaActivity } from './pwaActivity'
import { isTerminalStatus } from './paymentsOrders'
import { startPwaInstallGuidance } from './pwaInstall'

export const SW_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000
export const SW_RELOAD_GUARD_WINDOW_MS = 60_000
export const SW_RELOAD_GUARD_KEY = 'dicesuki:sw-reloaded-at'
export interface SessionSnapshot {
  connectionStatus: ConnectionStatus
  roomId: string | null
  transport: RoomTransportKind | null
  diceOnTable: number
  rollInFlight: boolean
}
export function isSessionActive(snapshot: SessionSnapshot): boolean {
  if (snapshot.rollInFlight) return true
  if (snapshot.roomId === null || snapshot.connectionStatus === 'disconnected') return false
  return snapshot.transport === 'websocket' || snapshot.diceOnTable > 0
}
export function readSessionSnapshot(): SessionSnapshot {
  const room = useMultiplayerStore.getState()
  const rolls = useDiceStore.getState()
  return {
    connectionStatus: room.connectionStatus,
    roomId: room.roomId,
    transport: room.lastJoin?.transport ?? null,
    diceOnTable: room.dice.size,
    rollInFlight: rolls.rollingDice.size > 0 || rolls.currentRollCycleDice.size > 0 || rolls.savedRollWavesPending,
  }
}
export function readUpdateBlock(): string | null {
  const payment = usePaymentsStore.getState()
  if (payment.pendingOrder && !isTerminalStatus(payment.status)) return 'Finish confirming your purchase before updating.'
  if (getPwaActivity().holds.size) return 'Finish revealing your dice or confirming your purchase before updating.'
  try {
    // Also covers an unmounted shop and cold-start recovery before React mounts.
    if (localStorage.getItem(PULL_SESSION_STORAGE_KEY)) return 'Finish revealing your dice before updating.'
  } catch { return 'Device storage is unavailable. Keep using this version.' }
  const session = readSessionSnapshot()
  if (isSessionActive(session)) return session.transport === 'worker' && !session.rollInFlight
    ? 'Clear your table before updating.'
    : 'Finish your roll or leave the shared room before updating.'
  if (location.pathname.startsWith('/checkout/')) return 'Return to your table after confirming your purchase before updating.'
  if (navigator.onLine === false) return 'Update couldn’t finish. Try again when you’re online.'
  return null
}
interface UpdateState { available: boolean; busy: boolean; message: string | null }
const updates = createStore<UpdateState>(() => ({ available: false, busy: false, message: null }))
export const getServiceWorkerUpdate = updates.getState
export const subscribeServiceWorkerUpdate = updates.subscribe
let explicitUpdate: (() => void) | null = null
/** No queued intent. A blocked action or Later can never become an idle reload. */
export function requestServiceWorkerUpdate(): void { explicitUpdate?.() }
export function deferServiceWorkerUpdate(): void { updates.setState({ message: null }) }
export interface ServiceWorkerUpdateDeps {
  register?: typeof registerSW
  intervalMs?: number
  reload?: () => void
  now?: () => number
}
export function startServiceWorkerUpdates(deps: ServiceWorkerUpdateDeps = {}): () => void {
  const { register = registerSW, intervalMs = SW_UPDATE_CHECK_INTERVAL_MS, reload = () => location.reload(), now = Date.now } = deps
  const stopInstall = startPwaInstallGuidance()
  let registration: ServiceWorkerRegistration | undefined
  let stopped = false
  let reloaded = false
  let activated = false
  let timer: number | undefined
  let channel: MessageChannel | null = null
  updates.setState({ available: false, busy: false, message: null })
  const refresh = () => {
    const message = readUpdateBlock()
    if (updates.getState().message !== message) updates.setState({ message })
  }
  const reloadIfSafe = () => {
    if (stopped || reloaded || !activated || readUpdateBlock()) return
    try {
      const last = Number(sessionStorage.getItem(SW_RELOAD_GUARD_KEY))
      if (last > 0 && now() - last < SW_RELOAD_GUARD_WINDOW_MS) return
      sessionStorage.setItem(SW_RELOAD_GUARD_KEY, String(now()))
    } catch { /* Browser storage refusal must not prevent a safe one-shot reload. */ }
    reloaded = true
    reload()
  }
  explicitUpdate = () => {
    if (stopped) return
    refresh()
    if (readUpdateBlock()) return
    if (activated) { reloadIfSafe(); return }
    if (getPwaActivity().activating) return
    const waiting = registration?.waiting
    if (!waiting) return
    // Reserve account mutation admission before posting. A refused request
    // releases it; an accepted or uncertain request holds it through reload.
    setPwaActivating(true)
    updates.setState({ busy: true })
    channel = new MessageChannel()
    channel.port1.onmessage = event => {
      if (stopped) return
      if (event.data?.type === 'PWA_UPDATE_BLOCKED') {
        setPwaActivating(false)
        updates.setState({ busy: false, message: event.data.reason === 'restart-required'
          ? 'Close all Dicesuki tabs and windows, then reopen Dicesuki to update.'
          : 'Close other Dicesuki tabs, then try updating again.' })
      }
      channel?.port1.close()
      channel = null
    }
    try {
      waiting.postMessage({ type: 'PWA_ACTIVATE_IF_SINGLE_CLIENT' }, [channel.port2])
    } catch {
      channel.port1.close()
      channel.port2.close()
      channel = null
      setPwaActivating(false)
      updates.setState({ busy: false, message: 'Update couldn’t finish. Try again when you’re online.' })
    }
  }
  const check = () => {
    if (!registration || navigator.onLine === false) return
    void registration.update().catch(() => {
      if (!stopped) updates.setState({ message: 'Update couldn’t finish. Try again when you’re online.' })
    })
  }
  const visibility = () => { if (document.visibilityState === 'visible') check(); refresh() }
  const changed = () => { refresh() }
  const unsubs = [
    useMultiplayerStore.subscribe((state, previous) => {
      if (state.connectionStatus !== previous.connectionStatus || state.roomId !== previous.roomId || state.lastJoin?.transport !== previous.lastJoin?.transport || state.dice.size !== previous.dice.size) changed()
    }),
    useDiceStore.subscribe((state, previous) => {
      if (state.rollingDice.size !== previous.rollingDice.size || state.currentRollCycleDice.size !== previous.currentRollCycleDice.size || state.savedRollWavesPending !== previous.savedRollWavesPending) changed()
    }),
    usePaymentsStore.subscribe((state, previous) => { if (state.pendingOrder !== previous.pendingOrder || state.status !== previous.status) changed() }),
    subscribePwaActivity(changed),
  ]
  const workerEvents = navigator.serviceWorker
  const controllerChanged = () => {
    if (!getPwaActivity().activating || stopped) return
    activated = true
    updates.setState({ available: true, busy: false })
    reloadIfSafe()
  }
  workerEvents?.addEventListener('controllerchange', controllerChanged)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('storage', changed)
  window.addEventListener('online', changed)
  window.addEventListener('offline', changed)
  register({
    immediate: true,
    onNeedRefresh: () => { if (!stopped) { updates.setState({ available: true }); refresh() } },
    // With prompt mode this fires only after the explicitly accepted worker
    // takes control. Even then, never discard newly started play or a hidden tab.
    onNeedReload: () => {
      if (stopped) return
      activated = true
      updates.setState({ available: true, busy: false })
      reloadIfSafe()
    },
    onRegisteredSW: (_url, value) => {
      if (stopped || !value) return
      registration = value
      check()
      timer = window.setInterval(check, intervalMs)
    },
    onRegisterError: () => { if (!stopped) updates.setState({ message: 'Update couldn’t finish. Try again when you’re online.' }) },
  })
  return () => {
    stopInstall()
    stopped = true
    explicitUpdate = null
    unsubs.forEach(unsub => unsub())
    window.clearInterval(timer)
    channel?.port1.close()
    workerEvents?.removeEventListener('controllerchange', controllerChanged)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('storage', changed)
    window.removeEventListener('online', changed)
    window.removeEventListener('offline', changed)
  }
}
