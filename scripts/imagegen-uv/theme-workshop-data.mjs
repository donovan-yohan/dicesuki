/**
 * Theme-set definitions for the ImageGen UV dice workshop.
 *
 * Resurrected from commit 7393d112c5e062570ec7caf37970206c4d05c08c (branch
 * `codex/imagegen-uv-dice-reconcile`, release tags `imagegen-*-authoring-v1`).
 *
 * Two things changed versus the archived original:
 *
 * 1. Shapes now come from `canonical-dice-contract.mjs` (canonical-contract-v2)
 *    instead of a local literal list, so the workshop can never drift from the
 *    contract that `npm run generate:imagegen-uv` validates against.
 * 2. Every workshop path now resolves under `.artifacts/` instead of `public/`.
 *    `scripts/imagegen-uv/check-authoring-boundary.mjs` rejects binary authoring
 *    payloads anywhere git can see them, and `generate-authoring-kit.mjs`
 *    refuses to write outside `.artifacts/`. Raw art, registered atlases,
 *    derived normal maps, and baked GLBs are therefore local-only; they reach
 *    the repo through a checksum-locked release archive plus
 *    `scripts/runtime-dice-assets/optimize.mjs`.
 */

import path from 'node:path'

import { SUPPORTED_DICE_SHAPES } from './canonical-dice-contract.mjs'
import { assertSafeOutputDirectory } from './generate-authoring-kit.mjs'

/** Root for every generated workshop artifact. Gitignored; never deployed. */
export const THEME_WORKSHOP_ROOT = '.artifacts/theme-workshop'

/**
 * Sub-directory holding the theme-agnostic canonical shape kits. Produced by
 * `generateAuthoringKit()` so the workshop and `npm run generate:imagegen-uv`
 * emit byte-identical edit targets.
 */
export const THEME_WORKSHOP_TEMPLATE_DIRNAME = 'templates'

/** Canonical shapes a complete themed set must cover. */
export const THEME_WORKSHOP_SHAPES = Object.freeze([...SUPPORTED_DICE_SHAPES])

/**
 * Proof face rendered for each shape's thumbnail. Mirrors the `proofFace`
 * values already locked into `scripts/runtime-dice-assets/runtime-asset-profiles.mjs`.
 */
const PROOF_FACES = Object.freeze({ d4: 4, d6: 6, d8: 8, d10: 9, d12: 12, d20: 20 })

/** Mesh radius per shape, preserved from the archived bake script. */
const BAKE_RADII = Object.freeze({ d4: 0.72, d6: 1, d8: 0.72, d10: 0.72, d12: 0.72, d20: 0.72 })

/** Rarity ladder per shape, preserved from the archived bake script. */
const BAKE_RARITIES = Object.freeze({
  d4: 'uncommon',
  d6: 'uncommon',
  d8: 'uncommon',
  d10: 'rare',
  d12: 'rare',
  d20: 'epic',
})

export const THEME_WORKSHOP_ARTIST = 'Codex ImageGen via Daisu UV Workflow'

/**
 * Default relief gain for the tileable environment textures. Themes override it
 * via `environmentNormalStrength` when their surfaces need deeper relief.
 */
export const DEFAULT_ENVIRONMENT_NORMAL_STRENGTH = Object.freeze({ floor: 7, wall: 7.5 })

/**
 * Opaque field every proof render and runtime thumbnail sits on. Sampled from
 * the corner pixel of the released thumbnails under
 * `public/dice/cozy-forest-imagegen-set` — slate-900, `#0f172a`.
 *
 * `capture-thumbnails.mjs` performs no flatten, so the proof PNG must already be
 * opaque or runtime thumbnails would ship with an alpha channel the released
 * sets do not have.
 */
export const PROOF_BACKGROUND_RGB = Object.freeze({ r: 15, g: 23, b: 42 })

/**
 * Fraction of the 720px proof frame the subject's longest axis spans.
 *
 * The runtime thumbnail is a 512px crop of the 720px proof, so a subject
 * spanning `f` of the proof frame fills `f * 720 / 512` of the thumbnail.
 *
 * Calibrated against the released sets, whose thumbnails fill 0.86–1.00 of the
 * 320px frame (mean 0.939; the d10 and d12 reach 1.00 because they are clipped
 * by the crop). 0.667 puts every shape at 0.938 — mean parity within 0.1%, and
 * consistent across shapes rather than reproducing the released spread, which
 * came from a fixed-camera scene rather than a fitted frame.
 */
export const PROOF_SUBJECT_FILL = 0.667

