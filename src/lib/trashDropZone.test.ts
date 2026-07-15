import { afterEach, describe, expect, it } from 'vitest'

import { isOverTrashZone, TRASH_DROP_ZONE_ID } from './trashDropZone'

/**
 * Mount a stub trash-zone element whose bounds are fixed to the given rect, so
 * hit-testing is deterministic under jsdom (which returns all-zero rects).
 */
function mountTrashZone(rect: { left: number; top: number; right: number; bottom: number }) {
  const el = document.createElement('div')
  el.id = TRASH_DROP_ZONE_ID
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

describe('isOverTrashZone', () => {
  afterEach(() => {
    document.getElementById(TRASH_DROP_ZONE_ID)?.remove()
  })

  it('returns false when the trash zone is not mounted', () => {
    expect(isOverTrashZone(50, 50)).toBe(false)
  })

  it('returns true for a point inside the zone bounds', () => {
    mountTrashZone({ left: 10, top: 20, right: 60, bottom: 80 })

    expect(isOverTrashZone(30, 50)).toBe(true)
  })

  it('treats the edges as inside (inclusive bounds)', () => {
    mountTrashZone({ left: 10, top: 20, right: 60, bottom: 80 })

    expect(isOverTrashZone(10, 20)).toBe(true)
    expect(isOverTrashZone(60, 80)).toBe(true)
  })

  it('returns false for a point outside the zone bounds', () => {
    mountTrashZone({ left: 10, top: 20, right: 60, bottom: 80 })

    expect(isOverTrashZone(5, 50)).toBe(false) // left of zone
    expect(isOverTrashZone(65, 50)).toBe(false) // right of zone
    expect(isOverTrashZone(30, 10)).toBe(false) // above zone
    expect(isOverTrashZone(30, 90)).toBe(false) // below zone
  })
})
