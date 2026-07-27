import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TermsPage } from './TermsPage'

describe('TermsPage', () => {
  it('renders the terms title and gacha disclosures', () => {
    // Arrange and Act
    render(<TermsPage />)

    // Assert
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Virtual items and purchases' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/immutable, append-only record/i)).toBeInTheDocument()
    expect(screen.getByText(/published rates are authoritative/i)).toBeInTheDocument()
    expect(screen.getByText(/guest mode.*cannot make purchases/i)).toBeInTheDocument()
    expect(screen.getByText('Last updated: 2026-07-27')).toBeInTheDocument()
    expect(screen.getByText(/provided for transparency/i)).toBeInTheDocument()
  })
})
