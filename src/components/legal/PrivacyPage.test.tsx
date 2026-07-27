import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LEGAL_DOCUMENT_VERSION, LEGAL_LAST_UPDATED } from './legalMeta'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  const renderPrivacyPage = () => render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  )

  it('renders the privacy title', () => {
    renderPrivacyPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('renders the retention and deletion section', () => {
    renderPrivacyPage()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Retention and deletion' }),
    ).toBeInTheDocument()
  })

  it('discloses the lack of advertising and analytics', () => {
    renderPrivacyPage()

    expect(screen.getByText(/no advertising, ad identifiers, analytics SDKs/i)).toBeInTheDocument()
  })

  it('describes the manual deletion process and immutable audit history', () => {
    renderPrivacyPage()

    expect(screen.getByText(/deletion requests are handled manually/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot be altered/i)).toBeInTheDocument()
  })

  it('describes guest solo play and transient multiplayer processing', () => {
    renderPrivacyPage()

    expect(screen.getByText(/solo play stays entirely in your browser/i)).toBeInTheDocument()
    expect(screen.getByText(/not stored in our database/i)).toBeInTheDocument()
    expect(screen.getByText(/public server registry exposes server instance metadata/i)).toBeInTheDocument()
  })

  it('mentions row-level security without depending on a count', () => {
    renderPrivacyPage()

    expect(screen.queryAllByText(/row-level security/i)).not.toEqual([])
  })

  it('uses the shared legal metadata', () => {
    renderPrivacyPage()

    expect(screen.getByText(`Last updated: ${LEGAL_LAST_UPDATED}`)).toBeInTheDocument()
    expect(screen.getByText(`Policy version: ${LEGAL_DOCUMENT_VERSION}`)).toBeInTheDocument()
  })

  it('uses client-side navigation and safe Xsolla links', () => {
    renderPrivacyPage()

    expect(screen.getByRole('link', { name: /back to dicesuki/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /its own privacy policy/i })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
    expect(screen.getByRole('link', { name: /its own privacy policy/i })).toHaveAttribute(
      'target',
      '_blank',
    )
  })

  it('renders the transparency notice', () => {
    renderPrivacyPage()

    expect(screen.getByText(/provided for transparency/i)).toBeInTheDocument()
  })
})
