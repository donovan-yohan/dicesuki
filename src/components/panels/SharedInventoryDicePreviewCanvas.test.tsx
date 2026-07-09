import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import * as THREE from 'three'

import type { InventoryDie, NewInventoryDie } from '../../types/inventory'
import { SharedInventoryDicePreviewCanvas } from './SharedInventoryDicePreviewCanvas'

const renderDiceFaceToTextureMock = vi.hoisted(() => vi.fn(() => new THREE.Texture()))
const threeMocks = vi.hoisted(() => {
  const rendererInstances: Array<{
    setClearColor: ReturnType<typeof vi.fn>
    setScissorTest: ReturnType<typeof vi.fn>
    setPixelRatio: ReturnType<typeof vi.fn>
    setSize: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    setViewport: ReturnType<typeof vi.fn>
    setScissor: ReturnType<typeof vi.fn>
    render: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }> = []
  const WebGLRenderer = vi.fn(function WebGLRenderer() {
    const renderer = {
      setClearColor: vi.fn(),
      setScissorTest: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      clear: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
    rendererInstances.push(renderer)
    return renderer
  })

  return { rendererInstances, WebGLRenderer }
})

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  return {
    ...actual,
    WebGLRenderer: threeMocks.WebGLRenderer,
  }
})

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
    <div ref={hostRef} data-testid="preview-host">
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
    threeMocks.WebGLRenderer.mockClear()
    threeMocks.rendererInstances.length = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('keeps the WebGL renderer alive when the dice list changes', async () => {
    const dice = [makeDie({ id: 'starter-d6-1' })]
    const { rerender } = render(<PreviewHarness dice={dice} />)

    await waitFor(() => {
      expect(threeMocks.WebGLRenderer).toHaveBeenCalledTimes(1)
    })

    rerender(<PreviewHarness dice={[...dice, makeDie({ id: 'starter-d6-2' })]} />)

    await waitFor(() => {
      expect(threeMocks.WebGLRenderer).toHaveBeenCalledTimes(1)
    })
  })

  it('only resizes the renderer when the host size changes', async () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      top: 0,
      right: 120,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    }))

    render(<PreviewHarness dice={[makeDie({ id: 'starter-d6-1' })]} />)

    await waitFor(() => {
      expect(threeMocks.rendererInstances).toHaveLength(1)
    })

    const renderer = threeMocks.rendererInstances[0]
    frameCallbacks.shift()?.(0)
    frameCallbacks.shift()?.(16)

    expect(renderer.setSize).toHaveBeenCalledTimes(1)
    expect(renderer.setSize).toHaveBeenCalledWith(120, 80, false)
  })
})
