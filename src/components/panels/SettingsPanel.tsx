/**
 * Settings Panel
 *
 * New themed flyout panel for app settings.
 * Includes theme selector and other settings.
 */

import { useState } from 'react'
import { FlyoutPanel } from './FlyoutPanel'
import { ThemeSelector } from '../ThemeSelector'
import { useHapticFeedback } from '../../hooks/useHapticFeedback'

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
                  <label className="relative inline-block w-10 h-6 cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={isEnabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <div
                      className="w-10 h-6 rounded-full transition-all peer-checked:bg-orange-500"
                      style={{ backgroundColor: 'rgba(255, 255, 255, 0.3)' }}
                    >
                      <div
                        className="absolute top-1 left-1 w-4 h-4 rounded-full transition-all peer-checked:translate-x-4"
                        style={{ backgroundColor: 'white' }}
                      />
                    </div>
                  </label>
                </div>
                <p
                  className="text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Vibrate on dice collisions
                </p>
              </div>
            )}

            {/* Reduce Motion */}
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
                  Reduce Motion
                </span>
                <label className="relative inline-block w-10 h-6">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={window.matchMedia('(prefers-reduced-motion: reduce)').matches}
                    disabled
                  />
                  <div
                    className="w-10 h-6 rounded-full transition-all peer-checked:bg-orange-500"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.3)' }}
                  />
                </label>
              </div>
              <p
                className="text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Follows system preference
              </p>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div>
          <h3
            className="text-sm font-semibold mb-3"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            About
          </h3>

          <div
            className="p-4 rounded-lg space-y-2"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-sm"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Version
              </span>
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                0.1.0
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span
                className="text-sm"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Build
              </span>
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                MVP
              </span>
            </div>
          </div>

          <div
            className="mt-4 p-4 rounded-lg text-xs text-center"
            style={{
              backgroundColor: 'rgba(251, 146, 60, 0.1)',
              color: 'var(--color-text-secondary)',
              border: '1px solid rgba(251, 146, 60, 0.2)',
            }}
          >
            Made with ❤️ using React Three Fiber
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
