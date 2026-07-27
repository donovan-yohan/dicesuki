import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryDie } from '../../types/inventory'
import type {
  PullRevealAssembly,
  PullRevealItem,
  PullRevealResult,
  PullRevealSummary,
} from '../../types/pull'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import { PullRevealOverlay } from './PullRevealOverlay'

vi.mock('../../hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => ({ vibrateOnCollision: vi.fn() }),
}))

function die(id: string, name: string): InventoryDie {
  return {
    id,
    type: 'd20',
    setId: 'ember',
    rarity: 'legendary',
    appearance: {
      baseColor: '#111111',
      accentColor: '#eeeeee',
      material: 'metal',
    },
    vfx: {},
    name,
    isFavorite: false,
    isLocked: true,
    acquiredAt: 1,
    source: 'gacha_standard',
    stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
    assignedToRolls: [],
  }
}

function result(position: number, duplicate = false): PullRevealResult {
  return {
    position,
    catalogItemId: `catalog-${position}`,
    tierId: position === 1 ? 'signature' : 'rare',
    tierRank: position === 1 ? 4 : 2,
    selectedTargetCatalogItemId: null,
    reason: 'base',
    rareBefore: 0,
    rareAfter: 0,
    epicBefore: 0,
    epicAfter: 0,
    selectedBefore: 0,
    selectedAfter: 0,
    isDuplicate: duplicate,
    isFirstCopy: !duplicate,
    duplicateDustAmount: duplicate ? 25 : 0,
    nonce: `${position}`.repeat(64),
    commitment: `${position + 1}`.repeat(64),
  }
}

function item(position: number, duplicate = false): PullRevealItem {
  const inventoryDie = die(`copy-${position}`, `Ember d20 ${position}`)
  return {
    result: result(position, duplicate),
    rarity: inventoryDie.rarity,
    inventoryDie,
    inventoryDieId: inventoryDie.id,
    liveCopyCount: duplicate ? 2 : 1,
    isNew: !duplicate,
    copyLine: `+1 copy (owned ×${duplicate ? 2 : 1})`,
    dustLine: duplicate ? '+25 Dust' : null,
  }
}

function assembly(items: PullRevealItem[]): PullRevealAssembly {
  return {
    receipt: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      bannerVersionId: 'standard-banner@1',
      pullCount: items.length === 1 ? 1 : 10,
      heldAmount: items.length,
      committedAt: '2026-07-24T00:00:01.000Z',
      commitmentScheme: 'sha256-merkle-v1',
      commitmentRoot: 'a'.repeat(64),
      rngScheme: 'sha256-hmac-v1',
      rngSeed: 'b'.repeat(64),
      results: items.map(entry => entry.result),
    },
    items,
  }
}

function summary(items: PullRevealItem[]): PullRevealSummary {
  return {
    pullCount: items.length === 1 ? 1 : 10,
    newCount: items.filter(entry => entry.result.isFirstCopy).length,
    duplicateCount: items.filter(entry => entry.result.isDuplicate).length,
    firstCopyCount: items.filter(entry => entry.result.isFirstCopy).length,
    duplicateDustTotal: items.reduce(
      (total, entry) => total + entry.result.duplicateDustAmount,
      0,
    ),
    highlights: [{ tierId: 'signature', count: 1, bestRank: 4 }],
  }
}

function withTheme(ui: ReactNode) {
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
      {ui}
    </ThemeContext.Provider>
  )
}

function renderReveal(ui: ReactNode) {
  return render(withTheme(ui))
}

