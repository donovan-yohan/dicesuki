#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createCanonicalDiceManifest,
  SUPPORTED_DICE_SHAPES,
} from './canonical-dice-contract.mjs'
import { validateCanonicalManifest } from './canonical-validation.mjs'

export const DEFAULT_AUTHORING_OUTPUT = '.artifacts/imagegen-uv'
export const AUTHORING_OUTPUT_MARKER = '.dicesuki-imagegen-authoring.json'

const TEXT_FILES = [
  'manifest.json',
  'numbered-guide.svg',
  'imagegen-input.svg',
  'mask.svg',
  'prompt.md',
]
const RASTER_FILES = ['numbered-guide.png', 'imagegen-input.png', 'mask.png']
const AUTHORING_OUTPUT_MARKER_CONTENT = `${JSON.stringify({
  kind: 'dicesuki-imagegen-authoring-kit',
  version: 1,
}, null, 2)}\n`

export async function generateAuthoringKit(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd())
  const outputDir = assertSafeOutputDirectory(options.outputDir ?? DEFAULT_AUTHORING_OUTPUT, repoRoot)
  const shapes = normalizeShapes(options.shapes)
  const rasterEntries = []

  await prepareManagedOutputDirectory(outputDir)
  await writeFile(
    path.join(outputDir, AUTHORING_OUTPUT_MARKER),
    AUTHORING_OUTPUT_MARKER_CONTENT,
    'utf8',
  )
  for (const shape of shapes) {
    const manifest = createCanonicalDiceManifest(shape)
    const validation = validateCanonicalManifest(manifest)
    if (!validation.valid) {
      throw new Error(`${shape} failed canonical validation:\n${validation.errors.join('\n')}`)
    }

    const shapeDir = path.join(outputDir, shape)
    const rendered = renderAuthoringFiles(manifest)
    await mkdir(shapeDir, { recursive: true })
    await Promise.all(Object.entries(rendered).map(([fileName, contents]) => (
      writeFile(path.join(shapeDir, fileName), contents, 'utf8')
    )))

    if (options.rasterize) {
      rasterEntries.push(
        { svg: rendered['numbered-guide.svg'], outputPath: path.join(shapeDir, 'numbered-guide.png') },
        { svg: rendered['imagegen-input.svg'], outputPath: path.join(shapeDir, 'imagegen-input.png') },
        { svg: rendered['mask.svg'], outputPath: path.join(shapeDir, 'mask.png') },
      )
    }
  }

  await writeFile(path.join(outputDir, 'INDEX.md'), renderIndex(shapes), 'utf8')
  if (options.rasterize) await rasterizeSvgs(rasterEntries)

  const validation = await validateAuthoringKit({
    outputDir,
    shapes,
    rasterize: Boolean(options.rasterize),
  })
  if (!validation.valid) throw new Error(`Generated authoring kit is invalid:\n${validation.errors.join('\n')}`)
  return { outputDir, shapes, rasterized: Boolean(options.rasterize) }
}

