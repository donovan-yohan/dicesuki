export const ATLAS_VERSION = '1.0'
export const DEFAULT_CANVAS_SIZE = 2048

export const DICE_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

export const DICE_SPECS = {
  d4: {
    label: 'D4',
    islandShape: 'triangle',
    columns: 2,
    faceValues: [1, 2, 3, 4],
    materialMap: { 1: 0, 2: 1, 3: 2, 4: 3 },
  },
  d6: {
    label: 'D6',
    islandShape: 'square',
    columns: 3,
    faceValues: [1, 2, 3, 4, 5, 6],
    materialMap: { 1: 3, 2: 4, 3: 0, 4: 1, 5: 5, 6: 2 },
  },
  d8: {
    label: 'D8',
    islandShape: 'triangle',
    columns: 4,
    faceValues: [1, 2, 3, 4, 5, 6, 7, 8],
    materialMap: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 6, 6: 7, 7: 4, 8: 5 },
  },
  d10: {
    label: 'D10',
    islandShape: 'kite',
    columns: 5,
    faceValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    materialMap: { 0: 0, 1: 6, 2: 1, 3: 5, 4: 2, 5: 9, 6: 3, 7: 8, 8: 4, 9: 7 },
  },
  d12: {
    label: 'D12',
    islandShape: 'pentagon',
    columns: 4,
    faceValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    materialMap: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5, 6: 6, 7: 10, 8: 11, 9: 9, 10: 7, 11: 4, 12: 8 },
  },
  d20: {
    label: 'D20',
    islandShape: 'triangle',
    columns: 5,
    faceValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    materialMap: {
      1: 0,
      2: 1,
      3: 2,
      4: 3,
      5: 4,
      6: 5,
      7: 6,
      8: 7,
      9: 8,
      10: 9,
      11: 16,
      12: 15,
      13: 19,
      14: 18,
      15: 17,
      16: 14,
      17: 10,
      18: 11,
      19: 12,
      20: 13,
    },
  },
}

const GUIDE_COLORS = {
  background: '#111827',
  bleedFill: '#0e7490',
  bleedStroke: '#67e8f9',
  safeFill: '#f59e0b',
  safeStroke: '#fde68a',
  label: '#f9fafb',
  sublabel: '#d1d5db',
  grid: '#374151',
}

export function createAtlasLayout(shape, options = {}) {
  const spec = DICE_SPECS[shape]
  if (!spec) {
    throw new Error(`Unknown dice shape: ${shape}`)
  }

  const canvasSize = options.size ?? DEFAULT_CANVAS_SIZE
  const margin = options.margin ?? Math.round(canvasSize * 0.047)
  const gap = options.gap ?? Math.round(canvasSize * 0.027)
  const columns = options.columns ?? spec.columns
  const rows = Math.ceil(spec.faceValues.length / columns)
  const cellWidth = (canvasSize - margin * 2 - gap * (columns - 1)) / columns
  const cellHeight = (canvasSize - margin * 2 - gap * (rows - 1)) / rows
  const radius = Math.min(cellWidth, cellHeight) * 0.39

  const islands = spec.faceValues.map((faceValue, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const center = {
      x: margin + column * (cellWidth + gap) + cellWidth / 2,
      y: margin + row * (cellHeight + gap) + cellHeight / 2,
    }
    const points = createIslandPoints(spec.islandShape, center, radius)
    const safePoints = scalePoints(points, center, 0.66)
    const bounds = getBounds(points)

    return {
      id: `${shape}-face-${faceValue}`,
      shape,
      faceValue,
      materialIndex: spec.materialMap[faceValue],
      islandShape: spec.islandShape,
      center: roundPoint(center),
      points: points.map(roundPoint),
      safePoints: safePoints.map(roundPoint),
      bounds: roundBounds(bounds),
      uvBox: {
        minU: round(bounds.minX / canvasSize),
        minV: round(bounds.minY / canvasSize),
        maxU: round(bounds.maxX / canvasSize),
        maxV: round(bounds.maxY / canvasSize),
      },
    }
  })

  return {
    version: ATLAS_VERSION,
    shape,
    label: spec.label,
    islandShape: spec.islandShape,
    canvasSize,
    columns,
    rows,
    margin,
    gap,
    note: 'Per-face atlas for ImageGen experiments. Runtime dice currently use deterministic per-face materials.',
    islands,
  }
}

