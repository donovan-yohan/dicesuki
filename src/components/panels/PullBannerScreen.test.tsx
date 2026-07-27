import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import { PullBannerScreen } from './PullBannerScreen'
import { usePullFlow } from '../../hooks/usePullFlow'
import { fetchMyPullPity } from '../../lib/pullPity'

const startPull = vi.fn()
const mockSupabaseClient = vi.hoisted(() => ({
  from: () => ({
    select: () => ({
      eq: async () => ({
        data: [
          { tier_id: 'standard', weight_units: 80 },
          { tier_id: 'rare', weight_units: 15 },
          { tier_id: 'epic', weight_units: 4 },
          { tier_id: 'signature', weight_units: 1 },
        ],
        error: null,
      }),
    }),
  }),
}))

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: () => mockSupabaseClient,
  isSupabaseConfigured: () => true,
}))

vi.mock('../../lib/pullRpc', () => ({
  fetchActiveStandardPullBanner: vi.fn(async () => ({
    bannerVersionId: 'standard-banner@1',
    bannerId: 'standard-banner',
    bannerVersion: 1,
    bannerFamilyId: 'standard-banner',
    bannerClass: 'standard',
    rollType: 'standard_roll',
  })),
}))

vi.mock('../../lib/pullPity', () => ({
  fetchMyPullPity: vi.fn(async () => ({
    bannerFamilyId: 'standard-banner',
    bannerVersionId: 'standard-banner@1',
    bannerVersion: 1,
    totalPulls: 0,
    rareMisses: 4,
    epicMisses: 2,
    selectedMisses: 0,
    rareHardGuaranteePull: 40,
    epicHardGuaranteePull: 40,
    selectedHardGuaranteePull: 40,
    softPityModel: null,
    softPityStartPull: null,
    softPityPerPullIncrement: null,
  })),
}))

vi.mock('../../hooks/usePullFlow', () => ({
  usePullFlow: vi.fn(),
}))

function flowResult(state: ReturnType<typeof usePullFlow>['state'] = { status: 'idle' }) {
  return {
    state,
    assembly: null,
    summary: null,
    verification: null,
    inventoryRefreshError: null,
    isBusy: false,
    startPull,
    retryPrepare: vi.fn(),
    retryRestore: vi.fn(),
    revealNow: vi.fn(),
    resume: vi.fn(),
    expire: vi.fn(),
    cancel: vi.fn(),
    clearReveal: vi.fn(),
  } as ReturnType<typeof usePullFlow>
}

vi.mock('../../hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => ({ vibrateOnCollision: vi.fn() }),
}))

function setState(status: 'guest' | 'authenticated', tickets: number, stars: number) {
  useAuthStore.setState({
    status,
    user: status === 'authenticated' ? ({ id: 'user-1' } as never) : null,
  })
  useWalletStore.setState({
    userId: status === 'authenticated' ? 'user-1' : null,
    tickets: { standard_roll: tickets, premium_roll: 0 },
    wallet: { stars: { promotional: stars }, dust: { earned: 0 } },
    loading: false,
    stale: false,
  })
}

function BannerFixture({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <PullBannerScreen
        onClose={onClose}
        onOpenShop={vi.fn()}
        onAddDie={vi.fn(() => 'request')}
        tableDiceCount={0}
        deviceTier="low"
      />
    </ThemeContext.Provider>
  )
}

function renderBanner() {
  return render(<BannerFixture />)
}

