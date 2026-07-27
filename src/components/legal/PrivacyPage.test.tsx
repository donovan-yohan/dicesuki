import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('renders the privacy title and key data-handling disclosures', () => {
    // Arrange and Act
    render(<PrivacyPage />)

    // Assert
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Retention and deletion' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/no advertising, ad identifiers, analytics SDKs/i)).toBeInTheDocument()
    expect(screen.getByText(/two years in pseudonymized form/i)).toBeInTheDocument()
    expect(screen.getAllByText(/row-level security/i)).toHaveLength(2)
    expect(screen.getByText('Last updated: 2026-07-27')).toBeInTheDocument()
    expect(screen.getByText('Policy version: 1.0')).toBeInTheDocument()
    expect(screen.getByText(/provided for transparency/i)).toBeInTheDocument()
  })
})