export const THEME_WORKSHOP = Object.freeze([
  {
    id: 'cozy-forest',
    themeId: 'critter-forest',
    setId: 'cozy-forest-imagegen-set',
    name: 'Cozy Forest Relics',
    releaseDate: '2026-07-10',
    status: 'released',
    description: 'Warm woodland dice with carved vine trim, mossy enamel panels, and softly raised heirloom numerals.',
    tags: ['cozy-forest', 'woodland', 'moss', 'brass', 'codex-imagegen'],
    materialPrompt: 'warm carved walnut and aged honey-brass edge trim around deep moss-green enamel panels, tiny fern and acorn filigree in the corners, softly raised cream-gold storybook calligraphic Arabic numerals, handcrafted heirloom fantasy dice, inviting and refined rather than cute or cartoony',
    material: { roughness: 0.48, metalness: 0.34, normalScale: 0.62 },
    physics: { density: 0.38, restitution: 0.3, friction: 0.7 },
    environment: {
      floorPrompt: 'seamless square top-down material texture of a luxurious tabletop dice tray floor made from dense emerald moss, tiny clover, pressed fern fragments, and subtle dark walnut root inlays; tactile natural fibers, warm cozy forest craftsmanship, even lighting, orthographic, no horizon, no objects, no dice, no text, no frame, tileable edges',
      wallPrompt: 'seamless square front-facing material texture of an enchanted cozy forest dice box wall made from interwoven walnut roots and bark panels, restrained aged brass vine trim, small moss pockets and a few softly luminous amber mushrooms; detailed handcrafted relief, even lighting, no perspective, no objects, no dice, no text, tileable edges',
      skyboxPrompt: 'wide seamless 360 degree equirectangular environment panorama from the center of a cozy ancient forest clearing at golden hour, towering trunks and arching canopy, warm lantern-like fireflies, soft mist between roots, detailed but calm, horizon centered, continuous left and right seam, no people, no creatures, no dice, no text, no watermark',
    },
    dice: {
      d4: { id: 'mossheart-d4', name: 'Mossheart D4' },
      d6: { id: 'hearthwood-d6', name: 'Hearthwood D6' },
      d8: { id: 'fernlight-d8', name: 'Fernlight D8' },
      d10: { id: 'acorn-compass-d10', name: 'Acorn Compass D10' },
      d12: { id: 'grovekeeper-d12', name: 'Grovekeeper D12' },
      d20: { id: 'elder-canopy-d20', name: 'Elder Canopy D20' },
    },
  },
  {
    id: 'dark-dungeon',
    themeId: 'dungeon-castle',
    setId: 'dark-dungeon-imagegen-set',
    name: 'Dark Dungeon Armory',
    releaseDate: '2026-07-10',
    status: 'released',
    description: 'Black stone and iron dice with blood-red inlay, fortress trim, and deeply engraved gothic numerals.',
    tags: ['dark-dungeon', 'stone', 'iron', 'gothic', 'codex-imagegen'],
    materialPrompt: 'chipped black basalt and gunmetal edge cages around dark oxblood enamel face panels, tarnished iron corner rivets, sparse fortress and chain filigree, deeply engraved pale silver gothic Arabic numerals with dark recesses, weighty premium dungeon dice, grim and legible without skull icons',
    material: { roughness: 0.62, metalness: 0.5, normalScale: 0.82 },
    // Rough basalt and forged iron need deeper relief than the other themes.
    environmentNormalStrength: { floor: 9, wall: 10 },
    physics: { density: 0.62, restitution: 0.24, friction: 0.76 },
    environment: {
      floorPrompt: 'seamless square top-down material texture of an ancient dungeon dice box floor built from uneven charcoal basalt flagstones, narrow iron drainage channels, hairline cracks, faint dried rust and restrained ember-red rune inlay; physically plausible rough stone, even lighting, orthographic, no horizon, no objects, no dice, no text, tileable edges',
      wallPrompt: 'seamless square front-facing material texture of a dark dungeon wall made from massive soot-black stone blocks, forged iron ribs and rivets, occasional narrow oxblood enamel rune channels, damp mineral staining; high-relief fortress masonry, even lighting, no perspective, no torches, no objects, no dice, no text, tileable edges',
      skyboxPrompt: 'wide seamless 360 degree equirectangular environment panorama from the center of a vast dark dungeon chamber, gothic stone vaults, distant iron gates, sparse warm torchlight and deep cool shadows, atmospheric depth but readable architecture, horizon centered, continuous left and right seam, no people, no creatures, no dice, no text, no watermark',
    },
    dice: {
      d4: { id: 'cinder-spike-d4', name: 'Cinder Spike D4' },
      d6: { id: 'iron-vault-d6', name: 'Iron Vault D6' },
      d8: { id: 'obsidian-fang-d8', name: 'Obsidian Fang D8' },
      d10: { id: 'gaoler-key-d10', name: 'Gaoler Key D10' },
      d12: { id: 'crypt-seal-d12', name: 'Crypt Seal D12' },
      d20: { id: 'dread-gate-d20', name: 'Dread Gate D20' },
    },
  },
  {
    id: 'cyberpunk-box',
    themeId: 'neon-cyber-city',
    setId: 'cyberpunk-imagegen-set',
    name: 'Neon Street Overdrive',
    releaseDate: '2026-07-10',
    status: 'released',
    description: 'Cel-shaded street-tech polyhedra with electric-yellow armor, cyan data lights, and hot-magenta hazard graphics.',
    tags: ['cyberpunk', 'street-tech', 'anime', 'neon', 'hazard', 'codex-imagegen'],
    materialPrompt: 'original high-energy anime cyberpunk street-tech dice with electric-yellow armored edge frames, deep indigo enamel face panels, saturated cyan data-light channels, hot-magenta and vivid-red hazard chevrons, asymmetric cable and service motifs, crisp cel-shaded ink detail, chipped paint and urban grime, bold bespoke angular technical Arabic numerals, rebellious megacity equipment rather than alien or spacecraft technology',
    material: { roughness: 0.38, metalness: 0.55, normalScale: 0.72 },
    physics: { density: 0.52, restitution: 0.36, friction: 0.52 },
    environment: {
      floorPrompt: 'seamless square top-down material texture of an original cel-shaded anime cyberpunk street-tech floor, painted urban concrete and composite plates in electric safety yellow, acid lime, hot magenta, vivid red, cyan light lanes and deep indigo, asymmetric cable channels, hazard chevrons, abstract service decals and chipped street grime, energetic megacity infrastructure rather than spacecraft plating, even lighting, orthographic, no horizon, no readable text, no objects, no dice, tileable edges',
      wallPrompt: 'seamless square front-facing material texture of an original cel-shaded anime cyberpunk megacity service wall, electric-yellow and vivid-red access panels, deep indigo structure, exposed cable bundles, cyan data rails, hot-magenta light strips, hazard bars, vents, bolts and urban grime, high-energy street technology rather than an alien chamber or spacecraft bulkhead, even lighting, no perspective, no readable text, no objects, no dice, tileable edges',
      skyboxPrompt: 'wide seamless 360 degree equirectangular cel-shaded anime cyberpunk megacity panorama from an open rooftop dice arena, stacked neon towers, elevated rail lines, luminous utility bridges, giant abstract holographic color fields, rain haze and dense urban infrastructure in electric yellow, cyan, magenta, red and acid lime, horizon centered, continuous left and right seam, no people in foreground, no dice, no readable text, no logos, no watermark',
    },
    dice: {
      d4: { id: 'pulse-shard-d4', name: 'Pulse Shard D4' },
      d6: { id: 'neon-grid-d6', name: 'Neon Grid D6' },
      d8: { id: 'volt-prism-d8', name: 'Volt Prism D8' },
      d10: { id: 'cipher-core-d10', name: 'Cipher Core D10' },
      d12: { id: 'chrome-relay-d12', name: 'Chrome Relay D12' },
      d20: { id: 'overdrive-d20', name: 'Overdrive D20' },
    },
  },
  {
    // Third starter-picker set (exec plan 2026-07-28, item (e)). The albedo art
    // pass is manual and reserved for the PO; every other step is scripted.
    // Palette follows the shipped `fantasy-earth` theme tokens in
    // `src/themes/tokens.ts`: deep forest green #2d5016, moss green #4a7c2e,
    // gold #ffd700, parchment #f5e6d3, and a Cinzel/Trajan serif voice.
    id: 'fantasy-earth',
    themeId: 'fantasy-earth',
    setId: 'fantasy-earth-imagegen-set',
    name: 'Aurelian Wildwood',
    releaseDate: '2026-08-01',
    status: 'authoring',
    description: 'Gilded heartwood dice with emerald enamel panels, oathbound rune trim, and sunlit antique-gold numerals.',
    tags: ['fantasy-earth', 'high-fantasy', 'gilded', 'emerald', 'rune', 'codex-imagegen'],
    materialPrompt: 'antique gilded heartwood and warm burnished-gold edge trim around deep emerald and moss-green enamel face panels, slender engraved oath-rune borders, small oak-leaf and laurel filigree at the corners, faint parchment patina in the recesses, tall raised antique-gold Trajan-style engraved Arabic numerals with softly worn highlights, regal high-fantasy heirloom dice from an elven royal treasury, earthy and reverent rather than glossy, cartoony, or neon',
    material: { roughness: 0.42, metalness: 0.46, normalScale: 0.7 },
    physics: { density: 0.44, restitution: 0.28, friction: 0.68 },
    environment: {
      floorPrompt: 'seamless square top-down material texture of a high-fantasy dice tray floor made from oiled dark heartwood planks inlaid with burnished gold laurel filigree, soft moss-green felt panels, pressed oak leaves, and faint engraved oath runes; tactile handcrafted elven craftsmanship in forest green and antique gold, even lighting, orthographic, no horizon, no objects, no dice, no text, no frame, tileable edges',
      wallPrompt: 'seamless square front-facing material texture of a high-fantasy dice box wall built from carved heartwood panels, burnished antique-gold vine and laurel banding, inset emerald enamel cartouches, slender engraved oath runes, and aged parchment patina in the recesses; high-relief regal woodwork in forest green and gold, even lighting, no perspective, no objects, no dice, no text, tileable edges',
      skyboxPrompt: 'wide seamless 360 degree equirectangular environment panorama from the center of a sunlit ancient elven grove, colossal moss-clad oaks, gilded stone archways wrapped in ivy, shafts of warm gold light through a deep green canopy, distant rolling highlands, calm and reverent high-fantasy atmosphere, horizon centered, continuous left and right seam, no people, no creatures, no dice, no text, no watermark',
    },
    dice: {
      d4: { id: 'runeleaf-d4', name: 'Runeleaf D4' },
      d6: { id: 'oathstone-d6', name: 'Oathstone D6' },
      d8: { id: 'greenwarden-d8', name: 'Greenwarden D8' },
      d10: { id: 'sunspire-d10', name: 'Sunspire D10' },
      d12: { id: 'emerald-crown-d12', name: 'Emerald Crown D12' },
      d20: { id: 'aurelian-d20', name: 'Aurelian D20' },
    },
  },
])

