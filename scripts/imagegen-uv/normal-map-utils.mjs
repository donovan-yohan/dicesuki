/**
 * Tangent-space normal-map derivation from an authored albedo image.
 *
 * Resurrected unchanged (apart from doc comments) from commit
 * 7393d112c5e062570ec7caf37970206c4d05c08c. Runs the Sobel pass inside a
 * headless Chromium canvas because the workshop already depends on Playwright
 * for rasterization and atlas registration, and canvas `filter: blur()` gives
 * the exact softening the released sets were derived with.
 *
 * Profiles:
 * - `ornament` — for dice atlases. Weights warm metal trim and cool emissive
 *   channels far above raw luminance so raised gilding and engraved numerals
 *   drive relief instead of flat colour changes.
 * - `surface`  — for tileable environment textures. Mostly luminance with a
 *   small chroma contribution.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const NORMAL_MAP_DEFAULTS = Object.freeze({
  profile: 'surface',
  strength: 6,
  blur: 1.1,
  invert: false,
  tileable: false,
})

export async function deriveNormalMaps(entries) {
  if (entries.length === 0) return []
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const written = []
  try {
    const page = await browser.newPage()
    for (const entry of entries) {
      const source = await readFile(path.resolve(entry.inputPath))
      const encoded = await page.evaluate(deriveNormalMapInPage, {
        sourceUrl: `data:image/png;base64,${source.toString('base64')}`,
        // Ship the height weighting into the page instead of duplicating it, so
        // the unit-tested `heightForPixel` is the only definition that exists.
        heightForPixelSource: heightForPixel.toString(),
        options: {
          profile: entry.profile ?? NORMAL_MAP_DEFAULTS.profile,
          strength: entry.strength ?? NORMAL_MAP_DEFAULTS.strength,
          blur: entry.blur ?? NORMAL_MAP_DEFAULTS.blur,
          invert: entry.invert ?? NORMAL_MAP_DEFAULTS.invert,
          tileable: entry.tileable ?? NORMAL_MAP_DEFAULTS.tileable,
        },
      })
      const outputPath = path.resolve(entry.outputPath)
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, Buffer.from(encoded, 'base64'))
      written.push(outputPath)
    }
  } finally {
    await browser.close()
  }
  return written
}

/**
 * Height-field weighting for one pixel, with `red`/`green`/`blue` in [0, 1].
 *
 * This is the single definition: `deriveNormalMaps` serializes it into the
 * Chromium page rather than keeping a second copy there, so unit tests over
 * this function cover the real derivation.
 */
export function heightForPixel({ red, green, blue }, profile) {
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114
  if (profile === 'ornament') {
    const warmMetal = Math.max(0, red * 0.72 + green * 0.48 - blue * 0.54)
    const coolEmission = Math.max(0, blue * 0.64 + green * 0.42 - red * 0.34)
    return Math.min(1, luminance * 0.2 + Math.max(warmMetal, coolEmission) * 0.88)
  }
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
  return Math.min(1, luminance * 0.82 + chroma * 0.18)
}

async function deriveNormalMapInPage({ sourceUrl, options, heightForPixelSource }) {
  const heightForPixel = new Function(`return (${heightForPixelSource})`)()
  const image = new Image()
  image.src = sourceUrl
  await image.decode()

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth
  sourceCanvas.height = image.naturalHeight
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceContext) throw new Error('Unable to create source canvas context')
  sourceContext.drawImage(image, 0, 0)

  const softenedCanvas = document.createElement('canvas')
  softenedCanvas.width = image.naturalWidth
  softenedCanvas.height = image.naturalHeight
  const softenedContext = softenedCanvas.getContext('2d', { willReadFrequently: true })
  if (!softenedContext) throw new Error('Unable to create softened canvas context')
  softenedContext.filter = `blur(${options.blur}px)`
  softenedContext.drawImage(sourceCanvas, 0, 0)

  const pixels = softenedContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
  const width = pixels.width
  const height = pixels.height
  const heights = new Float32Array(width * height)

  for (let index = 0; index < heights.length; index += 1) {
    const offset = index * 4
    heights[index] = heightForPixel({
      red: pixels.data[offset] / 255,
      green: pixels.data[offset + 1] / 255,
      blue: pixels.data[offset + 2] / 255,
    }, options.profile)
    if (options.invert) heights[index] = 1 - heights[index]
  }

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width
  outputCanvas.height = height
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) throw new Error('Unable to create output canvas context')
  const normals = outputContext.createImageData(width, height)
  const sample = (x, y) => {
    if (options.tileable) {
      const wrappedX = (x % width + width) % width
      const wrappedY = (y % height + height) % height
      return heights[wrappedY * width + wrappedX]
    }
    const clampedX = Math.min(width - 1, Math.max(0, x))
    const clampedY = Math.min(height - 1, Math.max(0, y))
    return heights[clampedY * width + clampedX]
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (sample(x + 1, y - 1) + sample(x + 1, y) * 2 + sample(x + 1, y + 1))
        - (sample(x - 1, y - 1) + sample(x - 1, y) * 2 + sample(x - 1, y + 1))
      const dy = (sample(x - 1, y + 1) + sample(x, y + 1) * 2 + sample(x + 1, y + 1))
        - (sample(x - 1, y - 1) + sample(x, y - 1) * 2 + sample(x + 1, y - 1))
      const nx = -dx * options.strength
      const ny = -dy * options.strength
      const nz = 1
      const length = Math.hypot(nx, ny, nz)
      const offset = (y * width + x) * 4
      normals.data[offset] = Math.round((nx / length * 0.5 + 0.5) * 255)
      normals.data[offset + 1] = Math.round((ny / length * 0.5 + 0.5) * 255)
      normals.data[offset + 2] = Math.round((nz / length * 0.5 + 0.5) * 255)
      normals.data[offset + 3] = 255
    }
  }

  outputContext.putImageData(normals, 0, 0)
  return outputCanvas.toDataURL('image/png').split(',')[1]
}
