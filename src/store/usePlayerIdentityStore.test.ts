import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayerIdentityStore, DEFAULT_PLAYER_COLOR } from './usePlayerIdentityStore'

describe('usePlayerIdentityStore', () => {
  beforeEach(() => {
    localStorage.clear()
    usePlayerIdentityStore.setState({ displayName: '', color: DEFAULT_PLAYER_COLOR })
  })

  it('defaults to an empty name and the default color', () => {
    const state = usePlayerIdentityStore.getState()
    expect(state.displayName).toBe('')
    expect(state.color).toBe(DEFAULT_PLAYER_COLOR)
  })

  it('remembers a trimmed display name and color', () => {
    usePlayerIdentityStore.getState().setIdentity({ displayName: '  Frodo  ', color: '#3B82F6' })
    const state = usePlayerIdentityStore.getState()
    expect(state.displayName).toBe('Frodo')
    expect(state.color).toBe('#3B82F6')
  })

  it('ignores an empty/whitespace name but still updates the color', () => {
    usePlayerIdentityStore.getState().setIdentity({ displayName: 'Sam', color: '#111111' })
    usePlayerIdentityStore.getState().setIdentity({ displayName: '   ', color: '#222222' })
    const state = usePlayerIdentityStore.getState()
    expect(state.displayName).toBe('Sam')
    expect(state.color).toBe('#222222')
  })

  it('persists identity to localStorage for the next session', () => {
    usePlayerIdentityStore.getState().setIdentity({ displayName: 'Merry', color: '#abcdef' })
    const raw = localStorage.getItem('dicesuki-player-identity')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.displayName).toBe('Merry')
    expect(parsed.state.color).toBe('#abcdef')
  })
})
