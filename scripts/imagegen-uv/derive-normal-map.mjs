#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const DEFAULT_INPUT = path.resolve('public/artist-resources/imagegen-uv/d20-imagegen/antique-gold-blue-enamel-imagegen-v2-edge-aligned.png')
const DEFAULT_OUTPUT = path.resolve('public/artist-resources/imagegen-uv/d20-imagegen/antique-gold-blue-enamel-normal-v2-edge-aligned.png')

const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(args.input ?? DEFAULT_INPUT)
const outputPath = path.resolve(args.output ?? DEFAULT_OUTPUT)

await deriveNormalMap(inputPath, outputPath)
console.log(`Derived embossed trim/numeral normal map at ${path.relative(process.cwd(), outputPath)}`)

export async function deriveNormalMap(sourcePath, destinationPath) {
  const source = await readFile(sourcePath)
  const dataUrl = `data:image/png;base64,${source.toString('base64')}`
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    const encoded = await page.evaluate(async (sourceUrl) => {
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
      softenedContext.filter = 'blur(1.2px)'
      softenedContext.drawImage(sourceCanvas, 0, 0)

      const pixels = softenedContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
      const width = pixels.width
      const height = pixels.height
      const heights = new Float32Array(width * height)

      for (let index = 0; index < heights.length; index++) {
        const offset = index * 4
        const red = pixels.data[offset] / 255
        const green = pixels.data[offset + 1] / 255
        const blue = pixels.data[offset + 2] / 255
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114
        const gold = Math.max(0, red * 0.72 + green * 0.48 - blue * 0.54)
        heights[index] = Math.min(1, luminance * 0.18 + gold * 0.9)
      }

      const normalCanvas = document.createElement('canvas')
      normalCanvas.width = width
      normalCanvas.height = height
      const normalContext = normalCanvas.getContext('2d')
      if (!normalContext) throw new Error('Unable to create normal canvas context')
      const normals = normalContext.createImageData(width, height)
      const sample = (x, y) => heights[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
      const strength = 7.5

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = (sample(x + 1, y - 1) + sample(x + 1, y) * 2 + sample(x + 1, y + 1))
            - (sample(x - 1, y - 1) + sample(x - 1, y) * 2 + sample(x - 1, y + 1))
          const dy = (sample(x - 1, y + 1) + sample(x, y + 1) * 2 + sample(x + 1, y + 1))
            - (sample(x - 1, y - 1) + sample(x, y - 1) * 2 + sample(x + 1, y - 1))
          const nx = -dx * strength
          const ny = -dy * strength
          const nz = 1
          const length = Math.hypot(nx, ny, nz)
          const offset = (y * width + x) * 4
          normals.data[offset] = Math.round((nx / length * 0.5 + 0.5) * 255)
          normals.data[offset + 1] = Math.round((ny / length * 0.5 + 0.5) * 255)
          normals.data[offset + 2] = Math.round((nz / length * 0.5 + 0.5) * 255)
          normals.data[offset + 3] = 255
        }
      }

      normalContext.putImageData(normals, 0, 0)
      return normalCanvas.toDataURL('image/png').split(',')[1]
    }, dataUrl)

    await writeFile(destinationPath, Buffer.from(encoded, 'base64'))
  } finally {
    await browser.close()
  }
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index++) {
    const key = values[index]
    if (!key.startsWith('--')) continue
    parsed[key.slice(2)] = values[index + 1]
    index++
  }
  return parsed
}
