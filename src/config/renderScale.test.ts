import { afterEach, describe, expect, it } from 'vitest'

import {
  DICE_PIXELS_PER_UNIT,
  MOBILE_DICE_PIXELS_PER_UNIT,
  resolvePixelsPerUnit,
} from './renderScale'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

describe('resolvePixelsPerUnit device scale', () => {
  // Restore the jsdom default (desktop-sized) after each case.
  afterEach(() => setViewport(1024, 768))

  it('uses the desktop scale on wide viewports', () => {
    setViewport(1440, 900)
    expect(resolvePixelsPerUnit()).toBe(DICE_PIXELS_PER_UNIT)
  })

  it('uses the smaller mobile scale on a portrait phone', () => {
    setViewport(390, 844)
    expect(resolvePixelsPerUnit()).toBe(MOBILE_DICE_PIXELS_PER_UNIT)
  })

  it('keys off the short side, so a landscape phone is still mobile', () => {
    setViewport(844, 390)
    expect(resolvePixelsPerUnit()).toBe(MOBILE_DICE_PIXELS_PER_UNIT)
  })

  it('keeps a tablet on the desktop scale (short side > threshold)', () => {
    setViewport(820, 1180)
    expect(resolvePixelsPerUnit()).toBe(DICE_PIXELS_PER_UNIT)
  })
})
