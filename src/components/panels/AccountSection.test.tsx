import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountSection } from './AccountSection'
import { useAuthStore } from '../../store/useAuthStore'
import { useInventoryStore } from '../../store/useInventoryStore'
afterEach(() => vi.restoreAllMocks())
it('keeps guest solo available and labels the same-account in-memory collection offline', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  useAuthStore.setState({ isConfigured: true, status: 'guest', initialize: vi.fn().mockResolvedValue(undefined) })
  const { rerender } = render(<AccountSection />)
  expect(screen.getByText('You’re offline. You can still roll solo.')).toBeInTheDocument()
  useAuthStore.setState({ status: 'authenticated', user: { id: 'fixture-a' } as never })
  useInventoryStore.setState({ serverCopiesActive: true })
  rerender(<AccountSection />)
  expect(screen.getByText('Showing your last synced collection. Reconnect to make account changes.')).toBeInTheDocument()
  useInventoryStore.setState({ serverCopiesActive: false })
  rerender(<AccountSection />)
  expect(screen.getByText('Reconnect to load your collection.')).toBeInTheDocument()
})
