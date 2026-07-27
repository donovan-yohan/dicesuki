import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('renders the privacy title and retention section', () => {
    // Arrange and Act
    render(<PrivacyPage />)

    // Assert
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Retention and deletion' }),
    ).toBeInTheDocument()
  })
})
