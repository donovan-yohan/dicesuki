import qrcode from 'qrcode-generator'

/**
 * QR code generation (issue #77), wrapping `qrcode-generator` behind a single
 * module so the rest of the app depends on a plain matrix, not the library API.
 *
 * We use a battle-tested, zero-dependency encoder rather than hand-rolling a
 * spec-compliant one: the acceptance criterion is a *scannable* QR, and a subtly
 * incorrect hand-written encoder cannot be verified without a physical scan.
 */

export interface QrMatrix {
  /** Number of modules per side (the QR is `size x size`). */
  size: number
  /** Row-major grid; `modules[row][col] === true` means a dark module. */
  modules: boolean[][]
}

/** Error-correction level. `M` (~15%) balances density and scan resilience for links. */
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

/**
 * Encode `data` into a boolean module matrix. Type number `0` lets the encoder
 * pick the smallest version that fits the data at the given EC level.
 *
 * @throws if `data` is empty — there is nothing to encode.
 */
export function generateQrMatrix(
  data: string,
  errorCorrection: QrErrorCorrection = 'M',
): QrMatrix {
  if (!data) {
    throw new Error('generateQrMatrix requires non-empty data')
  }
  const qr = qrcode(0, errorCorrection)
  qr.addData(data)
  qr.make()

  const size = qr.getModuleCount()
  const modules: boolean[][] = []
  for (let row = 0; row < size; row++) {
    const cols: boolean[] = []
    for (let col = 0; col < size; col++) {
      cols.push(qr.isDark(row, col))
    }
    modules.push(cols)
  }
  return { size, modules }
}