describe('PullRevealOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMultiplayerStore.setState({ roomActionError: null })
  })

  it('renders real first-copy/copy truth without a result verification disclosure', () => {
    const items = [item(1)]
    const onAddDie = vi.fn(() => 'request-1')
    renderReveal(
      <PullRevealOverlay
        assembly={assembly(items)}
        summary={summary(items)}
        deviceTier="low"
        tableDiceCount={0}
        onAddDie={onAddDie}
        onDone={vi.fn()}
      />,
    )

    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.getByText('+1 copy (owned ×1)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to table' }))
    expect(onAddDie).toHaveBeenCalledWith('d20', 'copy-1')

    expect(screen.getByText(
      'You won Ember d20 1, legendary, new, +1 copy (owned ×1)',
    )).toBeInTheDocument()
    expect(screen.queryByText(/provably fair/i)).not.toBeInTheDocument()
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
    expect(screen.queryByText('b'.repeat(64))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy result 1 nonce/i })).not.toBeInTheDocument()
  })

  it('inserts an empty live region before the post-mount announcement effect', () => {
    const items = [item(1)]
    const reveal = (
      <PullRevealOverlay
        assembly={assembly(items)}
        summary={summary(items)}
        deviceTier="low"
        tableDiceCount={0}
        onAddDie={vi.fn(() => 'request')}
        onDone={vi.fn()}
      />
    )
    const preEffect = document.createElement('div')
    preEffect.innerHTML = renderToStaticMarkup(withTheme(reveal))
    const insertedLiveRegion = preEffect.querySelector(
      '[role="status"][aria-live="polite"]',
    )

    expect(insertedLiveRegion).not.toBeNull()
    expect(insertedLiveRegion).toBeEmptyDOMElement()

    renderReveal(reveal)
    expect(screen.getByText(
      'You won Ember d20 1, legendary, new, +1 copy (owned ×1)',
    )).toBeInTheDocument()
  })

  it('claims through the room backend up to capacity and reports the remainder', () => {
    const items = Array.from({ length: 10 }, (_, index) => item(index + 1, index > 0))
    const onAddDie = vi.fn(() => 'request')
    renderReveal(
      <PullRevealOverlay
        assembly={assembly(items)}
        summary={summary(items)}
        deviceTier="low"
        tableDiceCount={29}
        onAddDie={onAddDie}
        onDone={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Skip reveal' }))
    fireEvent.click(screen.getByRole('button', { name: /inspect ember d20 1, legendary/i }))
    expect(screen.getByRole('dialog', { name: 'Ember d20 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close result inspection/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add all to table' }))
    expect(onAddDie).toHaveBeenCalledOnce()
    expect(screen.getByText(
      'Requested 1; the room will confirm placement. 9 dice remain safe in your inventory.',
    )).toBeInTheDocument()
  })

  it('surfaces a server rejection without claiming placement succeeded', async () => {
    const items = [item(1)]
    renderReveal(
      <PullRevealOverlay
        assembly={assembly(items)}
        summary={summary(items)}
        deviceTier="low"
        tableDiceCount={0}
        onAddDie={vi.fn(() => 'request')}
        onDone={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to table' }))
    act(() => {
      useMultiplayerStore.setState({
        roomActionError: { code: 'DICE_LIMIT', message: 'Room is full' },
      })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Room rejected the request: Room is full. The dice remain in your inventory.',
    )
  })

  it('omits stale copy counts and skips unjoined identities when claiming', () => {
    const stale = {
      ...item(1),
      rarity: null,
      inventoryDie: null,
      inventoryDieId: null,
      liveCopyCount: null,
      copyLine: null,
    }
    const joined = item(2, true)
    const items = [stale, joined]
    const onAddDie = vi.fn(() => 'request')
    renderReveal(
      <PullRevealOverlay
        assembly={assembly(items)}
        summary={summary(items)}
        deviceTier="low"
        tableDiceCount={0}
        onAddDie={onAddDie}
        onDone={vi.fn()}
      />,
    )

    expect(screen.queryByText('+1 copy (owned ×1)')).not.toBeInTheDocument()
    expect(screen.getByTestId('pull-receipt-only-result-1')).toHaveTextContent(
      'Catalog item catalog-1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skip reveal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add all to table' }))
    expect(onAddDie).toHaveBeenCalledOnce()
    expect(onAddDie).toHaveBeenCalledWith('d20', 'copy-2')
    expect(screen.getByText(
      'Requested 1; the room will confirm placement. 1 die remains safe in your inventory.',
    )).toBeInTheDocument()
  })
})