describe('PullBannerScreen CTA matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePullFlow).mockReturnValue(flowResult())
    useWalletStore.getState().resetOnSignOut()
  })

  it.each([
    ['guest', 0, 0, /sign in to pull/i],
    ['authenticated', 10, 0, /pull ×10 · 10 rolls/i],
    ['authenticated', 0, 1600, /pull ×10 · convert 1600 stars/i],
    ['authenticated', 0, 0, /need 10 more rolls/i],
  ] as const)(
    'renders %s state with %i tickets and %i Stars',
    async (status, tickets, stars, expected) => {
      setState(status, tickets, stars)
      renderBanner()
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: expected }).length).toBeGreaterThan(0)
      })
    },
  )

  it('keeps odds, pity, pool, and fairness copy in the one-tap banner details modal', async () => {
    setState('authenticated', 10, 0)
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: /banner details/i }))

    expect(screen.getByRole('dialog', { name: 'Banner details' })).toBeInTheDocument()
    expect(await screen.findByText(/Rare\+ guaranteed within 36 pulls/i)).toBeInTheDocument()
    expect(screen.getByText('Epic+ hard guarantee: pull 40')).toBeInTheDocument()
    expect(screen.getByText('Selected-item hard guarantee: pull 40')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pool' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Base odds' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fair pulls' })).toBeInTheDocument()
  })

  it('opens premium banner details with its coming-soon status in one tap', async () => {
    setState('authenticated', 10, 0)
    renderBanner()
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('tab', { name: /premium/i }))
    fireEvent.click(screen.getByRole('button', { name: /banner details/i }))

    const dialog = screen.getByRole('dialog', { name: 'Banner details' })
    expect(within(dialog).getByText('Premium pool details are coming soon.')).toBeInTheDocument()
    expect(within(dialog).getByText('Premium banner odds are unavailable while it is coming soon.')).toBeInTheDocument()
    expect(within(dialog).getByText('Soft pity begins at pull 41; featured is guaranteed by 75.')).toBeInTheDocument()
  })

  it('keeps focus inside banner details and lets Escape close only that modal', async () => {
    setState('authenticated', 10, 0)
    const onClose = vi.fn()
    render(<BannerFixture onClose={onClose} />)
    const trigger = await screen.findByRole('button', { name: /banner details/i })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Banner details' })
    const close = within(dialog).getByRole('button', { name: 'Close banner details' })
    await waitFor(() => expect(close).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Banner details' })).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('clamps ARIA pity progress to the server-owned maximum', async () => {
    vi.mocked(fetchMyPullPity).mockResolvedValueOnce({
      bannerFamilyId: 'standard-banner',
      bannerVersionId: 'standard-banner@1',
      bannerVersion: 1,
      totalPulls: 50,
      rareMisses: 44,
      epicMisses: 2,
      selectedMisses: 0,
      rareHardGuaranteePull: 40,
      epicHardGuaranteePull: 40,
      selectedHardGuaranteePull: 40,
      softPityModel: null,
      softPityStartPull: null,
      softPityPerPullIncrement: null,
    })
    setState('authenticated', 10, 0)
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: /banner details/i }))

    expect(await screen.findByRole('progressbar', {
      name: 'Rare guarantee progress',
    })).toHaveAttribute('aria-valuenow', '40')
  })

  it('refetches pity only when the flow enters a terminal transition', async () => {
    setState('authenticated', 10, 0)
    const view = renderBanner()
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledOnce())
    expect(fetchMyPullPity).toHaveBeenCalledOnce()

    vi.mocked(usePullFlow).mockReturnValue(flowResult({ status: 'preparing' } as never))
    view.rerender(<BannerFixture />)
    expect(fetchMyPullPity).toHaveBeenCalledOnce()

    vi.mocked(usePullFlow).mockReturnValue(flowResult({
      status: 'cancelled',
      message: 'No rolls spent.',
    }))
    view.rerender(<BannerFixture />)
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledTimes(2))

    view.rerender(<BannerFixture />)
    expect(fetchMyPullPity).toHaveBeenCalledTimes(2)

    vi.mocked(usePullFlow).mockReturnValue(flowResult({ status: 'idle' }))
    view.rerender(<BannerFixture />)
    expect(fetchMyPullPity).toHaveBeenCalledTimes(2)

    vi.mocked(usePullFlow).mockReturnValue(flowResult({
      status: 'expired',
      message: 'Hold expired — no rolls spent.',
    }))
    view.rerender(<BannerFixture />)
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledTimes(3))

    vi.mocked(usePullFlow).mockReturnValue(flowResult({ status: 'idle' }))
    view.rerender(<BannerFixture />)
    expect(fetchMyPullPity).toHaveBeenCalledTimes(3)

    vi.mocked(usePullFlow).mockReturnValue(flowResult({ status: 'revealed' } as never))
    view.rerender(<BannerFixture />)
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledTimes(4))
  })

  it('opens explicit conversion and free-faucet sheets instead of silently spending', async () => {
    setState('authenticated', 0, 1600)
    const { unmount } = renderBanner()
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledOnce())
    fireEvent.click(await screen.findByRole('button', {
      name: /pull ×10 · convert 1600 stars/i,
    }))
    const conversion = screen.getByRole('dialog', { name: 'Convert Stars → rolls' })
    expect(conversion).toBeInTheDocument()
    expect(within(conversion).getByText(/convert 1600 stars/i)).toBeInTheDocument()

    unmount()
    setState('authenticated', 0, 0)
    renderBanner()
    await waitFor(() => expect(fetchMyPullPity).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: /how to earn more rolls/i }))
    expect(screen.getByRole('dialog', { name: 'Not enough rolls yet' })).toBeInTheDocument()
    expect(screen.getByText(/daily login: \+1 roll tomorrow/i)).toBeInTheDocument()
    expect(screen.getByText(/weekly budget: 10 rolls per week/i)).toBeInTheDocument()
  })

  it('retains an in-flight session across auth loss and asks for sign-in', () => {
    vi.mocked(usePullFlow).mockReturnValue(flowResult({
      status: 'restoring',
      persisted: {
        version: 1,
        ownerId: 'user-1',
        intent: {
          ownerId: 'user-1',
          bannerVersionId: 'standard-banner@1',
          pullCount: 1,
          idempotencyKey: 'pull:stable-key',
          createdAt: '2026-07-24T00:00:00.000Z',
        },
        preparation: null,
        status: 'intent',
      },
    }))
    setState('guest', 0, 0)
    renderBanner()
    expect(screen.getByRole('dialog', { name: 'Sign in to continue' })).toBeInTheDocument()
    expect(screen.getByText(/pull session is retained/i)).toBeInTheDocument()
  })
})
