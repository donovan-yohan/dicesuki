#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import * as THREE from 'three'
import { D20_FACE_NORMALS } from '../production-dice-fixtures/fixture-data.mjs'

export const D20_TEMPLATE_SIZE = 2048
export const D20_TEMPLATE_COLUMNS = 5
export const D20_TEMPLATE_ROWS = 4

const OUTPUT_DIR = path.resolve('public/artist-resources/imagegen-uv/d20-imagegen')
const GUIDE_SVG_PATH = path.join(OUTPUT_DIR, 'd20-numbered-mesh-guide.svg')
const GUIDE_PNG_PATH = path.join(OUTPUT_DIR, 'd20-numbered-mesh-guide.png')
const INPUT_SVG_PATH = path.join(OUTPUT_DIR, 'd20-imagegen-input.svg')
const INPUT_PNG_PATH = path.join(OUTPUT_DIR, 'd20-imagegen-input.png')
const MASK_SVG_PATH = path.join(OUTPUT_DIR, 'd20-mesh-mask.svg')
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'd20-mesh-uv-manifest.json')

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (isMain) {
  await generateD20MeshTemplate()
}

export async function generateD20MeshTemplate() {
  const manifest = createD20MeshTemplateManifest()
  const guideSvg = renderGuideSvg(manifest)
  const inputSvg = renderImageGenInputSvg(manifest)
  const maskSvg = renderMaskSvg(manifest)

  await mkdir(OUTPUT_DIR, { recursive: true })
  await Promise.all([
    writeFile(GUIDE_SVG_PATH, guideSvg, 'utf8'),
    writeFile(INPUT_SVG_PATH, inputSvg, 'utf8'),
    writeFile(MASK_SVG_PATH, maskSvg, 'utf8'),
    writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ])

  await rasterizeSvgs([
    { svg: guideSvg, outputPath: GUIDE_PNG_PATH },
    { svg: inputSvg, outputPath: INPUT_PNG_PATH },
  ])

  console.log(`Generated canonical D20 ImageGen template assets in ${path.relative(process.cwd(), OUTPUT_DIR)}`)
}

export function createD20MeshTemplateManifest() {
  const geometry = new THREE.IcosahedronGeometry(1, 0)
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry
  const position = nonIndexed.getAttribute('position')
  const margin = 56
  const gap = 28
  const cellWidth = (D20_TEMPLATE_SIZE - margin * 2 - gap * (D20_TEMPLATE_COLUMNS - 1)) / D20_TEMPLATE_COLUMNS
  const cellHeight = (D20_TEMPLATE_SIZE - margin * 2 - gap * (D20_TEMPLATE_ROWS - 1)) / D20_TEMPLATE_ROWS
  const targetRadius = Math.min(cellWidth, cellHeight) * 0.43

  if (position.count !== D20_FACE_NORMALS.length * 3) {
    throw new Error(`Expected ${D20_FACE_NORMALS.length * 3} D20 vertices, got ${position.count}`)
  }

  const meshFaces = D20_FACE_NORMALS.map((face, triangleIndex) => {
    const vertices = [0, 1, 2].map((offset) => {
      return new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + offset)
    })
    const centroid = vertices.reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3()).divideScalar(3)
    const meshNormal = new THREE.Vector3()
      .crossVectors(vertices[1].clone().sub(vertices[0]), vertices[2].clone().sub(vertices[0]))
      .normalize()
    const expectedNormal = vectorFromArray(face.normal).normalize()

    if (meshNormal.dot(expectedNormal) < 0.999) {
      throw new Error(`D20 triangle ${triangleIndex} does not match face ${face.value}`)
    }

    const { tangent, bitangent } = createFaceBasis(expectedNormal)
    const projected = vertices.map((vertex, vertexIndex) => {
      const relative = vertex.clone().sub(centroid)
      return {
        vertexIndex,
        x: relative.dot(tangent),
        y: relative.dot(bitangent),
      }
    })
    const projectedRadius = Math.max(...projected.map((point) => Math.hypot(point.x, point.y)))

    return {
      faceValue: face.value,
      materialIndex: triangleIndex,
      normal: roundVector(expectedNormal),
      tangent: roundVector(tangent),
      bitangent: roundVector(bitangent),
      projected,
      projectedRadius,
    }
  })

  const islands = [...meshFaces]
    .sort((a, b) => a.faceValue - b.faceValue)
    .map((face, atlasIndex) => {
      const column = atlasIndex % D20_TEMPLATE_COLUMNS
      const row = Math.floor(atlasIndex / D20_TEMPLATE_COLUMNS)
      const center = {
        x: margin + column * (cellWidth + gap) + cellWidth / 2,
        y: margin + row * (cellHeight + gap) + cellHeight / 2,
      }
      const scale = targetRadius / face.projectedRadius
      const points = face.projected.map((point) => ({
        vertexIndex: point.vertexIndex,
        x: center.x + point.x * scale,
        y: center.y - point.y * scale,
      }))
      const baseline = findCanonicalBaseline(points)

      return {
        id: `d20-face-${face.faceValue}`,
        faceValue: face.faceValue,
        materialIndex: face.materialIndex,
        center: roundPoint(center),
        points: points.map(roundPointWithIndex),
        safePoints: scalePoints(points, center, 0.62).map(roundPointWithIndex),
        panelPoints: scalePoints(points, center, 0.82).map(roundPointWithIndex),
        baselineEdge: baseline.vertexIndexes,
        baselineAngleDegrees: round(baseline.angleDegrees),
        normal: face.normal,
        tangent: face.tangent,
        bitangent: face.bitangent,
        uvByVertex: points.map((point) => ({
          vertexIndex: point.vertexIndex,
          u: round(point.x / D20_TEMPLATE_SIZE, 6),
          v: round(point.y / D20_TEMPLATE_SIZE, 6),
        })),
      }
    })

  geometry.dispose()
  if (nonIndexed !== geometry) nonIndexed.dispose()

  return {
    version: '2.1',
    shape: 'd20',
    canvasSize: D20_TEMPLATE_SIZE,
    columns: D20_TEMPLATE_COLUMNS,
    rows: D20_TEMPLATE_ROWS,
    coordinateSystem: {
      pixels: 'top-left SVG/image coordinates',
      uv: 'glTF top-left texture coordinates; uvByVertex maps the real Icosahedron triangle vertex order',
      screenBasis: 'tangent maps screen-right; bitangent maps screen-up when previewed face-on',
      numberBaseline: 'parallel to the triangle edge whose undirected angle is closest to horizontal; lower edge wins exact ties',
    },
    purpose: 'Canonical numbered edit target for Codex ImageGen image-to-image dice art.',
    islands,
  }
}

