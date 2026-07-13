import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInventoryStore } from '../../store/useInventoryStore'
import { defaultTheme } from '../../themes/tokens'
import type { NewInventoryDie } from '../../types/inventory'
import { HeroDieInspector } from './HeroDieInspector'

// Canvas is mocked so the static preview meshes (StandardHeroDie / CustomHeroDie)
// never mount in jsdom; this keeps the test focused on the inspector's form logic.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="mock-canvas" />,
}))

vi.mock('@react-three/drei', () => ({
  Environment: () => null,
}))

const makeDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd20',
  setId: 'adventurer-starter',
  rarity: 'rare',
  appearance: {
    baseColor: '#2563eb',
    accentColor: '#ffffff',
    material: 'plastic',
  },
  vfx: {},
  name: 'Starter d20',
  description: 'Opening note',
  isFavorite: false,
  isLocked: false,
  tags: ['starter'],
  source: 'starter',
  assignedToRolls: [],
  ...overrides,
})

describe('HeroDieInspector', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('persists favorite, name, notes, and tags through the inventory store', () => {
    const die = useInventoryStore.getState().addDie(makeDie())

    render(
      <HeroDieInspector
        die={die}
        theme={defaultTheme}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTestId('hero-die-stage')).toHaveAttribute('data-lod', expect.stringContaining('hero'))

    fireEvent.click(screen.getByRole('button', { name: /favorite/i }))
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Lucky Persuasion d20' } })
    fireEvent.change(screen.getByLabelText(/tags/i), { target: { value: 'social, lucky, social' } })
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'Saved for important checks' } })
    fireEvent.click(screen.getByRole('button', { name: /save identity/i }))

    const updated = useInventoryStore.getState().dice.find(item => item.id === die.id)
    expect(updated?.isFavorite).toBe(true)
    expect(updated?.name).toBe('Lucky Persuasion d20')
    expect(updated?.description).toBe('Saved for important checks')
    expect(updated?.tags).toEqual(['social', 'lucky'])
  })
})
