#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  getThemeAtlasPaths,
  THEME_WORKSHOP,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'

const TEMPLATE_ROOT = path.resolve('public/artist-resources/imagegen-uv/theme-sets/templates')
const OUTPUT_BACKGROUND = [5, 7, 11]
const D20_BLEED_SCALE = 1.1
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) await registerThemeAtlases()

export async function registerThemeAtlases() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let registeredCount = 0

  try {
    for (const theme of THEME_WORKSHOP) {
      for (const shape of THEME_WORKSHOP_SHAPES) {
        const paths = getThemeAtlasPaths(theme.id, shape)
        const atlasPath = path.resolve(paths.atlas)
        const rawAtlasPath = atlasPath.replace(/-imagegen-atlas\.png$/, '-imagegen-atlas-raw.png')
        const manifestPath = path.join(TEMPLATE_ROOT, shape, `${shape}-mesh-uv-manifest.json`)
        await Promise.all([access(atlasPath), access(manifestPath)])
        try {
          await access(rawAtlasPath)
        } catch {
          await copyFile(atlasPath, rawAtlasPath)
        }

        const [source, manifestRaw] = await Promise.all([
          readFile(rawAtlasPath),
          readFile(manifestPath, 'utf8'),
        ])
        const { buffer } = await registerThemeAtlas(page, source, JSON.parse(manifestRaw))

        await mkdir(path.dirname(atlasPath), { recursive: true })
        await writeFile(atlasPath, buffer)
        registeredCount += 1
      }
    }
  } finally {
    await page.close()
    await browser.close()
  }

  console.log(`Registered and edge-bled ${registeredCount} Codex ImageGen UV atlases; raw outputs remain beside the runtime atlases`)
}

