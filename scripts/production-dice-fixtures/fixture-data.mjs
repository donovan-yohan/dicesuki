export const D6_FACE_NORMALS = [
  { value: 1, normal: [0, -1, 0] },
  { value: 2, normal: [0, 0, 1] },
  { value: 3, normal: [1, 0, 0] },
  { value: 4, normal: [-1, 0, 0] },
  { value: 5, normal: [0, 0, -1] },
  { value: 6, normal: [0, 1, 0] },
]

export const D20_FACE_NORMALS = [
  { value: 1, normal: [-0.5774, 0.5774, 0.5774] },
  { value: 2, normal: [0, 0.9342, 0.3568] },
  { value: 3, normal: [0, 0.9342, -0.3568] },
  { value: 4, normal: [-0.5774, 0.5774, -0.5774] },
  { value: 5, normal: [-0.9342, 0.3568, 0] },
  { value: 6, normal: [0.5774, 0.5774, 0.5774] },
  { value: 7, normal: [-0.3568, 0, 0.9342] },
  { value: 8, normal: [-0.9342, -0.3568, 0] },
  { value: 9, normal: [-0.3568, 0, -0.9342] },
  { value: 10, normal: [0.5774, 0.5774, -0.5774] },
  { value: 17, normal: [0.5774, -0.5774, 0.5774] },
  { value: 18, normal: [0, -0.9342, 0.3568] },
  { value: 19, normal: [0, -0.9342, -0.3568] },
  { value: 20, normal: [0.5774, -0.5774, -0.5774] },
  { value: 16, normal: [0.9342, -0.3568, 0] },
  { value: 12, normal: [0.3568, 0, 0.9342] },
  { value: 11, normal: [-0.5774, -0.5774, 0.5774] },
  { value: 15, normal: [-0.5774, -0.5774, -0.5774] },
  { value: 14, normal: [0.3568, 0, -0.9342] },
  { value: 13, normal: [0.9342, 0.3568, 0] },
]

export const PRODUCTION_FIXTURE_SETS = [
  {
    id: 'fantasy-set',
    name: 'Fantasy Test Collection',
    artist: 'Daisu Procedural Fixtures',
    description: 'Lightweight fantasy dice for inventory, GLB, and face-number alignment testing.',
    releaseDate: '2026-07-09',
    tags: ['fantasy', 'test-fixture', 'procedural'],
    availability: 'always',
    dice: [
      {
        id: 'emerald-d20',
        diceType: 'd20',
        name: 'Emerald Quest D20',
        rarity: 'rare',
        description: 'A green-and-gold D20 fixture with raised trim, inset panels, and beveled numerals.',
        bodyColor: '#c9a227',
        panelColor: '#123f2a',
        trimColor: '#f2d46b',
        numberColor: '#fff1a8',
        material: {
          roughness: 0.34,
          metalness: 0.82,
        },
      },
      {
        id: 'aurelian-imagegen-d20',
        diceType: 'd20',
        name: 'Aurelian Sapphire D20',
        artist: 'Codex ImageGen via Daisu UV Workflow',
        rarity: 'epic',
        description: 'An ornate antique-gold and sapphire D20 authored by Codex ImageGen from the canonical numbered mesh UV template.',
        bodyColor: '#172033',
        panelColor: '#0b3155',
        trimColor: '#d6a84b',
        numberColor: '#f4d68a',
        imagegenAtlas: {
          atlasPath: 'public/artist-resources/imagegen-uv/d20-imagegen/antique-gold-blue-enamel-imagegen-v2-edge-aligned.png',
          normalMapPath: 'public/artist-resources/imagegen-uv/d20-imagegen/antique-gold-blue-enamel-normal-v2-edge-aligned.png',
          manifestPath: 'public/artist-resources/imagegen-uv/d20-imagegen/d20-mesh-uv-manifest.json',
        },
        material: {
          roughness: 0.38,
          metalness: 0.58,
        },
      },
      {
        id: 'rune-d6',
        diceType: 'd6',
        name: 'Rune Box D6',
        rarity: 'uncommon',
        description: 'A compact purple-and-gold D6 fixture with raised trim and beveled numerals.',
        bodyColor: '#d2a83a',
        panelColor: '#581c87',
        trimColor: '#f6d978',
        numberColor: '#fff7c2',
        material: {
          roughness: 0.32,
          metalness: 0.86,
        },
      },
    ],
  },
  {
    id: 'dungeon-set',
    name: 'Dungeon Test Collection',
    artist: 'Daisu Procedural Fixtures',
    description: 'Stone and iron dice for checking production inventory loading with generic dungeon art direction.',
    releaseDate: '2026-07-09',
    tags: ['dungeon', 'test-fixture', 'procedural'],
    availability: 'always',
    dice: [
      {
        id: 'stone-d20',
        diceType: 'd20',
        name: 'Stone Door D20',
        rarity: 'common',
        description: 'A dungeon-stone D20 fixture with bronze trim, inset slate panels, and raised numerals.',
        bodyColor: '#8a6a37',
        panelColor: '#374151',
        trimColor: '#c49a4a',
        numberColor: '#f8e7bd',
        material: {
          roughness: 0.58,
          metalness: 0.45,
        },
      },
      {
        id: 'iron-d6',
        diceType: 'd6',
        name: 'Iron Lock D6',
        rarity: 'uncommon',
        description: 'A dark iron D6 fixture with blue inset panels and polished silver numerals.',
        bodyColor: '#242a33',
        panelColor: '#1d4ed8',
        trimColor: '#cbd5e1',
        numberColor: '#f8fafc',
        material: {
          roughness: 0.3,
          metalness: 0.78,
        },
      },
    ],
  },
]

export function getFixtureFaceNormals(diceType) {
  switch (diceType) {
    case 'd6':
      return D6_FACE_NORMALS
    case 'd20':
      return D20_FACE_NORMALS
    default:
      throw new Error(`Unsupported fixture dice type: ${diceType}`)
  }
}

export function getFixtureDiceList() {
  return PRODUCTION_FIXTURE_SETS.flatMap((set) => {
    return set.dice.map((die) => ({
      set,
      die,
    }))
  })
}
