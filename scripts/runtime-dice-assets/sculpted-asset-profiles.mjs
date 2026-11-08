// Separate from immutable ImageGen v1 profiles. These are download/complexity
// ceilings for the selected local sculptures, not phone performance approval.
const KiB = 1024
const MiB = 1024 * KiB
const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
const profile = (setId, name, completeSetMaxBytes, modelCaps, triangleCaps, textureMaxDimension, maxImages, maxAnimations) => Object.freeze({
  setId,
  name,
  budgets: Object.freeze({
    completeSetMaxBytes,
    thumbnailMaxBytes: 150 * KiB,
    textureMaxDimension,
    embeddedTextureMaxBytesPerDie: 4 * MiB,
    maxImages,
    maxMaterials: 7,
    maxPrimitives: setId === 'monster-dungeon-set' ? 22 : 7,
    maxAnimations,
    maxNodes: setId === 'monster-dungeon-set' ? 64 : 8,
    modelMaxBytes: Object.freeze(Object.fromEntries(shapes.map((shape, i) => [shape, modelCaps[i] * KiB]))),
    triangleMaxCounts: Object.freeze(Object.fromEntries(shapes.map((shape, i) => [shape, triangleCaps[i]]))),
  }),
})

export const SCULPTED_ASSET_PROFILES = Object.freeze({
  // 13,241,184 model bytes plus six bounded thumbnails fits 14 MiB.
  'woodland-sculpted-set': profile('woodland-sculpted-set', 'Woodland Sculpted', 14 * MiB,
    [1216, 1152, 1792, 1216, 1280, 6464], [32000, 36000, 32000, 32000, 32000, 61000], 2048, 2, 0),
  // 576,144 model bytes plus six 150 KiB thumbnails fits 1.5 MiB.
  'cyberpunk-cutline-set': profile('cyberpunk-cutline-set', 'Cyberpunk CUTLINE', 1.5 * MiB,
    [64, 64, 64, 128, 128, 256], [1000, 700, 850, 2850, 1750, 3100], 1024, 0, 0),
  // 17,889,712 model bytes plus six bounded thumbnails fits 18 MiB.
  // The old staging 20 MiB cap is not reused as device qualification.
  'monster-dungeon-set': profile('monster-dungeon-set', 'Monster Dungeon', 18 * MiB,
    [960, 6656, 1024, 1024, 5440, 2560], [15000, 149000, 17000, 29000, 77000, 72000], 1024, 10, 22),
})

export const SCULPTED_SOURCE_RECORD_FILE = 'sculpted-worlds-v1.source.json'
