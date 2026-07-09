import { render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InventoryDie, NewInventoryDie } from '../../types/inventory'
import { SharedInventoryDicePreviewCanvas } from './SharedInventoryDicePreviewCanvas'

const renderDiceFaceToTextureMock = vi.hoisted(() => vi.fn(() => new THREE.Texture()))

vi.mock('../../lib/textureRendering', async () => {
  const actual = await vi.importActual<typeof import('../../lib/textureRendering')>('../../lib/textureRendering')
  return {
    ...actual,
    renderDiceFaceToTexture: renderDiceFaceToTextureMock,
  }
})

const makeDie = (overrides: Partial<NewInventoryDie> = {}): InventoryDie => ({
  id: overrides.id ?? `die_${Math.random().toString(36).slice(2)}`,
  type: overrides.type ?? 'd6',
  setId: overrides.setId ?? 'starter',
  rarity: overrides.rarity ?? 'common',
  appearance: {
    baseColor: '#60a5fa',
    accentColor: '#ffffff',
    material: 'plastic',
    ...overrides.appearance,
  },
  vfx: overrides.vfx ?? {},
  name: overrides.name ?? 'Starter d6',
  isFavorite: overrides.isFavorite ?? false,
  isLocked: overrides.isLocked ?? false,
  tags: overrides.tags ?? [],
  source: overrides.source ?? 'starter',
  acquiredAt: overrides.acquiredAt ?? Date.now(),
  stats: {
    timesRolled: 0,
    totalValue: 0,
    critsRolled: 0,
    failsRolled: 0,
    ...overrides.stats,
  },
  assignedToRolls: overrides.assignedToRolls ?? [],
  customAsset: overrides.customAsset,
})

function PreviewHarness({ dice }: { dice: InventoryDie[] }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map())

  return (
    <div ref={hostRef}>
      <SharedInventoryDicePreviewCanvas dice={dice} hostRef={hostRef} slotRefs={slotRefs} />
      {dice.map(die => (
        <span
          key={die.id}
          ref={(element) => {
            if (element) {
              slotRefs.current.set(die.id, element)
            } else {
              slotRefs.current.delete(die.id)
            }
          }}
        />
      ))}
    </div>
  )
}

describe('SharedInventoryDicePreviewCanvas', () => {
  beforeEach(() => {
    renderDiceFaceToTextureMock.mockClear()
  })

  it('uses the engine-textured batched preview mode', () => {
    render(<PreviewHarness dice={[makeDie({ id: 'd1' })]} />)

    expect(screen.getByTestId('inventory-preview-canvas')).toHaveAttribute(
      'data-preview-mode',
      'engine-textured-batched'
    )
    expect(screen.getByTestId('inventory-preview-canvas')).toHaveAttribute('data-preview-batch-size', '6')
  })

  it('reuses one material texture set for identical stock dice', async () => {
    const dice = Array.from({ length: 6 }, (_, index) => makeDie({
      id: `starter-d6-${index}`,
      name: `Starter d6 #${index}`,
    }))

    render(<PreviewHarness dice={dice} />)

    await waitFor(() => {
      expect(renderDiceFaceToTextureMock).toHaveBeenCalledTimes(6)
    })
  })
})
