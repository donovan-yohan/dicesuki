/**
 * Canonical room links + sharing helpers (issue #77).
 *
 * A room's canonical URL is `${origin}/room/${roomId}`, matching the
 * `/room/:roomId` route in `src/App.tsx`. When the room is running against the
 * local loopback server we preserve `?server=local` so a copied link keeps
 * pointing at the same server; the public server needs no query string.
 */

export interface BuildRoomUrlOptions {
  /** Origin to build against. Defaults to `window.location.origin`. */
  origin?: string
  /** When true, append `?server=local` so the link targets the loopback server. */
  local?: boolean
}

/**
 * Build the canonical, shareable URL for a room.
 *
 * @throws if `roomId` is empty — a link without a room is never valid.
 */
export function buildRoomUrl(roomId: string, options: BuildRoomUrlOptions = {}): string {
  const trimmed = roomId?.trim()
  if (!trimmed) {
    throw new Error('buildRoomUrl requires a non-empty roomId')
  }
  const origin =
    options.origin ??
    (typeof window !== 'undefined' ? window.location.origin : '')
  const base = `${origin.replace(/\/$/, '')}/room/${encodeURIComponent(trimmed)}`
  return options.local ? `${base}?server=local` : base
}

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'error'

/**
 * Copy `text` to the clipboard. Prefers the async Clipboard API and falls back
 * to a hidden `<textarea>` + `execCommand('copy')` for browsers/contexts where
 * `navigator.clipboard` is unavailable (older mobile, non-secure origins).
 *
 * @returns true when the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }

  if (typeof document === 'undefined') return false

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // Keep it out of view and non-interactive but still selectable.
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export interface ShareRoomLinkPayload {
  url: string
  title?: string
  text?: string
}

/**
 * Share a room link via the native Web Share sheet when supported, otherwise
 * fall back to copying the link to the clipboard.
 *
 * @returns
 *  - `'shared'`   — the native share sheet completed.
 *  - `'copied'`   — Web Share unsupported (or unavailable); link was copied.
 *  - `'dismissed'`— the user cancelled the native share sheet (AbortError).
 *  - `'error'`    — sharing failed and the clipboard fallback also failed.
 */
export async function shareRoomLink(payload: ShareRoomLinkPayload): Promise<ShareOutcome> {
  const { url, title, text } = payload

  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  if (canShare) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (err) {
      // The user cancelling the sheet throws AbortError — that's not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'dismissed'
      }
      // Any other failure: fall back to copy so the user still gets the link.
    }
  }

  const copied = await copyToClipboard(url)
  return copied ? 'copied' : 'error'
}
