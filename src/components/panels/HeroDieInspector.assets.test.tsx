import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInventoryStore } from '../../store/useInventoryStore'
import { defaultTheme } from '../../themes/tokens'
import type { NewInventoryDie } from '../../types/inventory'
import { HeroDieInspector } from './HeroDieInspector'

/**
 * Asset-failure behaviour of the inspector's preview stage (issue #210).
 *
 * The sibling `HeroDieInspector.test.tsx` stubs `Canvas` out entirely to keep
 * the form tests fast; here it renders its children so the stage's asset
 * loaders actually mount and can fail. `<Canvas>`'s own boundary re-throws into
 * the DOM tree, so without a boundary next to each loader a rejected HDR or GLB
 * takes the whole panel — and, in the app, the whole page — down with it.
 */
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-canvas">{children}</div>
  ),
}))

vi.mock('@react-three/drei', () => ({
  Environment: () => {
    throw new Error('Could not load potsdamer_platz_1k.hdr: Failed to fetch')
  },
}))

vi.mock('../../hooks/useGltfDiceLoader', () => ({
  useGltfDiceLoader: () => {
    throw new Error('Could not load model.glb: Failed to fetch')
  },
}))

const makeDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd20',
  setId: 'adventurer-starter',
  rarity: 'rare',
  appearance: { baseColor: '#2563eb', accentColor: '#ffffff', material: 'plastic' },
  vfx: {},
  name: 'Starter d20',
  description: '',
  isFavorite: false,
  isLocked: false,
  tags: [],
  source: 'starter',
  assignedToRolls: [],
  ...overrides,
})

describe('HeroDieInspector preview stage assets', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('keeps the panel usable when the HDR environment map rejects', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const die = useInventoryStore.getState().addDie(makeDie())

      render(<HeroDieInspector die={die} theme={defaultTheme} onClose={vi.fn()} />)

      expect(screen.getByTestId('hero-die-stage')).toBeInTheDocument()
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save identity/i })).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('falls back to the procedural die when the managed GLB rejects', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const die = useInventoryStore.getState().addDie(
        makeDie({
          customAsset: {
            assetId: 'asset-1',
            modelUrl: 'blob:model.glb',
            metadata: { scale: 1 },
          },
        } as Partial<NewInventoryDie>),
      )

      render(<HeroDieInspector die={die} theme={defaultTheme} onClose={vi.fn()} />)

      expect(screen.getByTestId('hero-die-stage')).toBeInTheDocument()
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })
})
