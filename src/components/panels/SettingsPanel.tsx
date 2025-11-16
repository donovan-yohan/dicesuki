/**
 * Settings Panel
 *
 * New themed flyout panel for app settings.
 * Includes theme selector and other settings.
 */

import { useState } from 'react'
import { useHapticFeedback } from '../../hooks/useHapticFeedback'
import { getFormattedVersion } from '../../lib/version'
import { ThemeSelector } from '../ThemeSelector'
import { FlyoutPanel } from './FlyoutPanel'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [showThemeSelector, setShowThemeSelector] = useState(false)
  const { isEnabled, isSupported, setEnabled } = useHapticFeedback()

  return (
    <>
      <FlyoutPanel
        isOpen={isOpen}
        onClose={onClose}
        title="Settings"
        position="left"
        width="360px"
      >
        {/* Theme Section */}
        <div className="mb-8">
          <h3
            className="text-sm font-semibold mb-3"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Appearance
          </h3>

          <button
            onClick={() => setShowThemeSelector(true)}
            className="w-full flex items-center justify-between p-4 rounded-lg transition-all"
            style={{
              backgroundColor: 'rgba(251, 146, 60, 0.1)',
              border: '1px solid rgba(251, 146, 60, 0.3)',
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎨</span>
              <div className="text-left">
                <div
                  className="font-semibold text-sm"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Change Theme
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Customize your app appearance
                </div>
              </div>
            </div>
            <span style={{ color: 'var(--color-accent)' }}>→</span>
          </button>
        </div>

        {/* Performance Section */}
        <div className="mb-8">
          <h3
            className="text-sm font-semibold mb-3"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Performance
          </h3>

          <div className="space-y-3">
            {/* Haptic Feedback Toggle */}
            {isSupported && (
              <div
                className="p-4 rounded-lg"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    Haptic Feedback
                  </span>
                  <button
                    onClick={() => setEnabled(!isEnabled)}
                    className="relative inline-block w-10 h-6 cursor-pointer"
                    aria-label="Toggle haptic feedback"
                  >
                    <div
                      className="w-10 h-6 rounded-full transition-all"
                      style={{
                        backgroundColor: isEnabled ? '#fb923c' : 'rgba(255, 255, 255, 0.3)'
                      }}
                    >
                      <div
                        className="absolute top-1 w-4 h-4 rounded-full transition-all"
                        style={{
                          backgroundColor: 'white',
                          left: isEnabled ? '20px' : '4px'
                        }}
                      />
                    </div>
                  </button>
                </div>
                <p
                  className="text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Vibrate on dice collisions
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Version Display */}
        <div className="mt-auto pt-8">
          <div
            className="text-center text-xs"
            style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}
          >
            {getFormattedVersion()}
          </div>
        </div>
      </FlyoutPanel>

      {/* Theme Selector Modal */}
      <ThemeSelector
        isOpen={showThemeSelector}
        onClose={() => setShowThemeSelector(false)}
      />
    </>
  )
}