export function renderGuideSvg(manifest) {
  const islands = manifest.islands.map((island) => {
    const baseStart = island.points.find((point) => point.vertexIndex === island.baselineEdge[0])
    const baseEnd = island.points.find((point) => point.vertexIndex === island.baselineEdge[1])
    if (!baseStart || !baseEnd) throw new Error(`Face ${island.faceValue} has an invalid baseline edge`)
    const vertexLabels = island.points.map((point) => {
      const towardCenter = {
        x: point.x + (island.center.x - point.x) * 0.16,
        y: point.y + (island.center.y - point.y) * 0.16,
      }
      return `<text class="vertex" x="${round(towardCenter.x)}" y="${round(towardCenter.y)}">v${point.vertexIndex}</text>`
    }).join('\n        ')

    return [
      `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
      `      <polygon class="island" points="${pointsToString(island.points)}" />`,
      `      <polygon class="safe" points="${pointsToString(island.safePoints)}" />`,
      `      <line class="base-edge" x1="${baseStart.x}" y1="${baseStart.y}" x2="${baseEnd.x}" y2="${baseEnd.y}" />`,
      `      <g class="number-orientation" transform="rotate(${island.baselineAngleDegrees} ${island.center.x} ${island.center.y})">`,
      `        <line class="baseline" x1="${round(island.center.x - 58)}" y1="${round(island.center.y + 54)}" x2="${round(island.center.x + 58)}" y2="${round(island.center.y + 54)}" />`,
      `        <text class="number" x="${island.center.x}" y="${round(island.center.y + 4)}">${island.faceValue}</text>`,
      '      </g>',
      `      <text class="mapping" x="${island.center.x}" y="${round(island.center.y - 174)}">FACE ${island.faceValue} / TRI ${island.materialIndex} / ${formatAngle(island.baselineAngleDegrees)}</text>`,
      `      ${vertexLabels}`,
      '    </g>',
    ].join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="Canonical D20 numbered mesh UV guide">
  <defs>
    <style>
      .background { fill: #080c16; }
      .cell { fill: none; stroke: #243247; stroke-width: 2; }
      .island { fill: #12384a; stroke: #67e8f9; stroke-width: 6; }
      .safe { fill: #f59e0b; fill-opacity: 0.08; stroke: #fde68a; stroke-width: 4; stroke-dasharray: 14 10; }
      .number { fill: #fff7d6; font: 700 94px Georgia, serif; text-anchor: middle; dominant-baseline: middle; }
      .mapping { fill: #b8c5d9; font: 700 22px Arial, sans-serif; text-anchor: middle; }
      .vertex { fill: #67e8f9; font: 700 20px ui-monospace, monospace; text-anchor: middle; dominant-baseline: middle; }
      .base-edge { stroke: #f97316; stroke-width: 11; opacity: 0.9; }
      .baseline { stroke: #f97316; stroke-width: 5; opacity: 0.82; }
    </style>
  </defs>
  <rect class="background" width="100%" height="100%" />
  <g id="mesh-uv-islands">
${islands}
  </g>
</svg>
`
}

export function renderImageGenInputSvg(manifest) {
  const islands = manifest.islands.map((island) => {
    return [
      `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
      `      <polygon class="trim" points="${pointsToString(island.points)}" />`,
      `      <polygon class="panel" points="${pointsToString(island.panelPoints)}" />`,
      `      <text class="number" x="${island.center.x}" y="${round(island.center.y + 4)}" transform="rotate(${island.baselineAngleDegrees} ${island.center.x} ${island.center.y})">${island.faceValue}</text>`,
      '    </g>',
    ].join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="D20 numbered Codex ImageGen edit target">
  <defs>
    <style>
      .background { fill: #07090d; }
      .trim { fill: #d6cfbf; stroke: #f4efe4; stroke-width: 3; }
      .panel { fill: #394452; stroke: #202833; stroke-width: 3; }
      .number { fill: #f7f1df; stroke: #171b22; stroke-width: 3; paint-order: stroke fill; font: 700 96px Georgia, serif; text-anchor: middle; dominant-baseline: middle; }
    </style>
  </defs>
  <rect class="background" width="100%" height="100%" />
  <g id="imagegen-edit-target">
${islands}
  </g>
</svg>
`
}

export function renderMaskSvg(manifest) {
  const masks = manifest.islands
    .map((island) => `    <polygon points="${pointsToString(island.points)}" />`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="D20 canonical mesh UV mask">
  <rect width="100%" height="100%" fill="#000000" />
  <g fill="#ffffff">
${masks}
  </g>
</svg>
`
}

async function rasterizeSvgs(entries) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: D20_TEMPLATE_SIZE, height: D20_TEMPLATE_SIZE },
      deviceScaleFactor: 1,
    })

    for (const entry of entries) {
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block}</style></head><body>${entry.svg}</body></html>`)
      await page.screenshot({ path: entry.outputPath, type: 'png' })
    }
  } finally {
    await browser.close()
  }
}

function createFaceBasis(normal) {
  const reference = Math.abs(normal.y) > 0.92
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { tangent, bitangent }
}

function vectorFromArray(value) {
  return new THREE.Vector3(value[0], value[1], value[2])
}

function scalePoints(points, center, scale) {
  return points.map((point) => ({
    ...point,
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }))
}

function findCanonicalBaseline(points) {
  const candidates = points.map((start, index) => {
    const end = points[(index + 1) % points.length]
    const angleDegrees = normalizeUndirectedAngle(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI)
    return {
      vertexIndexes: [start.vertexIndex, end.vertexIndex],
      angleDegrees,
      midpointY: (start.y + end.y) / 2,
    }
  })

  candidates.sort((a, b) => {
    const angleDifference = Math.abs(a.angleDegrees) - Math.abs(b.angleDegrees)
    if (Math.abs(angleDifference) > 1e-9) return angleDifference
    return b.midpointY - a.midpointY
  })
  return candidates[0]
}

function normalizeUndirectedAngle(angleDegrees) {
  let normalized = ((angleDegrees + 90) % 180 + 180) % 180 - 90
  if (Math.abs(normalized) < 1e-9) normalized = 0
  return normalized
}

function formatAngle(angleDegrees) {
  return `${angleDegrees >= 0 ? '+' : ''}${angleDegrees} deg`
}

function pointsToString(points) {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(' ')
}

function roundPoint(point) {
  return { x: round(point.x), y: round(point.y) }
}

function roundPointWithIndex(point) {
  return { vertexIndex: point.vertexIndex, x: round(point.x), y: round(point.y) }
}

function roundVector(vector) {
  return [round(vector.x, 6), round(vector.y, 6), round(vector.z, 6)]
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits
  const rounded = Math.round(value * multiplier) / multiplier
  return Object.is(rounded, -0) ? 0 : rounded
}
