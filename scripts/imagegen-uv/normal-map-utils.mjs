import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

export async function deriveNormalMaps(entries) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    for (const entry of entries) {
      const source = await readFile(path.resolve(entry.inputPath))
      const dataUrl = `data:image/png;base64,${source.toString('base64')}`
      const encoded = await page.evaluate(async ({ sourceUrl, options }) => {
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
          const red = pixels.data[offset] / 255
          const green = pixels.data[offset + 1] / 255
          const blue = pixels.data[offset + 2] / 255
          const luminance = red * 0.299 + green * 0.587 + blue * 0.114
          if (options.profile === 'ornament') {
            const warmMetal = Math.max(0, red * 0.72 + green * 0.48 - blue * 0.54)
            const coolEmission = Math.max(0, blue * 0.64 + green * 0.42 - red * 0.34)
            heights[index] = Math.min(1, luminance * 0.2 + Math.max(warmMetal, coolEmission) * 0.88)
          } else {
            const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
            heights[index] = Math.min(1, luminance * 0.82 + chroma * 0.18)
          }
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
      }, {
        sourceUrl: dataUrl,
        options: {
          profile: entry.profile ?? 'surface',
          strength: entry.strength ?? 6,
          blur: entry.blur ?? 1.1,
          invert: entry.invert ?? false,
          tileable: entry.tileable ?? false,
        },
      })

      await mkdir(path.dirname(path.resolve(entry.outputPath)), { recursive: true })
      await writeFile(path.resolve(entry.outputPath), Buffer.from(encoded, 'base64'))
    }
  } finally {
    await browser.close()
  }
}
