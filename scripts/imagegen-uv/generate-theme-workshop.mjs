#!/usr/bin/env node

/**
 * Step 1 of the themed dice pipeline: generate the ImageGen authoring kit.
 *
 * Resurrected from commit 7393d112c5e062570ec7caf37970206c4d05c08c and adapted
 * to current `main`:
 *
 * - The theme-agnostic numbered edit targets are no longer re-implemented here.
 *   They are produced by `generateAuthoringKit()` from
 *   `generate-authoring-kit.mjs`, i.e. by the same canonical-contract-v2 code
 *   path `npm run generate:imagegen-uv` uses. One renderer, no drift.
 * - Everything is written under `.artifacts/theme-workshop/` (gitignored)
 *   instead of `public/`, per the authoring boundary on `main`.
 *
 * This step is fully deterministic and safe to re-run: it only ever writes
 * generated prompts, READMEs, and the canonical template kit. Raw art dropped
 * into a theme's shape directory is never touched.
 *
 * Usage:
 *   node scripts/imagegen-uv/generate-theme-workshop.mjs [--theme fantasy-earth]
 *        [--rasterize] [--out DIR] [--validate-only]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCanonicalDiceManifest } from './canonical-dice-contract.mjs'
import { generateAuthoringKit, validateAuthoringKit } from './generate-authoring-kit.mjs'
import {
  getEnvironmentTexturePaths,
  getProofFace,
  getTemplateRoot,
  getThemeAtlasPaths,
  selectThemes,
  THEME_WORKSHOP_ROOT,
  THEME_WORKSHOP_SHAPES,
  resolveWorkshopRoot,
} from './theme-workshop-data.mjs'

export async function generateThemeWorkshop(options = {}) {
  const root = options.root ?? THEME_WORKSHOP_ROOT
  const themes = selectThemes(options.themes)
  const rasterize = Boolean(options.rasterize)

  const kit = await generateAuthoringKit({
    outputDir: getTemplateRoot(root),
    rasterize,
  })

  const manifests = new Map(THEME_WORKSHOP_SHAPES.map((shape) => [shape, createCanonicalDiceManifest(shape)]))
  const written = []

  for (const theme of themes) {
    const environment = getEnvironmentTexturePaths(theme.id, root)
    await mkdir(environment.directory, { recursive: true })
    await writeFile(environment.prompts, renderEnvironmentPromptPack(theme), 'utf8')
    written.push(environment.prompts)

    for (const shape of THEME_WORKSHOP_SHAPES) {
      const paths = getThemeAtlasPaths(theme.id, shape, root)
      await mkdir(paths.directory, { recursive: true })
      await writeFile(paths.prompt, renderDicePrompt(theme, manifests.get(shape)), 'utf8')
      written.push(paths.prompt)
    }

    const readmePath = path.join(root, theme.id, 'README.md')
    await writeFile(readmePath, renderThemeReadme(theme, root), 'utf8')
    written.push(readmePath)
  }

  await mkdir(root, { recursive: true })
  const indexPath = path.join(root, 'INDEX.md')
  await writeFile(indexPath, renderWorkshopIndex(themes, rasterize), 'utf8')
  written.push(indexPath)

  const validation = await validateThemeWorkshop({ root, themes: themes.map((theme) => theme.id), rasterize })
  if (!validation.valid) {
    throw new Error(`Generated theme workshop is invalid:\n${validation.errors.join('\n')}`)
  }

  return { root, templateRoot: kit.outputDir, themes: themes.map((theme) => theme.id), rasterize, written }
}

export async function validateThemeWorkshop(options = {}) {
  const root = options.root ?? THEME_WORKSHOP_ROOT
  const themes = selectThemes(options.themes)
  const rasterize = Boolean(options.rasterize)
  const errors = []

  const kitValidation = await validateAuthoringKit({ outputDir: getTemplateRoot(root), rasterize })
  errors.push(...kitValidation.errors.map((error) => `templates: ${error}`))

  const manifests = new Map(THEME_WORKSHOP_SHAPES.map((shape) => [shape, createCanonicalDiceManifest(shape)]))

  for (const theme of themes) {
    const environment = getEnvironmentTexturePaths(theme.id, root)
    errors.push(...await compareFile(environment.prompts, renderEnvironmentPromptPack(theme), theme.id))
    errors.push(...await compareFile(
      path.join(root, theme.id, 'README.md'),
      renderThemeReadme(theme, root),
      theme.id,
    ))
    for (const shape of THEME_WORKSHOP_SHAPES) {
      const paths = getThemeAtlasPaths(theme.id, shape, root)
      errors.push(...await compareFile(paths.prompt, renderDicePrompt(theme, manifests.get(shape)), theme.id))
    }
  }

  errors.push(...await compareFile(path.join(root, 'INDEX.md'), renderWorkshopIndex(themes, rasterize), 'workshop'))
  return { valid: errors.length === 0, errors, root, themes: themes.map((theme) => theme.id) }
}

async function compareFile(filePath, expected, label) {
  try {
    const actual = await readFile(filePath, 'utf8')
    return actual === expected ? [] : [`${label}: ${filePath} does not match its generated content`]
  } catch (error) {
    return [`${label}: cannot read ${filePath} (${error.message})`]
  }
}

export function renderDicePrompt(theme, manifest) {
  const values = manifest.faceValues.join(', ')
  const d10Rules = manifest.shape === 'd10'
    ? '\nD10 geometry contract: exactly ten complete kite islands for values 0 through 9. Each visible kite is one physical face made from two mesh triangles that share this same atlas island. Never split a kite into independent triangular designs.'
    : ''
  return `# ${theme.name} ${manifest.label} Codex ImageGen Edit Prompt

Use case: style-transfer
Asset type: production UV texture atlas for a ${manifest.label} polyhedral die
Primary request: Transform the attached numbered ${manifest.label} UV edit target into ${theme.materialPrompt}.
Input images: Image 1 is the exact numbered edit target and spatial contract (\`templates/${manifest.shape}/imagegen-input.png\`). Image 2 is the labeled guide showing each canonical baseline edge (\`templates/${manifest.shape}/numbered-guide.png\`). Any additional theme images are style references only.
Composition/framing: Keep a flat square UV atlas, not a rendered die and not a perspective scene. Preserve every island position, size, shape, and rotation exactly.
Text: Preserve exactly one of each Arabic face value in this exact set: ${values}. Keep each value on its original island. Transform the placeholder type into bespoke themed numeral artwork rather than retaining the reference font.
Orientation: Preserve the exact rotation of every numeral from Image 1. Its baseline must remain parallel to the orange canonical edge shown for that island in Image 2. Do not rotate all numbers upright.
Materials/textures: ${theme.materialPrompt}.
Constraints: Keep trim, face panel, ornament, and numeral entirely inside each island. Maintain generous seam bleed to the island edge. Use lighting-free material detail suitable for a PBR base-color map. Keep the outside background near-black and visually quiet.${d10Rules}
Avoid: missing values, duplicated values, wrong values, Roman numerals, pips, extra letters, runes replacing numbers, symbols that resemble numbers, moved islands, resized islands, altered outlines, cropped islands, art crossing island gaps, perspective, a photographed die, cast shadows, watermark, signature.

Save the result as \`${theme.id}-${manifest.shape}-imagegen-atlas-raw.png\` beside this prompt. \`register:theme-atlases\` reads that exact filename; the normal-map and bake steps then consume what registration writes.
`
}

export function renderEnvironmentPromptPack(theme) {
  return `# ${theme.name} Environment Codex ImageGen Prompts

## Floor albedo

Use case: stylized-concept
Asset type: seamless PBR base-color texture for a Three.js dice-box floor
Primary request: ${theme.environment.floorPrompt}
Constraints: square texture; material-only; no directional cast shadow; no baked highlights; no text or watermark.
Save as: \`floor-albedo.png\`

## Wall albedo

Use case: stylized-concept
Asset type: seamless PBR base-color texture for Three.js dice-box walls
Primary request: ${theme.environment.wallPrompt}
Constraints: square texture; material-only; no directional cast shadow; no baked highlights; no text or watermark.
Save as: \`wall-albedo.png\`

## Skybox

Use case: stylized-concept
Asset type: equirectangular skybox panorama for a Three.js dice environment
Primary request: ${theme.environment.skyboxPrompt}
Composition/framing: 2:1 panoramic composition with the horizon at mid-height and useful detail across the full width.
Constraints: no close foreground object; no readable text; no watermark; left and right edges should join continuously.
Save as: \`skybox-equirectangular.png\`

The matching \`floor-normal.png\` and \`wall-normal.png\` are derived automatically by
\`npm run generate:theme-normal-maps -- --theme ${theme.id}\`; do not author them by hand.
`
}

export function renderThemeReadme(theme, root = THEME_WORKSHOP_ROOT) {
  const dice = THEME_WORKSHOP_SHAPES.map((shape) => {
    const die = theme.dice[shape]
    return `| ${shape.toUpperCase()} | \`${die.id}\` | ${die.name} | ${getProofFace(shape)} | \`${shape}/${theme.id}-${shape}-prompt.md\` |`
  }).join('\n')

  return `# ${theme.name} (\`${theme.id}\`)

- Set id: \`${theme.setId}\`
- Runtime theme id: \`${theme.themeId}\`
- Status: ${theme.status}
- Release date: ${theme.releaseDate}

${theme.description}

| Shape | Dice id | Display name | Proof face | Prompt |
|---|---|---|---|---|
${dice}

## Art pass (manual — the only human step)

For each shape:

1. Open \`${path.join(root, theme.id)}/<shape>/${theme.id}-<shape>-prompt.md\`.
2. Attach \`${getTemplateRoot(root)}/<shape>/imagegen-input.png\` as image 1 and
   \`${getTemplateRoot(root)}/<shape>/numbered-guide.png\` as image 2.
3. Run the prompt through Codex ImageGen in style-transfer / image-to-image mode.
4. Save the returned 2048x2048 PNG as
   \`${path.join(root, theme.id)}/<shape>/${theme.id}-<shape>-imagegen-atlas-raw.png\`.

Optionally repeat for the three environment textures described in
\`environment/imagegen-prompts.md\`.

## Automated steps once the art lands

\`\`\`bash
npm run register:theme-atlases   -- --theme ${theme.id}
npm run generate:theme-normal-maps -- --theme ${theme.id}
npm run bake:theme-dice-sets     -- --theme ${theme.id}
npm run capture:theme-proofs     -- --theme ${theme.id}
\`\`\`

See \`docs/guides/dice-set-authoring.md\` for the full recipe including release,
lock, and runtime promotion.
`
}

export function renderWorkshopIndex(themes, rasterize) {
  return [
    '# Dicesuki themed ImageGen dice workshop',
    '',
    'Generated by `npm run generate:theme-workshop`. Local authoring output only —',
    'this tree is gitignored and must never be committed or deployed.',
    '',
    `Canonical shape kits: \`templates/<shape>/\` (${rasterize ? 'SVG + PNG' : 'SVG only; re-run with --rasterize for PNGs'}).`,
    '',
    '| Theme | Set id | Status | Kit |',
    '|---|---|---|---|',
    ...themes.map((theme) => `| ${theme.name} | \`${theme.setId}\` | ${theme.status} | [README](${theme.id}/README.md) |`),
    '',
    'Pipeline: workshop → manual ImageGen art pass → `register:theme-atlases` →',
    '`generate:theme-normal-maps` → `bake:theme-dice-sets` → `capture:theme-proofs` →',
    'release archive + lock → `build:runtime-dice-assets`.',
    '',
  ].join('\n')
}

function parseArgs(argv) {
  const options = { themes: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--theme') options.themes.push(argv[++index])
    else if (argument === '--out') options.root = resolveWorkshopRoot(argv[++index])
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
    console.log('Usage: node scripts/imagegen-uv/generate-theme-workshop.mjs [--theme ID] [--rasterize] [--out DIR] [--validate-only]')
    return
  }
  if (options.validateOnly) {
    const validation = await validateThemeWorkshop(options)
    if (!validation.valid) throw new Error(validation.errors.join('\n'))
    console.log(`Validated theme workshop for ${validation.themes.join(', ')}`)
    return
  }
  const result = await generateThemeWorkshop(options)
  console.log(
    `Generated ${result.themes.length} themed ImageGen kit(s) (${result.themes.join(', ')}) `
    + `across ${THEME_WORKSHOP_SHAPES.length} shapes in ${result.root}`,
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
