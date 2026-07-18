/**
 * Theme Selector Component
 *
 * Allows users to preview and switch between themes.
 * Shows owned themes and purchaseable themes.
 */

import { useTheme } from '../contexts/ThemeContext'

interface ThemeSelectorProps {
  isOpen: boolean
  onClose: () => void
}

export function ThemeSelector({ isOpen, onClose }: ThemeSelectorProps) {
  const { currentTheme, setTheme, availableThemes, ownedThemes, purchaseTheme } = useTheme()

  const handleThemeSelect = async (themeId: string) => {
    // Check if user owns the theme
    if (ownedThemes.includes(themeId)) {
      setTheme(themeId)
      onClose()
    } else {
      // Need to purchase first
      const success = await purchaseTheme(themeId)
      if (success) {
        setTheme(themeId)
        onClose()
      }
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Theme Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-theme-bg/60 z-40" onClick={() => onClose()} />

          {/* Panel Content */}
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 max-h-[80vh] bg-theme-surface rounded-lg shadow-2xl z-50 overflow-y-auto"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--border-radius-lg)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2
                  className="text-theme-text text-xl font-bold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Select Theme
                </h2>
                <button
                  onClick={() => onClose()}
                  className="text-theme-text-muted hover:text-theme-text text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Theme List */}
              <div className="space-y-3">
                {availableThemes.map((theme) => {
                  const isOwned = ownedThemes.includes(theme.id)
                  const isCurrent = currentTheme.id === theme.id

                  return (
                    <button
                      key={theme.id}
                      onClick={() => handleThemeSelect(theme.id)}
                      className="w-full p-4 rounded-md border-2 transition-all text-left"
                      style={{
                        borderColor: isCurrent
                          ? 'var(--color-accent)'
                          : 'var(--color-secondary)',
                        backgroundColor: isCurrent
                          ? 'rgba(249, 135, 151, 0.12)'
                          : 'var(--color-background)',
                        borderRadius: 'var(--border-radius-md)',
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3
                            className="text-theme-text font-semibold"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {theme.name}
                          </h3>
                          {isCurrent && (
                            <span
                              className="text-xs font-medium"
                              style={{ color: 'var(--color-accent)' }}
                            >
                              Active
                            </span>
                          )}
                        </div>

                        {!isOwned && theme.price > 0 && (
                          <span
                            className="font-bold text-sm"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            ${(theme.price / 100).toFixed(2)}
                          </span>
                        )}

                        {isOwned && !isCurrent && (
                          <span
                            className="text-xs"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            Owned
                          </span>
                        )}
                      </div>

                      <p
                        className="text-sm"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {theme.description}
                      </p>

                      {!isOwned && theme.price > 0 && (
                        <div
                          className="mt-2 text-xs"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          Click to purchase and activate
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
