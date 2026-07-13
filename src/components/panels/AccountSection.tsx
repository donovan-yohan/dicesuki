/**
 * Account section for the Settings panel (issue #81).
 *
 * Renders the Discord sign-in button (guest) or the signed-in identity card
 * (avatar, name, sign out). When Supabase is not configured the whole section
 * is hidden so guest mode stays clean and prominent — no dead buttons, no
 * console noise.
 */

import { useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'

export function AccountSection() {
  const isConfigured = useAuthStore((s) => s.isConfigured)
  const status = useAuthStore((s) => s.status)
  const profile = useAuthStore((s) => s.profile)
  const signInWithDiscord = useAuthStore((s) => s.signInWithDiscord)
  const signOut = useAuthStore((s) => s.signOut)
  const initialize = useAuthStore((s) => s.initialize)

  // Ensure the session is bootstrapped even if the panel mounts before App's
  // top-level bootstrap has run. initialize is idempotent.
  useEffect(() => {
    if (isConfigured) void initialize()
  }, [isConfigured, initialize])

  // Graceful degradation: accounts unavailable → guest-only, render nothing.
  if (!isConfigured) return null

  return (
    <div className="mb-8">
      <h3
        className="text-sm font-semibold mb-3"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Account
      </h3>

      {status === 'authenticated' && profile ? (
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'rgba(88, 101, 242, 0.1)',
            border: '1px solid rgba(88, 101, 242, 0.3)',
          }}
        >
          <div className="flex items-center gap-3">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt=""
                className="w-10 h-10 rounded-full object-cover"
                style={{ border: `2px solid ${profile.color}` }}
              />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ backgroundColor: profile.color, color: '#fff' }}
                aria-hidden
              >
                {profile.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0 text-left">
              <div
                className="font-semibold text-sm truncate"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {profile.displayName}
              </div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Signed in with Discord
              </div>
            </div>
            <button
              onClick={() => void signOut()}
              className="text-xs px-3 py-1.5 rounded-md transition-all"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={() => void signInWithDiscord()}
            disabled={status === 'loading'}
            className="w-full flex items-center justify-between p-4 rounded-lg transition-all"
            style={{
              backgroundColor: 'rgba(88, 101, 242, 0.12)',
              border: '1px solid rgba(88, 101, 242, 0.35)',
              cursor: status === 'loading' ? 'wait' : 'pointer',
              opacity: status === 'loading' ? 0.6 : 1,
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎮</span>
              <div className="text-left">
                <div
                  className="font-semibold text-sm"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Sign in with Discord
                </div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Sync your profile across devices
                </div>
              </div>
            </div>
            <span style={{ color: 'var(--color-accent)' }}>→</span>
          </button>
          <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Optional — you can keep playing as a guest.
          </p>
        </>
      )}
    </div>
  )
}
