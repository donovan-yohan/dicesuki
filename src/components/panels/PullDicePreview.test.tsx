import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import type { InventoryDie } from '../../types/inventory'
import type { DiceRenderLodPolicy } from '../../lib/renderLod'
import { PullDicePreview } from './PullDicePreview'

vi.mock('./SharedInventoryDicePreviewCanvas', () => ({
  SharedInventoryDicePreviewCanvas: ({
    lodPolicy,
  }: {
    lodPolicy: DiceRenderLodPolicy
  }) => (
    <canvas
      data-testid="pooled-webgl"
      data-texture-size={lodPolicy.textureSize}
      data-geometry-detail={lodPolicy.geometryDetail}
      data-animation-quality={lodPolicy.animationQuality}
    />
  ),
}))

const die: InventoryDie = {
  id: 'copy-1',
  type: 'd20',
  setId: 'ember',
  rarity: 'legendary',
  appearance: {
    baseColor: '#111111',
    accentColor: '#eeeeee',
    material: 'metal',
  },
  vfx: {},
  name: 'Ember d20',
  isFavorite: false,
  isLocked: true,
  acquiredAt: 1,
  source: 'gacha_standard',
  stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
  assignedToRolls: [],
}

function renderPreview(deviceTier: 'low' | 'mid' | 'high', mode: 'hero' | 'grid') {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <PullDicePreview dice={[die]} deviceTier={deviceTier} mode={mode} />
    </ThemeContext.Provider>,
  )
}

describe('PullDicePreview renderer selection', () => {
  it('uses a non-WebGL fallback for low-tier heroes', () => {
    const { container } = renderPreview('low', 'hero')
    expect(container.querySelector('[data-preview-mode="static"]')).toBeInTheDocument()
    expect(screen.queryByTestId('pooled-webgl')).not.toBeInTheDocument()
    expect(screen.getByText('d20')).toBeInTheDocument()
  })

  it('passes operational reduced LOD to the medium pooled grid renderer', () => {
    renderPreview('mid', 'grid')
    const canvas = screen.getByTestId('pooled-webgl')
    expect(canvas).toHaveAttribute('data-texture-size', '128')
    expect(canvas).toHaveAttribute('data-geometry-detail', 'reduced')
    expect(canvas).toHaveAttribute('data-animation-quality', 'reduced')
  })

  it('passes full hero LOD to the high-tier pooled renderer', () => {
    renderPreview('high', 'hero')
    const canvas = screen.getByTestId('pooled-webgl')
    expect(canvas).toHaveAttribute('data-texture-size', '1024')
    expect(canvas).toHaveAttribute('data-geometry-detail', 'full')
    expect(canvas).toHaveAttribute('data-animation-quality', 'full')
  })
})
