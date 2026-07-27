import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App'

describe('AppRoutes legal pages', () => {
  it.each([
    ['/terms', 'Terms of Service'],
    ['/privacy', 'Privacy Policy'],
  ])('renders %s', async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes paymentsEnabled={false} />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })
})
