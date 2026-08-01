import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DicePool } from './DicePool'

describe('DicePool percentile tile', () => {
  it('is hidden when the parent does not handle percentile rolls', () => {
    render(<DicePool onDiceSelect={vi.fn()} />)
    expect(screen.queryByLabelText('D100 quantity shortcuts')).toBeNull()
  })

  it('offers a D100 tile alongside the plain shapes', () => {
    render(<DicePool onDiceSelect={vi.fn()} onPercentileSelect={vi.fn()} />)

    expect(screen.getByText('D100')).toBeInTheDocument()
    // The engine-only tens die must not appear as a shape of its own.
    expect(screen.queryByText('D10TENS')).toBeNull()
    expect(screen.getByText('D10')).toBeInTheDocument()
  })

  it('adds a percentile entry without touching the shape callback', () => {
    const onDiceSelect = vi.fn()
    const onPercentileSelect = vi.fn()
    render(<DicePool onDiceSelect={onDiceSelect} onPercentileSelect={onPercentileSelect} />)

    fireEvent.click(screen.getByLabelText('Add 1 D100 roll'))
    expect(onPercentileSelect).toHaveBeenCalledWith(1)
    expect(onDiceSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Add 4 D100 rolls'))
    expect(onPercentileSelect).toHaveBeenLastCalledWith(4)
  })

  it('still adds ordinary shapes through onDiceSelect', () => {
    const onDiceSelect = vi.fn()
    render(<DicePool onDiceSelect={onDiceSelect} onPercentileSelect={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Add 1 D10 die'))
    expect(onDiceSelect).toHaveBeenCalledWith('d10', 1)
  })
})