export async function validateAuthoringKit(options = {}) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_AUTHORING_OUTPUT)
  const shapes = normalizeShapes(options.shapes)
  const rasterize = Boolean(options.rasterize)
  const errors = []

  try {
    const marker = await readFile(path.join(outputDir, AUTHORING_OUTPUT_MARKER), 'utf8')
    if (marker !== AUTHORING_OUTPUT_MARKER_CONTENT) {
      errors.push(`${AUTHORING_OUTPUT_MARKER} does not identify a managed authoring kit`)
    }
  } catch (error) {
    errors.push(`cannot read ${AUTHORING_OUTPUT_MARKER} (${error.message})`)
  }

  try {
    const rootEntries = await readdir(outputDir, { withFileTypes: true })
    const expectedRootEntries = new Set([AUTHORING_OUTPUT_MARKER, 'INDEX.md', ...shapes])
    const unexpected = rootEntries
      .filter((entry) => !expectedRootEntries.has(entry.name))
      .map((entry) => entry.name)
      .sort()
    if (unexpected.length > 0) errors.push(`unexpected root entries: ${unexpected.join(', ')}`)
    for (const entry of rootEntries) {
      if (shapes.includes(entry.name) && !entry.isDirectory()) {
        errors.push(`${entry.name} must be a shape directory`)
      }
      if ([AUTHORING_OUTPUT_MARKER, 'INDEX.md'].includes(entry.name) && !entry.isFile()) {
        errors.push(`${entry.name} must be a regular file`)
      }
    }
  } catch (error) {
    errors.push(`cannot list output root (${error.message})`)
  }

  for (const shape of shapes) {
    const shapeDir = path.join(outputDir, shape)
    let manifest
    try {
      manifest = JSON.parse(await readFile(path.join(shapeDir, 'manifest.json'), 'utf8'))
    } catch (error) {
      errors.push(`${shape}: cannot read manifest.json (${error.message})`)
      continue
    }

    const validation = validateCanonicalManifest(manifest)
    errors.push(...validation.errors.map((error) => `${shape}: ${error}`))
    const expectedFiles = renderAuthoringFiles(manifest)
    for (const [fileName, expected] of Object.entries(expectedFiles)) {
      try {
        const actual = await readFile(path.join(shapeDir, fileName), 'utf8')
        if (actual !== expected) errors.push(`${shape}: ${fileName} does not match its canonical manifest`)
      } catch (error) {
        errors.push(`${shape}: cannot read ${fileName} (${error.message})`)
      }
    }

    try {
      const entries = await readdir(shapeDir, { withFileTypes: true })
      const expectedFiles = new Set(rasterize ? [...TEXT_FILES, ...RASTER_FILES] : TEXT_FILES)
      const unexpected = entries
        .filter((entry) => !expectedFiles.has(entry.name) || !entry.isFile())
        .map((entry) => entry.name)
      if (unexpected.length > 0) errors.push(`${shape}: unexpected generated files: ${unexpected.sort().join(', ')}`)
      const missing = [...expectedFiles].filter((fileName) => !entries.some((entry) => entry.name === fileName))
      if (missing.length > 0) errors.push(`${shape}: missing generated files: ${missing.sort().join(', ')}`)
    } catch (error) {
      errors.push(`${shape}: cannot list output directory (${error.message})`)
    }
  }

  try {
    const index = await readFile(path.join(outputDir, 'INDEX.md'), 'utf8')
    if (index !== renderIndex(shapes)) errors.push('INDEX.md does not match the requested canonical shape set')
  } catch (error) {
    errors.push(`cannot read INDEX.md (${error.message})`)
  }

  return { valid: errors.length === 0, errors, outputDir, shapes }
}

export function renderAuthoringFiles(manifest) {
  return {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'numbered-guide.svg': renderNumberedGuide(manifest),
    'imagegen-input.svg': renderImageGenInput(manifest),
    'mask.svg': renderMask(manifest),
    'prompt.md': renderPrompt(manifest),
  }
}

export function renderIndex(shapes) {
  return [
    '# Dicesuki canonical ImageGen UV authoring kit',
    '',
    'Generated deterministically by `npm run generate:imagegen-uv`.',
    'These files are local authoring outputs and must not be committed under `public/`.',
    '',
    '| Shape | Numbered guide | ImageGen input | Mask | Canonical manifest | Prompt |',
    '|---|---|---|---|---|---|',
    ...shapes.map((shape) => (
      `| ${shape.toUpperCase()} | [guide](${shape}/numbered-guide.svg) | [input](${shape}/imagegen-input.svg) | [mask](${shape}/mask.svg) | [manifest](${shape}/manifest.json) | [prompt](${shape}/prompt.md) |`
    )),
    '',
  ].join('\n')
}

export function assertSafeOutputDirectory(outputDir, repoRoot = process.cwd()) {
  const resolved = path.resolve(repoRoot, outputDir)
  const relativeToRepo = path.relative(repoRoot, resolved)
  const isInsideRepo = relativeToRepo === '' || (
    relativeToRepo !== '..' && !relativeToRepo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeToRepo)
  )
  const forbiddenRoots = ['public', 'src', 'scripts', '.git'].map((entry) => path.join(repoRoot, entry))
  for (const forbiddenRoot of forbiddenRoots) {
    if (resolved === forbiddenRoot || resolved.startsWith(`${forbiddenRoot}${path.sep}`)) {
      throw new Error(`ImageGen authoring output cannot be written under ${path.relative(repoRoot, forbiddenRoot)}`)
    }
  }
  const artifactsRoot = path.join(repoRoot, '.artifacts')
  if (isInsideRepo && resolved !== artifactsRoot && !resolved.startsWith(`${artifactsRoot}${path.sep}`)) {
    throw new Error('ImageGen authoring output inside the repo must stay under .artifacts/')
  }
  return resolved
}

