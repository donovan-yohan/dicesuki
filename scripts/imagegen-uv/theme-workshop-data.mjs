export const THEME_WORKSHOP_RELEASE_DATE = '2026-07-10'

export const THEME_WORKSHOP_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

export const THEME_WORKSHOP = [
  {
    id: 'cozy-forest',
    themeId: 'critter-forest',
    setId: 'cozy-forest-imagegen-set',
    name: 'Cozy Forest Relics',
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
    description: 'Black stone and iron dice with blood-red inlay, fortress trim, and deeply engraved gothic numerals.',
    tags: ['dark-dungeon', 'stone', 'iron', 'gothic', 'codex-imagegen'],
    materialPrompt: 'chipped black basalt and gunmetal edge cages around dark oxblood enamel face panels, tarnished iron corner rivets, sparse fortress and chain filigree, deeply engraved pale silver gothic Arabic numerals with dark recesses, weighty premium dungeon dice, grim and legible without skull icons',
    material: { roughness: 0.62, metalness: 0.5, normalScale: 0.82 },
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
]

export function getThemeWorkshopEntry(themeId) {
  const entry = THEME_WORKSHOP.find((theme) => theme.id === themeId)
  if (!entry) throw new Error(`Unknown workshop theme: ${themeId}`)
  return entry
}

export function getThemeAtlasPaths(themeId, shape) {
  const base = `public/artist-resources/imagegen-uv/theme-sets/${themeId}/${shape}`
  return {
    directory: base,
    atlas: `${base}/${themeId}-${shape}-imagegen-atlas.png`,
    normal: `${base}/${themeId}-${shape}-normal.png`,
    prompt: `${base}/${themeId}-${shape}-prompt.md`,
  }
}

export function getEnvironmentTexturePaths(themeId) {
  const base = `public/textures/themes/${themeId}`
  return {
    directory: base,
    floorAlbedo: `${base}/floor-albedo.png`,
    floorNormal: `${base}/floor-normal.png`,
    wallAlbedo: `${base}/wall-albedo.png`,
    wallNormal: `${base}/wall-normal.png`,
    skybox: `${base}/skybox-equirectangular.png`,
    prompts: `${base}/imagegen-prompts.md`,
  }
}
