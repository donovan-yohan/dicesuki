import { useMemo } from 'react'
import { generateQrMatrix, type QrErrorCorrection } from '../../lib/qrCode'

interface QrCodeProps {
  /** The value to encode (e.g. a canonical room URL). */
  value: string
  /** Rendered pixel size of the square QR (including the quiet-zone margin). */
  size?: number
  /** Dark module color. Defaults to black for maximum scan contrast. */
  foreground?: string
  /** Light module / background color. Defaults to white. */
  background?: string
  /** Quiet-zone width in modules. The spec recommends 4; keep >= 2 to stay scannable. */
  margin?: number
  errorCorrection?: QrErrorCorrection
  'data-testid'?: string
}

/**
 * Renders a scannable QR code as crisp, resolution-independent SVG (issue #77).
 *
 * SVG is chosen over `<img>`/canvas so the code stays sharp when scaled up for
 * in-person table play and can inherit theme colors without rasterization.
 * We keep the quiet zone white regardless of theme — a colored margin hurts
 * scan reliability.
 */
export function QrCode({
  value,
  size = 200,
  foreground = '#000000',
  background = '#ffffff',
  margin = 4,
  errorCorrection = 'M',
  'data-testid': dataTestId = 'room-qr',
}: QrCodeProps) {
  const matrix = useMemo(
    () => generateQrMatrix(value, errorCorrection),
    [value, errorCorrection],
  )

  const total = matrix.size + margin * 2

  // Build a single path string for all dark modules — one DOM node, fast render.
  const path = useMemo(() => {
    let d = ''
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        if (matrix.modules[row][col]) {
          const x = col + margin
          const y = row + margin
          d += `M${x} ${y}h1v1h-1z`
        }
      }
    }
    return d
  }, [matrix, margin])

  return (
    <svg
      data-testid={dataTestId}
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${value}`}
      style={{ display: 'block', borderRadius: '8px' }}
    >
      <rect width={total} height={total} fill={background} />
      <path d={path} fill={foreground} />
    </svg>
  )
}