export function listThemeWorkshopIds() {
  return THEME_WORKSHOP.map((theme) => theme.id)
}

export function getThemeWorkshopEntry(themeId) {
  const entry = THEME_WORKSHOP.find((theme) => theme.id === themeId)
  if (!entry) {
    throw new Error(`Unknown workshop theme: ${themeId}; expected one of ${listThemeWorkshopIds().join(', ')}`)
  }
  return entry
}

/**
 * Resolve the requested `--theme` selection, defaulting to every theme.
 * Keeps CLI behaviour identical across the register/normal-map/bake scripts.
 */
export function selectThemes(themeIds) {
  if (!themeIds?.length) return [...THEME_WORKSHOP]
  return [...new Set(themeIds)].map((themeId) => getThemeWorkshopEntry(themeId))
}

export function assertWorkshopShape(shape) {
  if (!THEME_WORKSHOP_SHAPES.includes(shape)) {
    throw new Error(`Unsupported workshop shape: ${shape}; expected one of ${THEME_WORKSHOP_SHAPES.join(', ')}`)
  }
  return shape
}

/** Canonical (theme-agnostic) shape-kit directory shared by every theme. */
export function getTemplateRoot(root = THEME_WORKSHOP_ROOT) {
  return path.join(root, THEME_WORKSHOP_TEMPLATE_DIRNAME)
}

