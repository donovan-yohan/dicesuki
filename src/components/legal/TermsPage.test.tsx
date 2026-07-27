import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LEGAL_DOCUMENT_VERSION, LEGAL_LAST_UPDATED } from './legalMeta'
import { TermsPage } from './TermsPage'

describe('TermsPage', () => {
  const renderTermsPage = () => render(
    <MemoryRouter>
      <TermsPage />
    </MemoryRouter>,
  )

  it('renders the terms title', () => {
    renderTermsPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
  })

  it('renders the virtual-items disclosure', () => {
    renderTermsPage()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Virtual items and purchases' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/immutable, append-only record/i)).toBeInTheDocument()
  })

  it('discloses the sandbox-only purchase state', () => {
    renderTermsPage()

    expect(screen.getByText(/real-money purchases are not yet available/i)).toBeInTheDocument()
  })

  it('describes base rates, server-owned pity, and independently checkable reveals', () => {
    renderTermsPage()

    expect(screen.getByText(/published base rates are authoritative/i)).toBeInTheDocument()
    expect(screen.getByText(/pity rules can only increase effective chances/i)).toBeInTheDocument()
    expect(screen.getByText(/outcomes can be independently checked/i)).toBeInTheDocument()
  })

  it('keeps the guest purchase restriction', () => {
    renderTermsPage()

    expect(screen.getByText(/guest mode.*cannot make purchases/i)).toBeInTheDocument()
  })

  it('uses the shared legal metadata', () => {
    renderTermsPage()

    expect(screen.getByText(`Last updated: ${LEGAL_LAST_UPDATED}`)).toBeInTheDocument()
    expect(screen.getByText(`Terms version: ${LEGAL_DOCUMENT_VERSION}`)).toBeInTheDocument()
  })

  it('uses client-side navigation and safe Xsolla links', () => {
    renderTermsPage()

    expect(screen.getByRole('link', { name: /back to dicesuki/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /xsolla's legal documents/i })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
    expect(screen.getByRole('link', { name: /xsolla's legal documents/i })).toHaveAttribute(
      'target',
      '_blank',
    )
  })

  it('renders the transparency notice', () => {
    renderTermsPage()

    expect(screen.getByText(/provided for transparency/i)).toBeInTheDocument()
  })
})
