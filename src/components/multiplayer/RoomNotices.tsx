import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../../contexts/ThemeContext'
import { shouldReduceMotion } from '../../animations/ui-transitions'
import { useRoomPresenceNotices } from '../../hooks/useRoomPresenceNotices'

/**
 * Transient join/leave notices for the multiplayer room, anchored top-center.
 * Driven entirely by roster changes in the multiplayer store.
 */
export function RoomNotices() {
  const { notices, dismiss } = useRoomPresenceNotices()
  const { currentTheme } = useTheme()
  const reduceMotion = shouldReduceMotion()
  const colors = currentTheme.tokens.colors

  return (
    <div
      className="fixed z-40 flex flex-col items-center gap-2 pointer-events-none"
      style={{ top: '16px', left: '50%', transform: 'translateX(-50%)' }}
      aria-live="polite"
      data-testid="room-notices"
    >
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.button
            key={notice.id}
            type="button"
            onClick={() => dismiss(notice.id)}
            className="pointer-events-auto flex items-center gap-2 rounded-full text-sm font-medium"
            style={{
              padding: '0.4rem 0.85rem',
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: colors.text.primary,
              cursor: 'pointer',
            }}
            initial={!reduceMotion ? { y: -20, opacity: 0 } : { opacity: 0 }}
            animate={!reduceMotion ? { y: 0, opacity: 1 } : { opacity: 1 }}
            exit={!reduceMotion ? { y: -20, opacity: 0 } : { opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <span
              aria-hidden
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: notice.color,
                flexShrink: 0,
                boxShadow: '0 0 6px rgba(0,0,0,0.4)',
              }}
            />
            <span>
              <strong>{notice.displayName}</strong>{' '}
              {notice.kind === 'join' ? 'joined' : 'left'}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
