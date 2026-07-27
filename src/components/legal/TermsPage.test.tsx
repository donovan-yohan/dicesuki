import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TermsPage } from './TermsPage'

describe('TermsPage', () => {
  it('renders the terms title and virtual items section', () => {
    // Arrange and Act
    render(<TermsPage />)

    // Assert
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Virtual items and purchases' }),
    ).toBeInTheDocument()
  })
})
