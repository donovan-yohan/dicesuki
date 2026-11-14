import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PwaAppSection } from './PwaAppSection'
import { startPwaInstallGuidance, PWA_VALUE_KEY } from '../../lib/pwaInstall'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useDiceStore } from '../../store/useDiceStore'
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
let stop: (() => void) | undefined
beforeEach(() => {
  localStorage.clear()
  useMultiplayerStore.setState({ roomId: null, connectionStatus: 'disconnected', lastJoin: null })
  useDiceStore.setState({ rollHistory: [], rollingDice: new Set(), currentRollCycleDice: new Set(), savedRollWavesPending: false })
})
afterEach(() => { stop?.(); vi.restoreAllMocks() })
function installEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn().mockResolvedValue(undefined)
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
  act(() => window.dispatchEvent(event))
  return prompt
}
it('qualifies education from a completed solo roll only on a later page visit', () => {
  stop = startPwaInstallGuidance()
  render(<PwaAppSection />)
  const prompt = installEvent()
  expect(screen.queryByText('Keep Dicesuki handy')).toBeNull()
  useMultiplayerStore.setState({ lastJoin: { transport: 'worker' } as never })
  act(() => useDiceStore.getState().recordRoomCompletedRoll({ dice: [], sum: 6, timestamp: 1 }))
  expect(localStorage.getItem(PWA_VALUE_KEY)).toBe('completed')
  expect(screen.queryByText('Keep Dicesuki handy')).toBeNull()
  expect(prompt).not.toHaveBeenCalled()
  stop()
  act(() => { stop = startPwaInstallGuidance() })
  installEvent()
  expect(screen.getByText('Keep Dicesuki handy')).toBeInTheDocument()
})
it('consumes the native event only on an explicit click, then removes the dead action', async () => {
  localStorage.setItem(PWA_VALUE_KEY, 'completed')
  stop = startPwaInstallGuidance()
  render(<PwaAppSection />)
  const prompt = installEvent()
  expect(prompt).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Dicesuki' })) })
  expect(prompt).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Install Dicesuki' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'App' })).toHaveFocus()
})
it('uses dismissible inline iOS guidance rather than a fake install button', () => {
  localStorage.setItem(PWA_VALUE_KEY, 'completed')
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Version/18.0 Safari/605.1')
  stop = startPwaInstallGuidance()
  render(<PwaAppSection />)
  expect(screen.getByText('Tap Share, then Add to Home Screen.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Install Dicesuki' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(screen.queryByText('Tap Share, then Add to Home Screen.')).toBeNull()
})
