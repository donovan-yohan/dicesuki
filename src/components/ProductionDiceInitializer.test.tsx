import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProductionDice } from '../hooks/useProductionDice'
import { ProductionDiceInitializer } from './ProductionDiceInitializer'

vi.mock('../hooks/useProductionDice', () => ({
  useProductionDice: vi.fn(),
}))

const mockedUseProductionDice = vi.mocked(useProductionDice)

describe('ProductionDiceInitializer', () => {
  const addAllToInventory = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('waits for the production manifest before syncing inventory', () => {
    mockedUseProductionDice.mockReturnValue(createHookResult({ isLoading: true }))
    render(<ProductionDiceInitializer />)
    expect(addAllToInventory).not.toHaveBeenCalled()
  })

  it('adds missing production dice exactly once after loading', () => {
    mockedUseProductionDice.mockReturnValue(createHookResult())
    const { rerender } = render(<ProductionDiceInitializer />)
    rerender(<ProductionDiceInitializer />)
    expect(addAllToInventory).toHaveBeenCalledTimes(1)
  })

  it('does not mutate inventory when registry loading fails', () => {
    mockedUseProductionDice.mockReturnValue(createHookResult({ error: 'manifest unavailable' }))
    render(<ProductionDiceInitializer />)
    expect(addAllToInventory).not.toHaveBeenCalled()
  })

  function createHookResult(overrides: { isLoading?: boolean; error?: string | null } = {}) {
    return {
      dice: [],
      isLoading: overrides.isLoading ?? false,
      error: overrides.error ?? null,
      manifest: null,
      addToInventory: vi.fn(),
      addAllToInventory,
      isInInventory: vi.fn(),
      getDiceBySet: vi.fn(),
      getSets: vi.fn(),
    }
  }
})