export async function registerThemeAtlas(page, source, manifest) {
  const result = await page.evaluate(async ({ sourceUrl, manifest, outputBackground, d20BleedScale }) => {
    const image = new Image()
    image.src = sourceUrl
    await image.decode()
    const width = image.naturalWidth
    const height = image.naturalHeight

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = width
    sourceCanvas.height = height
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) throw new Error('Unable to create source atlas context')
    sourceContext.drawImage(image, 0, 0)
    const pixels = sourceContext.getImageData(0, 0, width, height).data

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = width
    outputCanvas.height = height
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true })
    if (!outputContext) throw new Error('Unable to create registered atlas context')
    outputContext.fillStyle = `rgb(${outputBackground.join(',')})`
    outputContext.fillRect(0, 0, width, height)
    outputContext.imageSmoothingEnabled = true
    outputContext.imageSmoothingQuality = 'high'

    const d20Registrations = []
    const report = []

    manifest.islands.forEach((island, atlasIndex) => {
      const column = atlasIndex % manifest.columns
      const row = Math.floor(atlasIndex / manifest.columns)
      const cell = {
        minX: Math.floor(column * width / manifest.columns),
        maxX: Math.ceil((column + 1) * width / manifest.columns),
        minY: Math.floor(row * height / manifest.rows),
        maxY: Math.ceil((row + 1) * height / manifest.rows),
      }
      const targetPoints = island.points.map((point) => ({
        x: point.x / manifest.canvasSize * width,
        y: point.y / manifest.canvasSize * height,
      }))
      const targetCenter = {
        x: island.center.x / manifest.canvasSize * width,
        y: island.center.y / manifest.canvasSize * height,
      }

      if (manifest.shape === 'd20') {
        if (targetPoints.length !== 3) throw new Error(`D20 face ${island.faceValue} must have exactly three atlas points`)
        const detection = findSourceTriangle(pixels, width, height, cell, targetPoints, targetCenter)
        const bleedPoints = scalePoints(targetPoints, targetCenter, d20BleedScale)
        const transform = affineTransform(detection.points, bleedPoints)
        if (signedArea(detection.points) * signedArea(bleedPoints) <= 0) {
          throw new Error(`D20 face ${island.faceValue} source orientation would be reflected`)
        }

        outputContext.save()
        polygonPath(outputContext, bleedPoints)
        outputContext.clip()
        outputContext.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f)
        outputContext.drawImage(sourceCanvas, 0, 0)
        outputContext.restore()

        const registration = {
          faceValue: island.faceValue,
          mode: 'triangle-affine',
          sourcePoints: detection.points.map(roundPoint),
          targetPoints: targetPoints.map(roundPoint),
          bleedPoints: bleedPoints.map(roundPoint),
          sourceComponentPixels: detection.componentPixels,
          foregroundThreshold: round(detection.threshold),
        }
        d20Registrations.push({ ...registration, targetCenter })
        report.push(registration)
        return
      }

      const sourceBounds = findForegroundBounds(pixels, width, height, cell)
      const bleedPoints = scalePoints(targetPoints, targetCenter, 1.065)
      const targetBounds = boundsForPoints(bleedPoints)

      outputContext.save()
      polygonPath(outputContext, bleedPoints)
      outputContext.clip()
      const overscanX = targetBounds.width * 0.025
      const overscanY = targetBounds.height * 0.025
      outputContext.drawImage(
        sourceCanvas,
        sourceBounds.minX,
        sourceBounds.minY,
        sourceBounds.width,
        sourceBounds.height,
        targetBounds.minX - overscanX,
        targetBounds.minY - overscanY,
        targetBounds.width + overscanX * 2,
        targetBounds.height + overscanY * 2,
      )
      outputContext.restore()
      report.push({ faceValue: island.faceValue, mode: 'bounds-to-polygon' })
    })

    if (manifest.shape === 'd20') {
      const outputPixels = outputContext.getImageData(0, 0, width, height).data
      for (const registration of d20Registrations) {
        const coverage = validateTriangleCoverage(
          outputPixels,
          width,
          height,
          registration.targetPoints,
          registration.bleedPoints,
          registration.targetCenter,
          outputBackground,
        )
        const reportEntry = report.find((entry) => entry.faceValue === registration.faceValue)
        reportEntry.coverage = coverage
        const failures = coverage.samples.filter((sample) => !sample.covered)
        if (failures.length > 0) {
          throw new Error(`D20 face ${registration.faceValue} lacks registered pixel coverage at ${failures.map((sample) => sample.label).join(', ')}`)
        }
      }
    }

    return {
      encoded: outputCanvas.toDataURL('image/png').split(',')[1],
      width,
      height,
      report,
    }

    function findSourceTriangle(data, imageWidth, imageHeight, cell, targetPoints, targetCenter) {
      const background = estimateCellBackground(data, imageWidth, cell)
      const borderDistances = background.samples
        .map((sample) => colorDistance(sample, background.color))
        .sort((first, second) => first - second)
      const threshold = Math.max(7, percentile(borderDistances, 0.95) * 3.5)
      const cellWidth = cell.maxX - cell.minX
      const cellHeight = cell.maxY - cell.minY
      const mask = new Uint8Array(cellWidth * cellHeight)

      for (let y = 0; y < cellHeight; y += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          const imageOffset = ((cell.minY + y) * imageWidth + cell.minX + x) * 4
          const color = [data[imageOffset], data[imageOffset + 1], data[imageOffset + 2]]
          if (colorDistance(color, background.color) >= threshold) mask[y * cellWidth + x] = 1
        }
      }

      const components = connectedComponents(mask, cellWidth, cellHeight, cell)
      const component = components.sort((first, second) => second.points.length - first.points.length)[0]
      const minimumPixels = Math.max(64, Math.floor(cellWidth * cellHeight * 0.02))
      if (!component || component.points.length < minimumPixels) {
        throw new Error(`Unable to isolate D20 source triangle in cell ${JSON.stringify(cell)}`)
      }

      const directions = targetPoints.map((point) => normalize({
        x: point.x - targetCenter.x,
        y: point.y - targetCenter.y,
      }))
      const supportCount = Math.max(4, Math.floor(component.points.length * 0.0015))
      const points = directions.map((direction) => {
        const support = [...component.points]
          .sort((first, second) => dot(second, direction) - dot(first, direction))
          .slice(0, supportCount)
        return {
          x: support.reduce((sum, point) => sum + point.x, 0) / support.length,
          y: support.reduce((sum, point) => sum + point.y, 0) / support.length,
        }
      })

      const area = Math.abs(signedArea(points))
      if (area < cellWidth * cellHeight * 0.08 || minimumPairDistance(points) < Math.min(cellWidth, cellHeight) * 0.2) {
        throw new Error(`Detected D20 source polygon is not a complete triangle in cell ${JSON.stringify(cell)}`)
      }
      return { points, componentPixels: component.points.length, threshold }
    }

    function estimateCellBackground(data, imageWidth, cell) {
      const samples = []
      const borderWidth = Math.max(4, Math.round(Math.min(cell.maxX - cell.minX, cell.maxY - cell.minY) * 0.035))
      for (let y = cell.minY; y < cell.maxY; y += 1) {
        for (let x = cell.minX; x < cell.maxX; x += 1) {
          if (Math.min(x - cell.minX, cell.maxX - 1 - x, y - cell.minY, cell.maxY - 1 - y) >= borderWidth) continue
          const offset = (y * imageWidth + x) * 4
          samples.push([data[offset], data[offset + 1], data[offset + 2]])
        }
      }
      return {
        color: [0, 1, 2].map((channel) => median(samples.map((sample) => sample[channel]))),
        samples,
      }
    }

    function connectedComponents(mask, width, height, cell) {
      const seen = new Uint8Array(mask.length)
      const components = []
      for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || seen[start]) continue
        const queue = [start]
        const points = []
        seen[start] = 1
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const current = queue[cursor]
          const x = current % width
          const y = Math.floor(current / width)
          points.push({ x: cell.minX + x, y: cell.minY + y })
          for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
            for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
              const neighborX = x + deltaX
              const neighborY = y + deltaY
              if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue
              const neighbor = neighborY * width + neighborX
              if (mask[neighbor] && !seen[neighbor]) {
                seen[neighbor] = 1
                queue.push(neighbor)
              }
            }
          }
        }
        components.push({ points })
      }
      return components
    }

    function validateTriangleCoverage(data, imageWidth, imageHeight, targetPoints, bleedPoints, center, background) {
      const samples = [{ label: 'center', point: center, radius: 2 }]
      targetPoints.forEach((point, index) => samples.push({ label: `uv-vertex-${index}`, point, radius: 2 }))
      targetPoints.forEach((start, index) => {
        const end = targetPoints[(index + 1) % targetPoints.length]
        const bleedStart = bleedPoints[index]
        const bleedEnd = bleedPoints[(index + 1) % bleedPoints.length]
        const midpoint = midpointOf(start, end)
        const bleedMidpoint = midpointOf(bleedStart, bleedEnd)
        const edge = { x: end.x - start.x, y: end.y - start.y }
        let normal = normalize({ x: -edge.y, y: edge.x })
        if (dot(normal, { x: midpoint.x - center.x, y: midpoint.y - center.y }) < 0) {
          normal = { x: -normal.x, y: -normal.y }
        }
        const bleedDistance = Math.hypot(bleedMidpoint.x - midpoint.x, bleedMidpoint.y - midpoint.y)
        const outsideDistance = Math.max(1, Math.min(3, bleedDistance * 0.45))
        samples.push({ label: `edge-${index}-midpoint`, point: midpoint, radius: 1 })
        samples.push({
          label: `edge-${index}-outside`,
          point: { x: midpoint.x + normal.x * outsideDistance, y: midpoint.y + normal.y * outsideDistance },
          radius: 1,
        })
      })

      return {
        samples: samples.map((sample) => {
          const contrast = neighborhoodContrast(data, imageWidth, imageHeight, sample.point, sample.radius, background)
          return { label: sample.label, x: round(sample.point.x), y: round(sample.point.y), contrast: round(contrast), covered: contrast >= 6 }
        }),
      }
    }

    function neighborhoodContrast(data, imageWidth, imageHeight, point, radius, background) {
      let contrast = 0
      const centerX = Math.round(point.x)
      const centerY = Math.round(point.y)
      for (let y = Math.max(0, centerY - radius); y <= Math.min(imageHeight - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(imageWidth - 1, centerX + radius); x += 1) {
          const offset = (y * imageWidth + x) * 4
          contrast = Math.max(contrast, colorDistance([data[offset], data[offset + 1], data[offset + 2]], background))
        }
      }
      return contrast
    }

    function affineTransform(source, target) {
      const [source0, source1, source2] = source
      const [target0, target1, target2] = target
      const denominator = source0.x * (source1.y - source2.y) + source1.x * (source2.y - source0.y) + source2.x * (source0.y - source1.y)
      if (Math.abs(denominator) < 1e-6) throw new Error('Cannot register a degenerate source triangle')
      return {
        a: (target0.x * (source1.y - source2.y) + target1.x * (source2.y - source0.y) + target2.x * (source0.y - source1.y)) / denominator,
        b: (target0.y * (source1.y - source2.y) + target1.y * (source2.y - source0.y) + target2.y * (source0.y - source1.y)) / denominator,
        c: (target0.x * (source2.x - source1.x) + target1.x * (source0.x - source2.x) + target2.x * (source1.x - source0.x)) / denominator,
        d: (target0.y * (source2.x - source1.x) + target1.y * (source0.x - source2.x) + target2.y * (source1.x - source0.x)) / denominator,
        e: (target0.x * (source1.x * source2.y - source2.x * source1.y) + target1.x * (source2.x * source0.y - source0.x * source2.y) + target2.x * (source0.x * source1.y - source1.x * source0.y)) / denominator,
        f: (target0.y * (source1.x * source2.y - source2.x * source1.y) + target1.y * (source2.x * source0.y - source0.x * source2.y) + target2.y * (source0.x * source1.y - source1.x * source0.y)) / denominator,
      }
    }

    function findForegroundBounds(data, imageWidth, imageHeight, cell) {
      let minX = cell.maxX
      let minY = cell.maxY
      let maxX = cell.minX
      let maxY = cell.minY
      let count = 0
      for (let y = cell.minY; y < cell.maxY; y += 1) {
        for (let x = cell.minX; x < cell.maxX; x += 1) {
          const offset = (y * imageWidth + x) * 4
          const red = data[offset]
          const green = data[offset + 1]
          const blue = data[offset + 2]
          const maximum = Math.max(red, green, blue)
          const luminance = red * 0.299 + green * 0.587 + blue * 0.114
          if (maximum < 42 || luminance < 28) continue
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
          count += 1
        }
      }
      if (count < 64) throw new Error(`Unable to locate UV island in cell ${JSON.stringify(cell)}`)
      return { minX, minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) }
    }

    function polygonPath(context, points) {
      context.beginPath()
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y)
        else context.lineTo(point.x, point.y)
      })
      context.closePath()
    }

    function scalePoints(points, center, scale) {
      return points.map((point) => ({ x: center.x + (point.x - center.x) * scale, y: center.y + (point.y - center.y) * scale }))
    }

    function boundsForPoints(points) {
      const minX = Math.min(...points.map((point) => point.x))
      const maxX = Math.max(...points.map((point) => point.x))
      const minY = Math.min(...points.map((point) => point.y))
      const maxY = Math.max(...points.map((point) => point.y))
      return { minX, minY, width: maxX - minX, height: maxY - minY }
    }

    function median(values) {
      const sorted = [...values].sort((first, second) => first - second)
      return sorted[Math.floor(sorted.length / 2)]
    }

    function percentile(sortedValues, ratio) {
      return sortedValues[Math.floor((sortedValues.length - 1) * ratio)]
    }

    function colorDistance(first, second) {
      return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])
    }

    function signedArea(points) {
      return points.reduce((area, point, index) => {
        const next = points[(index + 1) % points.length]
        return area + point.x * next.y - next.x * point.y
      }, 0) / 2
    }

    function minimumPairDistance(points) {
      let minimum = Infinity
      for (let first = 0; first < points.length; first += 1) {
        for (let second = first + 1; second < points.length; second += 1) {
          minimum = Math.min(minimum, Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y))
        }
      }
      return minimum
    }

    function normalize(vector) {
      const length = Math.hypot(vector.x, vector.y)
      if (length < 1e-6) throw new Error('Cannot normalize a zero-length registration vector')
      return { x: vector.x / length, y: vector.y / length }
    }

    function dot(first, second) {
      return first.x * second.x + first.y * second.y
    }

    function midpointOf(first, second) {
      return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    }

    function round(value) {
      return Number(value.toFixed(3))
    }

    function roundPoint(point) {
      return { x: round(point.x), y: round(point.y) }
    }
  }, {
    sourceUrl: `data:image/png;base64,${source.toString('base64')}`,
    manifest,
    outputBackground: OUTPUT_BACKGROUND,
    d20BleedScale: D20_BLEED_SCALE,
  })

  return {
    buffer: Buffer.from(result.encoded, 'base64'),
    width: result.width,
    height: result.height,
    report: result.report,
  }
}