async function prepareManagedOutputDirectory(outputDir) {
  let entries
  try {
    entries = await readdir(outputDir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(outputDir, { recursive: true })
    return
  }

  if (entries.length === 0) return

  let marker
  try {
    marker = await readFile(path.join(outputDir, AUTHORING_OUTPUT_MARKER), 'utf8')
  } catch (error) {
    throw new Error(
      `Refusing to clean non-empty output without ${AUTHORING_OUTPUT_MARKER} (${error.message})`,
    )
  }
  if (marker !== AUTHORING_OUTPUT_MARKER_CONTENT) {
    throw new Error(`Refusing to clean output with an invalid ${AUTHORING_OUTPUT_MARKER}`)
  }

  const unexpected = []
  for (const entry of entries) {
    if (entry.name === AUTHORING_OUTPUT_MARKER || entry.name === 'INDEX.md') {
      if (!entry.isFile()) unexpected.push(entry.name)
      continue
    }
    if (!SUPPORTED_DICE_SHAPES.includes(entry.name) || !entry.isDirectory()) {
      unexpected.push(entry.name)
      continue
    }
    const shapeEntries = await readdir(path.join(outputDir, entry.name), { withFileTypes: true })
    for (const shapeEntry of shapeEntries) {
      if (
        !shapeEntry.isFile()
        || (!TEXT_FILES.includes(shapeEntry.name) && !RASTER_FILES.includes(shapeEntry.name))
      ) {
        unexpected.push(`${entry.name}/${shapeEntry.name}`)
      }
    }
  }
  if (unexpected.length > 0) {
    throw new Error(`Refusing to clean output with unmanaged entries: ${unexpected.sort().join(', ')}`)
  }

  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
}

function renderNumberedGuide(manifest) {
  const islands = manifest.islands.map((island) => {
    const baseStart = island.points[island.baselineEdge[0]]
    const baseEnd = island.points[island.baselineEdge[1]]
    return [
      `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
      `      <polygon class="island" points="${pointsToString(island.points)}" />`,
      `      <polygon class="safe" points="${pointsToString(island.safePoints)}" />`,
      `      <line class="base-edge" x1="${baseStart.x}" y1="${baseStart.y}" x2="${baseEnd.x}" y2="${baseEnd.y}" />`,
      `      <text class="number" style="font-size:${numberFontSize(island)}px" x="${island.center.x}" y="${island.center.y}" transform="rotate(${island.baselineAngleDegrees} ${island.center.x} ${island.center.y})">${island.faceValue}</text>`,
      `      <text class="mapping" x="${island.center.x}" y="${mappingY(island)}">${manifest.shape.toUpperCase()} ${island.faceValue} / M${island.materialIndex} / ${formatAngle(island.baselineAngleDegrees)}</text>`,
      '    </g>',
    ].join('\n')
  }).join('\n')

  return svgDocument(manifest, 'canonical numbered UV guide', `
  <defs><style>
    .background { fill: #070b12; }
    .island { fill: #12384a; stroke: #67e8f9; stroke-width: 7; }
    .safe { fill: #f59e0b; fill-opacity: 0.08; stroke: #fde68a; stroke-width: 4; stroke-dasharray: 16 11; }
    .number { fill: #fff7d6; stroke: #111827; stroke-width: 3; paint-order: stroke fill; font-family: Georgia, serif; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
    .mapping { fill: #b8c5d9; font: 700 ${mappingSize(manifest.shape)}px Arial, sans-serif; text-anchor: middle; }
    .base-edge { stroke: #f97316; stroke-width: 12; }
  </style></defs>
  <rect class="background" width="100%" height="100%" />
  <g id="canonical-numbered-islands">
${islands}
  </g>`)
}

function renderImageGenInput(manifest) {
  const islands = manifest.islands.map((island) => {
    const panelPoints = scalePoints(island.points, island.center, manifest.shape === 'd10' ? 0.76 : 0.8)
    return [
      `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
      `      <polygon class="trim" points="${pointsToString(island.points)}" />`,
      `      <polygon class="panel" points="${pointsToString(panelPoints)}" />`,
      `      <text class="number" style="font-size:${numberFontSize(island)}px" x="${island.center.x}" y="${island.center.y}" transform="rotate(${island.baselineAngleDegrees} ${island.center.x} ${island.center.y})">${island.faceValue}</text>`,
      '    </g>',
    ].join('\n')
  }).join('\n')

  return svgDocument(manifest, 'canonical numbered ImageGen edit target', `
  <defs><style>
    .background { fill: #07090d; }
    .trim { fill: #d6cfbf; stroke: #f4efe4; stroke-width: 4; }
    .panel { fill: #394452; stroke: #202833; stroke-width: 4; }
    .number { fill: #f7f1df; stroke: #171b22; stroke-width: 4; paint-order: stroke fill; font-family: Georgia, serif; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
  </style></defs>
  <rect class="background" width="100%" height="100%" />
  <g id="numbered-imagegen-edit-target">
${islands}
  </g>`)
}

function renderMask(manifest) {
  const islands = manifest.islands.map((island) => (
    `    <polygon points="${pointsToString(island.points)}" />`
  )).join('\n')
  return svgDocument(manifest, 'canonical UV island mask', `
  <rect width="100%" height="100%" fill="#000000" />
  <g id="paintable-uv-islands" fill="#ffffff">
${islands}
  </g>`)
}

function renderPrompt(manifest) {
  const d10Rule = manifest.shape === 'd10'
    ? ' Each D10 kite is one physical face made from two triangles; never split a kite into separate designs.'
    : ''
  return `# ${manifest.label} ImageGen UV edit prompt

Use the attached \`imagegen-input.svg\` as the exact numbered edit target and \`numbered-guide.svg\` as the face/baseline reference. Produce a flat square material atlas, not a rendered die. Preserve every island position, outline, face value, material mapping, and numeral rotation exactly. Keep ornament, trim, and numerals inside the mask with seam bleed to the island edge.${d10Rule}

Required values: ${manifest.faceValues.join(', ')}.

Avoid missing or duplicated values, Roman numerals, replacement symbols, moved or resized islands, perspective, cast shadows, labels outside islands, signatures, and watermarks. Validate the result against \`manifest.json\` before any Blender bake or runtime promotion.
`
}

function svgDocument(manifest, label, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="${manifest.label} ${label}">${body}
</svg>
`
}

async function rasterizeSvgs(entries) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 2048, height: 2048 },
      deviceScaleFactor: 1,
    })
    for (const entry of entries) {
      await page.setContent(`<!doctype html><html><style>html,body{margin:0;overflow:hidden}svg{display:block}</style><body>${entry.svg}</body></html>`)
      await page.screenshot({ path: entry.outputPath, type: 'png' })
    }
  } finally {
    await browser.close()
  }
}

function normalizeShapes(shapes) {
  const requested = shapes?.length ? [...new Set(shapes)] : [...SUPPORTED_DICE_SHAPES]
  const invalid = requested.filter((shape) => !SUPPORTED_DICE_SHAPES.includes(shape))
  if (invalid.length > 0) throw new Error(`Unsupported dice shape(s): ${invalid.join(', ')}`)
  return SUPPORTED_DICE_SHAPES.filter((shape) => requested.includes(shape))
}

function scalePoints(points, center, scale) {
  return points.map((point) => ({
    x: round(center.x + (point.x - center.x) * scale),
    y: round(center.y + (point.y - center.y) * scale),
  }))
}

function pointsToString(points) {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function numberFontSize(island) {
  const width = Math.max(...island.safePoints.map((point) => point.x)) - Math.min(...island.safePoints.map((point) => point.x))
  const height = Math.max(...island.safePoints.map((point) => point.y)) - Math.min(...island.safePoints.map((point) => point.y))
  return round(Math.min(height * 0.58, width / (String(island.faceValue).length * 0.68), 210), 1)
}

function mappingSize(shape) {
  return { d4: 28, d6: 26, d8: 23, d10: 22, d12: 20, d20: 18 }[shape]
}

function mappingY(island) {
  return round(Math.min(...island.points.map((point) => point.y)) - 18)
}

function formatAngle(angle) {
  return `${angle >= 0 ? '+' : ''}${angle} deg`
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits
  const rounded = Math.round(value * multiplier) / multiplier
  return Object.is(rounded, -0) ? 0 : rounded
}

function parseArgs(argv) {
  const options = { shapes: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--out') options.outputDir = argv[++index]
    else if (argument === '--shape') options.shapes.push(argv[++index])
    else if (argument === '--rasterize') options.rasterize = true
    else if (argument === '--validate-only') options.validateOnly = true
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/imagegen-uv/generate-authoring-kit.mjs [--out DIR] [--shape d20] [--rasterize] [--validate-only]')
    return
  }
  if (options.validateOnly) {
    const validation = await validateAuthoringKit(options)
    if (!validation.valid) throw new Error(validation.errors.join('\n'))
    console.log(`Validated canonical ImageGen UV authoring kit for ${validation.shapes.join(', ')}`)
    return
  }
  const result = await generateAuthoringKit(options)
  console.log(`Generated canonical ImageGen UV authoring kit for ${result.shapes.join(', ')} in ${path.relative(process.cwd(), result.outputDir)}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