export function renderTemplateSvg(layout) {
  const headerHeight = Math.round(layout.canvasSize * 0.055)
  const guideLines = layout.islands
    .map((island) => {
      const points = pointsToString(island.points)
      const safePoints = pointsToString(island.safePoints)
      const labelY = island.center.y - 10
      const sublabelY = island.center.y + 30

      return [
        `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
        `      <polygon class="bleed" points="${points}" />`,
        `      <polygon class="safe" points="${safePoints}" />`,
        `      <text class="face-label" x="${island.center.x}" y="${round(labelY)}">face ${island.faceValue}</text>`,
        `      <text class="face-sublabel" x="${island.center.x}" y="${round(sublabelY)}">material ${island.materialIndex}</text>`,
        '    </g>',
      ].join('\n')
    })
    .join('\n')

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.canvasSize}" height="${layout.canvasSize}" viewBox="0 0 ${layout.canvasSize} ${layout.canvasSize}" role="img" aria-labelledby="title desc">`,
    `  <title id="title">Daisu ${layout.label} ImageGen UV template</title>`,
    `  <desc id="desc">Guide SVG for generating ${layout.label} dice material art. Keep island boundaries fixed. Hide guide labels before final texture use.</desc>`,
    '  <defs>',
    '    <style>',
    `      .background { fill: ${GUIDE_COLORS.background}; }`,
    `      .grid { fill: none; stroke: ${GUIDE_COLORS.grid}; stroke-width: 2; opacity: 0.35; }`,
    `      .bleed { fill: ${GUIDE_COLORS.bleedFill}; fill-opacity: 0.38; stroke: ${GUIDE_COLORS.bleedStroke}; stroke-width: 6; }`,
    `      .safe { fill: ${GUIDE_COLORS.safeFill}; fill-opacity: 0.14; stroke: ${GUIDE_COLORS.safeStroke}; stroke-width: 4; stroke-dasharray: 18 12; }`,
    `      .face-label { fill: ${GUIDE_COLORS.label}; font: 700 44px Arial, sans-serif; text-anchor: middle; dominant-baseline: middle; }`,
    `      .face-sublabel { fill: ${GUIDE_COLORS.sublabel}; font: 500 28px Arial, sans-serif; text-anchor: middle; dominant-baseline: middle; }`,
    `      .header { fill: ${GUIDE_COLORS.label}; font: 700 42px Arial, sans-serif; }`,
    `      .header-note { fill: ${GUIDE_COLORS.sublabel}; font: 500 24px Arial, sans-serif; }`,
    '    </style>',
    '  </defs>',
    '  <rect class="background" width="100%" height="100%" />',
    `  <text class="header" x="${layout.margin}" y="${headerHeight}">Daisu ${layout.label} ImageGen UV Template</text>`,
    `  <text class="header-note" x="${layout.margin}" y="${headerHeight + 38}">Paint inside cyan bleed. Keep numerals inside gold safe zones. Preserve face and material mapping.</text>`,
    '  <g id="uv-islands">',
    guideLines,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

export function renderCleanTemplateSvg(layout) {
  const guides = layout.islands
    .map((island) => {
      return [
        `    <g id="${island.id}" data-face-value="${island.faceValue}" data-material-index="${island.materialIndex}">`,
        `      <polygon class="bleed" points="${pointsToString(island.points)}" />`,
        `      <polygon class="safe" points="${pointsToString(island.safePoints)}" />`,
        '    </g>',
      ].join('\n')
    })
    .join('\n')

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.canvasSize}" height="${layout.canvasSize}" viewBox="0 0 ${layout.canvasSize} ${layout.canvasSize}" role="img" aria-label="Daisu ${layout.label} clean ImageGen UV template">`,
    '  <defs>',
    '    <style>',
    `      .background { fill: ${GUIDE_COLORS.background}; }`,
    `      .bleed { fill: ${GUIDE_COLORS.bleedFill}; fill-opacity: 0.32; stroke: ${GUIDE_COLORS.bleedStroke}; stroke-width: 6; }`,
    `      .safe { fill: ${GUIDE_COLORS.safeFill}; fill-opacity: 0.09; stroke: ${GUIDE_COLORS.safeStroke}; stroke-width: 4; stroke-dasharray: 18 12; }`,
    '    </style>',
    '  </defs>',
    '  <rect class="background" width="100%" height="100%" />',
    '  <g id="uv-islands">',
    guides,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

export function renderMaskSvg(layout) {
  const masks = layout.islands
    .map((island) => `    <polygon points="${pointsToString(island.points)}" />`)
    .join('\n')

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.canvasSize}" height="${layout.canvasSize}" viewBox="0 0 ${layout.canvasSize} ${layout.canvasSize}" role="img" aria-label="Daisu ${layout.label} UV mask">`,
    '  <rect width="100%" height="100%" fill="#000000" />',
    '  <g id="paintable-uv-islands" fill="#ffffff">',
    masks,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

export function renderPromptPack(layout, options = {}) {
  const material = options.material ?? 'polished obsidian stone with subtle veins, worn silver inlay, physically plausible roughness'
  const faceMap = layout.islands
    .map((island) => `- face ${island.faceValue}: material index ${island.materialIndex}`)
    .join('\n')

  return [
    `# Daisu ${layout.label} ImageGen Prompt Pack`,
    '',
    `Clean template: \`assets/${layout.shape}-uv-clean-template.svg\``,
    `Labeled guide: \`assets/${layout.shape}-uv-template.svg\``,
    `Mask: \`assets/${layout.shape}-uv-mask.svg\``,
    `Manifest: \`assets/${layout.shape}-uv-manifest.json\``,
    '',
    '## Material-Only Prompt',
    '',
    `Use the attached clean Daisu ${layout.label} UV template as a strict layout guide. Generate a single square ${layout.canvasSize}x${layout.canvasSize} texture atlas for ${material}. Preserve every UV island position, size, rotation, and outline exactly. Fill only the paintable island areas, including the cyan bleed. Keep the background transparent or very dark outside the islands. Do not add numbers, letters, labels, borders, signatures, watermarks, or decorative frames. Keep the gold safe-zone centers clean enough for deterministic numerals to be composited later. The texture should wrap believably on faceted dice with consistent lighting-free material detail.`,
    '',
    '## Numbered Atlas Prompt (Experimental)',
    '',
    `Use the attached clean Daisu ${layout.label} UV template as a strict layout guide and the labeled guide only for face mapping. Generate a finished dice texture atlas for ${material}. Preserve every UV island position, size, rotation, and outline exactly. Put each face value inside its matching gold safe zone, centered and upright relative to that island. Use engraved or embossed numerals with high contrast, no extra symbols, and no copied guide labels. Hard cases must be legible at mobile size. Keep all art inside the cyan bleed areas.`,
    '',
    'Face mapping:',
    '',
    faceMap,
    '',
    '## Negative Prompt',
    '',
    'wrong numbers, missing numbers, duplicated numbers, moved UV islands, resized UV islands, rotated UV islands, labels, watermark, signature, decorative border outside islands, checkerboard background, text outside safe zones, cropped islands, seams through numerals',
    '',
    '## QA Notes',
    '',
    '- Start with the material-only prompt; deterministic numbers are safer than asking ImageGen to place all values correctly.',
    '- Check the generated atlas against the manifest before using it in runtime or Blender.',
    '- For engraved or embossed numbers, use this atlas as the albedo/style pass and bake normals from modeled/vector numerals in Blender later.',
    '',
  ].join('\n')
}

export function renderManifest(layout) {
  return {
    version: layout.version,
    shape: layout.shape,
    label: layout.label,
    canvasSize: layout.canvasSize,
    columns: layout.columns,
    rows: layout.rows,
    coordinateSystem: {
      pixels: 'SVG viewBox pixels, origin at top-left',
      uvBox: 'normalized SVG box coordinates, origin at top-left for atlas authoring',
    },
    runtimeStatus: 'ImageGen and artist workflow artifact. Standard runtime dice currently use per-face CanvasTexture materials.',
    islands: layout.islands,
  }
}

export function validateAtlas(layout) {
  const errors = []
  const spec = DICE_SPECS[layout.shape]
  const expectedFaceValues = new Set(spec.faceValues.map(String))
  const seenFaceValues = new Set()
  const seenMaterialIndexes = new Set()

  if (layout.islands.length !== spec.faceValues.length) {
    errors.push(`expected ${spec.faceValues.length} islands, got ${layout.islands.length}`)
  }

  for (const island of layout.islands) {
    const faceKey = String(island.faceValue)
    if (!expectedFaceValues.has(faceKey)) {
      errors.push(`unexpected face value ${island.faceValue}`)
    }
    if (seenFaceValues.has(faceKey)) {
      errors.push(`duplicate face value ${island.faceValue}`)
    }
    seenFaceValues.add(faceKey)

    if (typeof island.materialIndex !== 'number') {
      errors.push(`face ${island.faceValue} is missing material index`)
    } else if (seenMaterialIndexes.has(island.materialIndex)) {
      errors.push(`duplicate material index ${island.materialIndex}`)
    }
    seenMaterialIndexes.add(island.materialIndex)

    for (const point of [...island.points, ...island.safePoints]) {
      if (point.x < 0 || point.y < 0 || point.x > layout.canvasSize || point.y > layout.canvasSize) {
        errors.push(`face ${island.faceValue} has out-of-bounds point (${point.x}, ${point.y})`)
      }
    }
  }

  const boxes = layout.islands.map((island) => ({ faceValue: island.faceValue, ...island.bounds }))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        errors.push(`faces ${boxes[i].faceValue} and ${boxes[j].faceValue} overlap`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

function createIslandPoints(shape, center, radius) {
  switch (shape) {
    case 'square':
      return [
        { x: center.x - radius, y: center.y - radius },
        { x: center.x + radius, y: center.y - radius },
        { x: center.x + radius, y: center.y + radius },
        { x: center.x - radius, y: center.y + radius },
      ]
    case 'triangle':
      return regularPolygon(center, radius, 3, -Math.PI / 2)
    case 'pentagon':
      return regularPolygon(center, radius, 5, -Math.PI / 2)
    case 'kite':
      return [
        { x: center.x, y: center.y - radius },
        { x: center.x + radius * 0.58, y: center.y },
        { x: center.x, y: center.y + radius },
        { x: center.x - radius * 0.58, y: center.y },
      ]
    default:
      throw new Error(`Unknown island shape: ${shape}`)
  }
}

function regularPolygon(center, radius, sides, rotation) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (Math.PI * 2 * index) / sides
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

function scalePoints(points, center, scale) {
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }))
}

function getBounds(points) {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

function boxesOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function pointsToString(points) {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function roundPoint(point) {
  return {
    x: round(point.x),
    y: round(point.y),
  }
}

function roundBounds(bounds) {
  return {
    minX: round(bounds.minX),
    minY: round(bounds.minY),
    maxX: round(bounds.maxX),
    maxY: round(bounds.maxY),
  }
}

function round(value) {
  return Number(value.toFixed(3))
}