export function getTemplatePaths(shape, root = THEME_WORKSHOP_ROOT) {
  assertWorkshopShape(shape)
  const directory = path.join(getTemplateRoot(root), shape)
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    numberedGuideSvg: path.join(directory, 'numbered-guide.svg'),
    numberedGuidePng: path.join(directory, 'numbered-guide.png'),
    imagegenInputSvg: path.join(directory, 'imagegen-input.svg'),
    imagegenInputPng: path.join(directory, 'imagegen-input.png'),
    maskSvg: path.join(directory, 'mask.svg'),
    maskPng: path.join(directory, 'mask.png'),
    canonicalPrompt: path.join(directory, 'prompt.md'),
  }
}

/**
 * Per-theme, per-shape authoring paths.
 *
 * `rawAtlas` is the file the PO saves their ImageGen edit to. `atlas` is the
 * registered (island-snapped, edge-bled) result produced by
 * `register-theme-atlases.mjs`; `normal` is derived from `atlas`.
 */
export function getThemeAtlasPaths(themeId, shape, root = THEME_WORKSHOP_ROOT) {
  const theme = getThemeWorkshopEntry(themeId)
  assertWorkshopShape(shape)
  const directory = path.join(root, theme.id, shape)
  return {
    directory,
    rawAtlas: path.join(directory, `${theme.id}-${shape}-imagegen-atlas-raw.png`),
    atlas: path.join(directory, `${theme.id}-${shape}-imagegen-atlas.png`),
    normal: path.join(directory, `${theme.id}-${shape}-normal.png`),
    prompt: path.join(directory, `${theme.id}-${shape}-prompt.md`),
  }
}

