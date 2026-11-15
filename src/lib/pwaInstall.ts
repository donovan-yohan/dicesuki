import { createStore } from 'zustand/vanilla'
import { useDiceStore } from '../store/useDiceStore'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

export const PWA_VALUE_KEY = 'dicesuki:pwa-solo-value-v1'
const DISMISSED_KEY = 'dicesuki:pwa-install-dismissed-v1'
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
interface InstallState { eligible: boolean; native: boolean; ios: boolean; dismissed: boolean; installed: boolean }
const install = createStore<InstallState>(() => ({ eligible: false, native: false, ios: false, dismissed: false, installed: false }))
export const getPwaInstall = install.getState
export const subscribePwaInstall = install.subscribe
let promptEvent: InstallPromptEvent | null = null
export function dismissPwaInstall(): void {
  install.setState({ dismissed: true })
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* Session state still dismisses. */ }
}
export async function promptPwaInstall(): Promise<void> {
  const event = promptEvent
  if (!event) return
  promptEvent = null
  install.setState({ native: false })
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') install.setState({ installed: true })
    else dismissPwaInstall()
  } catch { dismissPwaInstall() }
}
export function startPwaInstallGuidance(): () => void {
  // Do not install listeners in embedded contexts, including Discord Activity.
  if (window.top !== window.self) return () => {}
  let eligible = false
  let dismissed = false
  try {
    eligible = localStorage.getItem(PWA_VALUE_KEY) === 'completed'
    const at = Number(localStorage.getItem(DISMISSED_KEY))
    dismissed = at > 0 && Date.now() - at < DISMISS_MS
  } catch { /* No storage means no unsolicited education. */ }
  const standalone = window.matchMedia?.('(display-mode: standalone)')
  const installed = standalone?.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
  install.setState({ eligible, dismissed, installed, native: false, ios: ios && safari })
  promptEvent = null
  const beforeInstall = (event: Event) => {
    event.preventDefault()
    promptEvent = event as InstallPromptEvent
    install.setState({ native: true })
  }
  const installedNow = () => { promptEvent = null; install.setState({ installed: true, native: false }) }
  const displayChanged = () => { if (standalone?.matches) installedNow() }
  const unsub = useDiceStore.subscribe((state, previous) => {
    const latest = state.rollHistory[state.rollHistory.length - 1]
    if (!latest || latest.id === previous.rollHistory[previous.rollHistory.length - 1]?.id || useMultiplayerStore.getState().lastJoin?.transport !== 'worker') return
    // Read eligibility once per page instance. This roll qualifies the NEXT
    // visit, never the first page on which value was demonstrated.
    try { localStorage.setItem(PWA_VALUE_KEY, 'completed') } catch { /* Best effort. */ }
  })
  window.addEventListener('beforeinstallprompt', beforeInstall)
  window.addEventListener('appinstalled', installedNow)
  standalone?.addEventListener('change', displayChanged)
  return () => {
    unsub()
    promptEvent = null
    window.removeEventListener('beforeinstallprompt', beforeInstall)
    window.removeEventListener('appinstalled', installedNow)
    standalone?.removeEventListener('change', displayChanged)
  }
}
