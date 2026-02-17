import { motion, AnimatePresence } from 'framer-motion'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { shouldReduceMotion } from '../../animations/ui-transitions'

interface PlayerPanelProps {
  isOpen: boolean
}

export function PlayerPanel({ isOpen }: PlayerPanelProps) {
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const selectedPlayerId = useMultiplayerStore((s) => s.selectedPlayerId)
  const setSelectedPlayerId = useMultiplayerStore((s) => s.setSelectedPlayerId)
  const roomId = useMultiplayerStore((s) => s.roomId)
  const reduceMotion = shouldReduceMotion()

  const playersArray = Array.from(players.values())

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed z-30 flex flex-col gap-3 items-end"
          style={{ top: '208px', right: '16px' }}
        >
          {/* Room ID label */}
          <motion.div
            className="text-xs font-mono px-2 py-1 rounded"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(8px)',
              color: 'rgba(255, 255, 255, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
            initial={!reduceMotion ? { x: 100, opacity: 0 } : { opacity: 0 }}
            animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
            exit={!reduceMotion ? { x: 100, opacity: 0 } : { opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {roomId}
          </motion.div>

          {/* Player avatars */}
          {playersArray.map((player, index) => {
            const isLocal = player.id === localPlayerId
            const isSelected = player.id === selectedPlayerId

            return (
              <motion.button
                key={player.id}
                onClick={() => setSelectedPlayerId(player.id)}
                className="flex items-center justify-center rounded-full font-bold text-sm"
                style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: player.color,
                  color: 'white',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  border: isSelected
                    ? '3px solid white'
                    : isLocal
                    ? '2px solid rgba(255,255,255,0.5)'
                    : '2px solid transparent',
                  cursor: 'pointer',
                  boxShadow: isSelected
                    ? '0 0 12px rgba(255,255,255,0.3)'
                    : '0 2px 8px rgba(0,0,0,0.3)',
                }}
                initial={!reduceMotion ? { x: 100, opacity: 0 } : { opacity: 0 }}
                animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
                exit={!reduceMotion ? { x: 100, opacity: 0 } : { opacity: 0 }}
                transition={{
                  duration: 0.3,
                  delay: (index + 1) * 0.05,
                  ease: 'easeOut',
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                title={player.displayName + (isLocal ? ' (You)' : '')}
                aria-label={`Filter by ${player.displayName}`}
              >
                {player.displayName.charAt(0).toUpperCase()}
              </motion.button>
            )
          })}
        </div>
      )}
    </AnimatePresence>
  )
}