export function getEnvironmentTexturePaths(themeId, root = THEME_WORKSHOP_ROOT) {
  const theme = getThemeWorkshopEntry(themeId)
  const directory = path.join(root, theme.id, 'environment')
  return {
    directory,
    floorAlbedo: path.join(directory, 'floor-albedo.png'),
    floorNormal: path.join(directory, 'floor-normal.png'),
    wallAlbedo: path.join(directory, 'wall-albedo.png'),
    wallNormal: path.join(directory, 'wall-normal.png'),
    skybox: path.join(directory, 'skybox-equirectangular.png'),
    prompts: path.join(directory, 'imagegen-prompts.md'),
  }
}

/**
 * Bake output root for a theme.
 *
 * The layout deliberately mirrors a repository checkout so the directory can be
 * handed straight to `node scripts/runtime-dice-assets/optimize.mjs --source`
 * (which reads `<root>/public/dice/<setId>/…` and the proof captures under
 * `<root>/public/artist-resources/...`). This is an external archive layout,
 * never this checkout's deployed `public/` tree.
 */
export function getThemeSourceRoot(themeId, root = THEME_WORKSHOP_ROOT) {
  const theme = getThemeWorkshopEntry(themeId)
  return path.join(root, theme.id, 'source-root')
}

export function getThemeBakePaths(themeId, shape, root = THEME_WORKSHOP_ROOT) {
  const theme = getThemeWorkshopEntry(themeId)
  assertWorkshopShape(shape)
  const die = theme.dice[shape]
  const sourceRoot = getThemeSourceRoot(themeId, root)
  const setDirectory = path.join(sourceRoot, 'public', 'dice', theme.setId)
  const dieDirectory = path.join(setDirectory, die.id)
  return {
    sourceRoot,
    setDirectory,
    setJson: path.join(setDirectory, 'set.json'),
    dieDirectory,
    model: path.join(dieDirectory, 'model.glb'),
    metadata: path.join(dieDirectory, 'metadata.json'),
    proof: path.join(
      sourceRoot,
      'public',
      'artist-resources',
      'imagegen-uv',
      'screenshots',
      'theme-workshop',
      `${theme.id}-${die.id}-face-${getProofFace(shape)}.png`,
    ),
  }
}

/**
 * All-faces contact sheet for one die.
 *
 * Deliberately outside `source-root/` — it is a review artifact, not release
 * payload, so it stays out of the archive and out of the source lock.
 */
export function getThemeProofSheetPath(themeId, shape, root = THEME_WORKSHOP_ROOT) {
  const theme = getThemeWorkshopEntry(themeId)
  const die = theme.dice[assertWorkshopShape(shape)]
  return path.join(root, theme.id, 'proofs', `${die.id}-all-faces.png`)
}

export function getProofFace(shape) {
  return PROOF_FACES[assertWorkshopShape(shape)]
}

export function getBakeRadius(shape) {
  return BAKE_RADII[assertWorkshopShape(shape)]
}

export function getBakeRarity(shape) {
  return BAKE_RARITIES[assertWorkshopShape(shape)]
}

/** Environment relief gain for a theme, falling back to the shared default. */
export function getEnvironmentNormalStrength(theme) {
  return {
    ...DEFAULT_ENVIRONMENT_NORMAL_STRENGTH,
    ...(theme.environmentNormalStrength ?? {}),
  }
}

/**
 * Validate a `--out` override before anything writes through it.
 *
 * Reuses the authoring-kit guard so every workshop step inherits the same rule:
 * output inside the repo must stay under `.artifacts/`, and `public/`, `src/`,
 * `scripts/`, and `.git/` are never writable.
 */
export function resolveWorkshopRoot(root) {
  if (root === undefined) return THEME_WORKSHOP_ROOT
  return assertSafeOutputDirectory(root)
}
