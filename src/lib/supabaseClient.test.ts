import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClientForTests,
} from './supabaseClient'

// Mock supabase-js at the module level so no real client is constructed.
const createClientMock = vi.hoisted(() => vi.fn(() => ({ __fake: true })))
vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

describe('supabaseClient graceful degradation', () => {
  beforeEach(() => {
    resetSupabaseClientForTests()
    createClientMock.mockClear()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetSupabaseClientForTests()
  })

  it('reports unconfigured and returns null when env is absent', () => {
    // Arrange: no VITE_SUPABASE_* set (the default test environment).
    // Act + Assert
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabaseClient()).toBeNull()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('treats empty-string env values as unconfigured', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '   ')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '   ')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabaseClient()).toBeNull()
  })

  it('stays unconfigured when only one of the two values is present', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://nksxdfcjabgbxeefwkdc.supabase.co')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabaseClient()).toBeNull()
  })

  it('creates and memoizes a client when both values are present', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://nksxdfcjabgbxeefwkdc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-anon-key')

    expect(isSupabaseConfigured()).toBe(true)
    const first = getSupabaseClient()
    const second = getSupabaseClient()

    expect(first).not.toBeNull()
    expect(first).toBe(second) // memoized
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock).toHaveBeenCalledWith(
      'https://nksxdfcjabgbxeefwkdc.supabase.co',
      'publishable-key',
      expect.objectContaining({ auth: expect.any(Object) }),
    )
  })

  it('accepts the legacy anon env key during the Supabase transition', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://nksxdfcjabgbxeefwkdc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-anon-key')

    expect(isSupabaseConfigured()).toBe(true)
    expect(getSupabaseClient()).not.toBeNull()
    expect(createClientMock).toHaveBeenCalledWith(
      'https://nksxdfcjabgbxeefwkdc.supabase.co',
      'legacy-anon-key',
      expect.objectContaining({ auth: expect.any(Object) }),
    )
  })
})
