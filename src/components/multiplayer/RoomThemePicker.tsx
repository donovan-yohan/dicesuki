/**
 * Room Theme Picker
 *
 * Preview-card grid for choosing the shared room environment theme (#76).
 * Each card renders a lightweight visual identity built directly from the
 * theme's own tokens (background gradient/color + a few accent swatches) so the
 * host can see what they are choosing without loading any heavy 3D preview.
 *
 * Reused by:
 * - the room creation flow (Settings panel) to pick a theme before creating,
 * - the host settings panel (PlayerPanel) to switch the theme live.
 *
 * The `null` value ("Each player's own") maps to no shared room theme, letting
 * every client fall back to their personal theme (see resolveRoomEnvironmentTheme).
 */

import type { Theme } from '../../themes/tokens'
import { THEME_REGISTRY } from '../../themes/registry'

interface RoomThemePickerProps {
  /** Currently selected room theme id, or null for "each player's own". */
  value: string | null
  /** Called with the chosen theme id, or null for "each player's own". */
  onChange: (themeId: string | null) => void
  /** When true, cards render read-only (non-host view). */
  disabled?: boolean
  /** Optional accessible label for the radio group. */
  label?: string
}

/**
 * Build a compact CSS background for a card from a theme's environment so the
 * swatch reads as that theme's table look.
 */
function cardBackground(theme: Theme): string {
  const bg = theme.environment.background
  if (bg.gradient) {
    const dir =
      bg.gradient.direction === 'horizontal'
        ? 'to right'
        : bg.gradient.direction === 'radial'
          ? 'circle at 30% 20%'
          : 'to bottom'
    const prefix = bg.gradient.direction === 'radial' ? 'radial-gradient' : 'linear-gradient'
    return `${prefix}(${dir}, ${bg.gradient.from}, ${bg.gradient.to})`
  }
  return bg.color
}

function ThemeCard({
  theme,
  selected,
  disabled,
  onSelect,
}: {
  theme: Theme | null
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const name = theme ? theme.name : "Each player's own"
  const testId = theme ? `room-theme-card-${theme.id}` : 'room-theme-card-none'

  // Swatches: for a real theme, pull identity colors from its tokens; for the
  // "none" option, show a neutral placeholder strip.
  const swatches = theme
    ? [
        theme.tokens.colors.primary,
        theme.tokens.colors.accent,
        theme.environment.floor.color,
      ]
    : ['#6b7280', '#9ca3af', '#4b5563']

  const preview = theme
    ? { background: cardBackground(theme) }
    : {
        background:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 6px, rgba(255,255,255,0.02) 6px 12px)',
      }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      data-testid={testId}
      disabled={disabled}
      onClick={onSelect}
      className="flex flex-col overflow-hidden rounded-lg text-left transition-all"
      style={{
        border: selected
          ? '2px solid var(--color-accent, #f98797)'
          : '1px solid rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(255,255,255,0.04)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !selected ? 0.55 : 1,
      }}
    >
      {/* Mini preview strip built from theme identity */}
      <div
        className="relative h-10 w-full"
        style={preview}
        aria-hidden="true"
      >
        <div className="absolute bottom-1 left-1 flex gap-1">
          {swatches.map((color, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: '10px',
                height: '10px',
                backgroundColor: color,
                border: '1px solid rgba(0,0,0,0.35)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
              }}
            />
          ))}
        </div>
        {selected && (
          <span
            className="absolute top-1 right-1 flex items-center justify-center rounded-full text-[10px]"
            style={{
              width: '16px',
              height: '16px',
              backgroundColor: 'var(--color-accent, #f98797)',
              color: '#fff',
            }}
            aria-hidden="true"
          >
            ✓
          </span>
        )}
      </div>
      <span
        className="truncate px-2 py-1.5 text-xs font-medium"
        style={{ color: 'var(--color-text-primary, #fff)' }}
      >
        {name}
      </span>
    </button>
  )
}

export function RoomThemePicker({
  value,
  onChange,
  disabled = false,
  label = 'Room theme',
}: RoomThemePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid="room-theme-picker"
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}
    >
      <ThemeCard
        theme={null}
        selected={value === null}
        disabled={disabled}
        onSelect={() => !disabled && onChange(null)}
      />
      {THEME_REGISTRY.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={value === theme.id}
          disabled={disabled}
          onSelect={() => !disabled && onChange(theme.id)}
        />
      ))}
    </div>
  )
}
