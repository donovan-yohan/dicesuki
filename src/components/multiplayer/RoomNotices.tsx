import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../../contexts/ThemeContext'
import { shouldReduceMotion } from '../../animations/ui-transitions'
import { useRoomPresenceNotices } from '../../hooks/useRoomPresenceNotices'
import { useRoomMotionNotices } from '../../hooks/useRoomMotionNotices'
import { useRoomRollerNotices } from '../../hooks/useRoomRollerNotices'

const NOTICE_STYLE = {
  padding: '0.4rem 0.85rem',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  cursor: 'pointer',
} as const

/**
 * Transient in-room notices, anchored top-center: join/leave presence changes
 * and host-driven motion-mode changes. Driven entirely by the multiplayer store.
 */
export function RoomNotices() {
  const { notices, dismiss } = useRoomPresenceNotices()
  const { notices: motionNotices, dismiss: dismissMotion } = useRoomMotionNotices()
  const { notices: rollerNotices, dismiss: dismissRoller } = useRoomRollerNotices()
  const { currentTheme } = useTheme()
  const reduceMotion = shouldReduceMotion()
  const colors = currentTheme.tokens.colors

  const enter = !reduceMotion ? { y: -20, opacity: 0 } : { opacity: 0 }
  const shown = !reduceMotion ? { y: 0, opacity: 1 } : { opacity: 1 }

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
            style={{ ...NOTICE_STYLE, color: colors.text.primary }}
            initial={enter}
            animate={shown}
            exit={enter}
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
              {{
                join: 'joined',
                leave: 'left',
                disconnect: 'disconnected',
                reconnect: 'reconnected',
              }[notice.kind]}
            </span>
          </motion.button>
        ))}
        {motionNotices.map((notice) => (
          <motion.button
            key={notice.id}
            type="button"
            onClick={() => dismissMotion(notice.id)}
            className="pointer-events-auto flex items-center gap-2 rounded-full text-sm font-medium"
            style={{ ...NOTICE_STYLE, color: colors.text.primary }}
            data-testid="motion-notice"
            initial={enter}
            animate={shown}
            exit={enter}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <span aria-hidden>🎲</span>
            <span>{notice.message}</span>
          </motion.button>
        ))}
        {rollerNotices.map((notice) => (
          <motion.button
            key={notice.id}
            type="button"
            onClick={() => dismissRoller(notice.id)}
            className="pointer-events-auto flex items-center gap-2 rounded-full text-sm font-medium"
            style={{ ...NOTICE_STYLE, color: colors.text.primary }}
            data-testid="roller-notice"
            initial={enter}
            animate={shown}
            exit={enter}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <span aria-hidden>🖐️</span>
            <span>{notice.message}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
