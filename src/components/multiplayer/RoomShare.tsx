import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useTheme } from '../../contexts/ThemeContext'
import { buildRoomUrl, copyToClipboard, shareRoomLink } from '../../lib/roomLinks'
import { QrCode } from './QrCode'

/**
 * In-room sharing controls (issue #77): copy the canonical link, open the native
 * share sheet (with a copy fallback), and reveal a QR code sized for in-person
 * table play. Rendered inside the player roster panel.
 */
export function RoomShare() {
  const roomId = useMultiplayerStore((s) => s.roomId)
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors

  const [showQr, setShowQr] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const roomUrl = useMemo(
    () => (roomId ? buildRoomUrl(roomId) : null),
    [roomId],
  )

  const flash = useCallback((message: string) => {
    setFeedback(message)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2000)
  }, [])

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
  }, [])

  const handleCopy = useCallback(async () => {
    if (!roomUrl) return
    const ok = await copyToClipboard(roomUrl)
    flash(ok ? 'Link copied!' : 'Copy failed — long-press the link')
  }, [roomUrl, flash])

  const handleShare = useCallback(async () => {
    if (!roomUrl) return
    const outcome = await shareRoomLink({
      url: roomUrl,
      title: 'Join my dice room',
      text: 'Roll some dice with me on Dicesuki',
    })
    if (outcome === 'copied') flash('Link copied!')
    else if (outcome === 'error') flash('Sharing failed')
  }, [roomUrl, flash])

  if (!roomId || !roomUrl) return null

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const buttonBase: React.CSSProperties = {
    flex: 1,
    padding: '0.4rem 0.5rem',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.08)',
    color: colors.text.primary,
    fontSize: '0.8rem',
    cursor: 'pointer',
  }

  return (
    <div
      data-testid="room-share"
      className="flex flex-col gap-2 px-3 py-2"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <button type="button" onClick={handleCopy} style={buttonBase} data-testid="room-share-copy">
          Copy link
        </button>
        <button
          type="button"
          onClick={handleShare}
          style={buttonBase}
          data-testid="room-share-share"
        >
          {canNativeShare ? 'Share' : 'Copy to share'}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowQr((v) => !v)}
        aria-expanded={showQr}
        style={{ ...buttonBase, flex: 'unset' }}
        data-testid="room-share-qr-toggle"
      >
        {showQr ? 'Hide QR code' : 'Show QR code'}
      </button>

      {showQr && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '0.5rem',
            background: '#ffffff',
            borderRadius: '10px',
          }}
        >
          <QrCode value={roomUrl} size={188} />
        </div>
      )}

      <div
        aria-live="polite"
        role="status"
        style={{
          minHeight: '1rem',
          fontSize: '0.72rem',
          color: colors.text.secondary,
          textAlign: 'center',
        }}
      >
        {feedback}
      </div>
    </div>
  )
}
