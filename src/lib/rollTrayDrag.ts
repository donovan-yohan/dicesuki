export const ROLL_TRAY_DIE_DRAG_TYPE = 'application/x-dicesuki-roll-tray-die'

export function serializeRollTrayDieDragPayload(dieId: string) {
  return JSON.stringify({ dieId })
}

export function parseRollTrayDieDragPayload(dataTransfer: DataTransfer): string | null {
  const rawPayload = dataTransfer.getData(ROLL_TRAY_DIE_DRAG_TYPE)
  if (!rawPayload) return null

  try {
    const parsed = JSON.parse(rawPayload) as Partial<{ dieId: unknown }>
    return typeof parsed.dieId === 'string' && parsed.dieId.length > 0
      ? parsed.dieId
      : null
  } catch {
    return null
  }
}
