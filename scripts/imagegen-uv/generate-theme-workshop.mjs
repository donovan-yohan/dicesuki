#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createThemedDiceManifest } from './themed-dice-contract.mjs'
import {
  getEnvironmentTexturePaths,
  getThemeAtlasPaths,
  THEME_WORKSHOP,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'

const TEMPLATE_ROOT = path.resolve('public/artist-resources/imagegen-uv/theme-sets/templates')
const TEMPLATE_SIZE = 2048

await generateThemeWorkshop()

export async function generateThemeWorkshop() {
  const rasterEntries = []

  for (const shape of THEME_WORKSHOP_SHAPES) {
    const manifest = createThemedDiceManifest(shape, { canvasSize: TEMPLATE_SIZE })
    const directory = path.join(TEMPLATE_ROOT, shape)
    const guideSvg = renderNumberedGuideSvg(manifest)
    const inputSvg = renderImageGenInputSvg(manifest)
    const maskSvg = renderMaskSvg(manifest)

    await mkdir(directory, { recursive: true })
    await Promise.all([
      writeFile(path.join(directory, `${shape}-numbered-guide.svg`), guideSvg, 'utf8'),
      writeFile(path.join(directory, `${shape}-imagegen-input.svg`), inputSvg, 'utf8'),
      writeFile(path.join(directory, `${shape}-mask.svg`), maskSvg, 'utf8'),
      writeFile(path.join(directory, `${shape}-mesh-uv-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ])
    rasterEntries.push(
      { svg: guideSvg, outputPath: path.join(directory, `${shape}-numbered-guide.png`) },
      { svg: inputSvg, outputPath: path.join(directory, `${shape}-imagegen-input.png`) },
    )
  }

  await rasterizeSvgs(rasterEntries)
  await writeWorkshopPrompts()
  await writeWorkshopReadme()
  console.log(`Generated six canonical ImageGen dice templates and three theme prompt packs in ${path.relative(process.cwd(), TEMPLATE_ROOT)}`)
}

function renderNumberedGuideSvg(manifest) {
  const islands = manifest.islands.map((island) => {
    const baseStart = island.points[island.baselineEdge[0]]
    const baseEnd = island.points[island.baselineEdge[1]]
    return [
      `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
      `      <polygon class="island" points="${pointsToString(island.points)}" />`,
      `      <polygon class="safe" points="${pointsToString(island.safePoints)}" />`,
      `      <line class="base-edge" x1="${baseStart.x}" y1="${baseStart.y}" x2="${baseEnd.x}" y2="${baseEnd.y}" />`,
      `      <g transform="rotate(${island.baselineAngleDegrees} ${island.center.x} ${island.center.y})">`,
      `        <text class="number" style="font-size:${numberFontSize(island)}px" x="${island.center.x}" y="${numberY(island)}">${island.faceValue}</text>`,
      `        <line class="baseline" x1="${island.center.x - baselineWidth(island)}" y1="${island.center.y + baselineOffset(island)}" x2="${island.center.x + baselineWidth(island)}" y2="${island.center.y + baselineOffset(island)}" />`,
      '      </g>',
      `      <text class="mapping" x="${island.center.x}" y="${mappingY(island)}">${manifest.shape.toUpperCase()} ${island.faceValue} / M${island.materialIndex} / ${formatAngle(island.baselineAngleDegrees)}</text>`,
      '    </g>',
    ].join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="${manifest.label} canonical numbered UV guide">
  <defs>
    <style>
      .background { fill: #070b12; }
      .island { fill: #12384a; stroke: #67e8f9; stroke-width: 7; }
      .safe { fill: #f59e0b; fill-opacity: 0.08; stroke: #fde68a; stroke-width: 4; stroke-dasharray: 16 11; }
      .number { fill: #fff7d6; stroke: #111827; stroke-width: 3; paint-order: stroke fill; font-family: Georgia, serif; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
      .mapping { fill: #b8c5d9; font: 700 ${mappingSize(manifest.shape)}px Arial, sans-serif; text-anchor: middle; }
      .base-edge { stroke: #f97316; stroke-width: 12; opacity: 0.95; }
      .baseline { stroke: #f97316; stroke-width: 6; opacity: 0.86; }
    </style>
  </defs>
  <rect class="background" width="100%" height="100%" />
  <g id="canonical-numbered-islands">
${islands}
  </g>
</svg>
`
}

function renderImageGenInputSvg(manifest) {
  const islands = manifest.islands.map((island) => {
    const panelPoints = scalePoints(island.points, island.center, panelScale(manifest.shape))
    return [
      `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
      `      <polygon class="trim" points="${pointsToString(island.points)}" />`,
      `      <polygon class="panel" points="${pointsToString(panelPoints)}" />`,
      `      <text class="number" style="font-size:${numberFontSize(island)}px" x="${island.center.x}" y="${numberY(island)}" transform="rotate(${island.baselineAngleDegrees} ${island.center.x} ${island.center.y})">${island.faceValue}</text>`,
      '    </g>',
    ].join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="${manifest.label} Codex ImageGen numbered edit target">
  <defs>
    <style>
      .background { fill: #07090d; }
      .trim { fill: #d6cfbf; stroke: #f4efe4; stroke-width: 4; }
      .panel { fill: #394452; stroke: #202833; stroke-width: 4; }
      .number { fill: #f7f1df; stroke: #171b22; stroke-width: 4; paint-order: stroke fill; font-family: Georgia, serif; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
    </style>
  </defs>
  <rect class="background" width="100%" height="100%" />
  <g id="numbered-imagegen-edit-target">
${islands}
  </g>
</svg>
`
}

function renderMaskSvg(manifest) {
  const islands = manifest.islands
    .map((island) => `    <polygon points="${pointsToString(island.points)}" />`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.canvasSize}" height="${manifest.canvasSize}" viewBox="0 0 ${manifest.canvasSize} ${manifest.canvasSize}" role="img" aria-label="${manifest.label} UV island mask">
  <rect width="100%" height="100%" fill="#000000" />
  <g fill="#ffffff">
${islands}
  </g>
</svg>
`
}

async function writeWorkshopPrompts() {
  for (const theme of THEME_WORKSHOP) {
    const environmentPaths = getEnvironmentTexturePaths(theme.id)
    await mkdir(path.resolve(environmentPaths.directory), { recursive: true })
    await writeFile(path.resolve(environmentPaths.prompts), renderEnvironmentPromptPack(theme), 'utf8')

    for (const shape of THEME_WORKSHOP_SHAPES) {
      const paths = getThemeAtlasPaths(theme.id, shape)
      await mkdir(path.resolve(paths.directory), { recursive: true })
      await writeFile(path.resolve(paths.prompt), renderDicePrompt(theme, shape), 'utf8')
    }
  }
}

function renderDicePrompt(theme, shape) {
  const manifest = createThemedDiceManifest(shape, { canvasSize: TEMPLATE_SIZE })
  const values = manifest.faceValues.join(', ')
  const d10Rules = shape === 'd10'
    ? '\nD10 geometry contract: exactly ten complete kite islands for values 0 through 9. Each visible kite is one physical face made from two mesh triangles that share this same atlas island. Never split a kite into independent triangular designs.'
    : ''
  return `# ${theme.name} ${shape.toUpperCase()} Codex ImageGen Edit Prompt

Use case: style-transfer
Asset type: production UV texture atlas for a ${shape.toUpperCase()} polyhedral die
Primary request: Transform the attached numbered ${shape.toUpperCase()} UV edit target into ${theme.materialPrompt}.
Input images: Image 1 is the exact numbered edit target and spatial contract. Image 2 is the labeled guide showing each canonical baseline edge. Any additional theme images are style references only.
Composition/framing: Keep a flat square UV atlas, not a rendered die and not a perspective scene. Preserve every island position, size, shape, and rotation exactly.
Text: Preserve exactly one of each Arabic face value in this exact set: ${values}. Keep each value on its original island. Transform the placeholder type into bespoke themed numeral artwork rather than retaining the reference font.
Orientation: Preserve the exact rotation of every numeral from Image 1. Its baseline must remain parallel to the orange canonical edge shown for that island in Image 2. Do not rotate all numbers upright.
Materials/textures: ${theme.materialPrompt}.
Constraints: Keep trim, face panel, ornament, and numeral entirely inside each island. Maintain generous seam bleed to the island edge. Use lighting-free material detail suitable for a PBR base-color map. Keep the outside background near-black and visually quiet.${d10Rules}
Avoid: missing values, duplicated values, wrong values, Roman numerals, pips, extra letters, runes replacing numbers, symbols that resemble numbers, moved islands, resized islands, altered outlines, cropped islands, art crossing island gaps, perspective, a photographed die, cast shadows, watermark, signature.
`
}

function renderEnvironmentPromptPack(theme) {
  return `# ${theme.name} Environment Codex ImageGen Prompts

## Floor albedo

Use case: stylized-concept
Asset type: seamless PBR base-color texture for a Three.js dice-box floor
Primary request: ${theme.environment.floorPrompt}
Constraints: square texture; material-only; no directional cast shadow; no baked highlights; no text or watermark.

## Wall albedo

Use case: stylized-concept
Asset type: seamless PBR base-color texture for Three.js dice-box walls
Primary request: ${theme.environment.wallPrompt}
Constraints: square texture; material-only; no directional cast shadow; no baked highlights; no text or watermark.

## Skybox

Use case: stylized-concept
Asset type: equirectangular skybox panorama for a Three.js dice environment
Primary request: ${theme.environment.skyboxPrompt}
Composition/framing: 2:1 panoramic composition with the horizon at mid-height and useful detail across the full width.
Constraints: no close foreground object; no readable text; no watermark; left and right edges should join continuously.
`
}

async function writeWorkshopReadme() {
  const readme = `# Three-theme ImageGen workshop

This directory contains geometry-derived numbered edit targets for D4, D6, D8, D10, D12, and D20. The JSON manifest is the source of truth for face value, triangle grouping, UV coordinates, and numeral baseline orientation.

- The numbered PNG is the Codex ImageGen edit target.
- The guide PNG highlights the canonical baseline edge in orange.
- Generated art must preserve one face value per island and the recorded rotation.
- D10 has ten kite islands. Each kite maps two consecutive mesh triangles to one physical face and one value.
- Runtime normal maps are derived from the final ImageGen albedo atlas, so raised trim and engraved or embossed numeral contrast affect lighting without changing face-reading geometry.
`
  await mkdir(TEMPLATE_ROOT, { recursive: true })
  await writeFile(path.join(TEMPLATE_ROOT, 'README.md'), readme, 'utf8')
}

async function rasterizeSvgs(entries) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: TEMPLATE_SIZE, height: TEMPLATE_SIZE },
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

function scalePoints(points, center, scale) {
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }))
}

function pointsToString(points) {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(' ')
}

function mappingSize(shape) {
  return { d4: 28, d6: 26, d8: 23, d10: 22, d12: 20, d20: 18 }[shape]
}

function numberFontSize(island) {
  const width = Math.max(...island.safePoints.map((point) => point.x)) - Math.min(...island.safePoints.map((point) => point.x))
  const height = Math.max(...island.safePoints.map((point) => point.y)) - Math.min(...island.safePoints.map((point) => point.y))
  const characterCount = String(island.faceValue).length
  return round(Math.min(height * 0.58, width / (characterCount * 0.68), 210), 1)
}

function baselineWidth(island) {
  return numberFontSize(island) * Math.max(0.52, String(island.faceValue).length * 0.42)
}

function baselineOffset(island) {
  return numberFontSize(island) * 0.43
}

function panelScale(shape) {
  return shape === 'd10' ? 0.76 : 0.8
}

function numberY(island) {
  return round(island.center.y + 2)
}

function mappingY(island) {
  const top = Math.min(...island.points.map((point) => point.y))
  return round(top - 18)
}

function formatAngle(angle) {
  return `${angle >= 0 ? '+' : ''}${angle} deg`
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits
  const rounded = Math.round(value * multiplier) / multiplier
  return Object.is(rounded, -0) ? 0 : rounded
}
