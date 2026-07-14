import { useEngineConfig } from '../../config/engineConfig'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useTheme } from '../../contexts/ThemeContext'
import {
  ARENA_PRESETS,
  activeArenaPreset,
  windowAspect,
  type ArenaPresetId,
} from '../../lib/arenaPresets'

interface RoomSizeControlProps {
  /** Non-host view: show the current size read-only (Shared-ADR-009 host-only). */
  disabled?: boolean
  /** Offer a "Fit window" button (solo / host-window preset). */
  showAuto?: boolean
}

/**
 * Host control for the shared arena shape (Shared-ADR-009). Presets map to
 * area-preserving aspects; the server resizes the one shared, server-authoritative
 * arena and broadcasts the new bounds to everyone. The active preset is derived
 * from the room's current bounds so it stays in sync across clients.
 */
export function RoomSizeControl({ disabled = false, showAuto = false }: RoomSizeControlProps) {
  const engineConfig = useEngineConfig()
  const setArena = useMultiplayerStore((s) => s.setArena)
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors
  const active: ArenaPresetId | null = engineConfig
    ? activeArenaPreset(engineConfig.arenaHalfX, engineConfig.arenaHalfZ)
    : null

  return (
    <div className="flex flex-col gap-1.5" data-testid="room-size-control">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold uppercase"
          style={{ letterSpacing: '0.06em', color: colors.text.secondary }}
        >
          Room Size
        </span>
        {disabled && (
          <span className="text-xs" style={{ color: colors.text.muted }}>
            Host controls
          </span>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Room size"
        className="flex rounded-lg overflow-hidden"
        style={{ border: '1px solid rgba(255,255,255,0.12)' }}
      >
        {ARENA_PRESETS.map((preset, index) => {
          const isActive = preset.id === active
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              onClick={() => !disabled && setArena(preset.aspect)}
              data-testid={`arena-preset-${preset.id}`}
              title={preset.label}
              className="flex-1 px-1.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: isActive ? 'rgba(139, 92, 246, 0.55)' : 'transparent',
                color: isActive ? '#fff' : colors.text.secondary,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled && !isActive ? 0.5 : 1,
                borderLeft: index > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none',
              }}
            >
              {preset.id}
            </button>
          )
        })}
      </div>

      {showAuto && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setArena(windowAspect())}
          data-testid="arena-preset-fit"
          className="rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
          style={{
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: colors.text.secondary,
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          Fit my window
        </button>
      )}

      <span className="text-xs" style={{ color: colors.text.muted, lineHeight: 1.35 }}>
        {showAuto
          ? 'Shape the table to your screen or a fixed ratio.'
          : 'Shared table shape — everyone in the room sees it.'}
      </span>
    </div>
  )
}
