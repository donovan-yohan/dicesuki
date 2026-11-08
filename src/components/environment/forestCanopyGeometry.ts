import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshLambertMaterial, MeshToonMaterial, type Texture } from 'three'

export interface ForestCanopyOptions {
  halfX: number
  halfZ: number
  groundY: number
  tier: 'low' | 'mid' | 'high'
  seed: number
  time: { value: number }
  gradientMap?: Texture
}

type Point = [number, number, number]

function randomFrom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Static geometry deliberately shares the native depth pass: no wind/shadow mismatch. */
export function createForestCanopy({ halfX, halfZ, groundY, tier, seed, gradientMap }: ForestCanopyOptions): Mesh<BufferGeometry, MeshLambertMaterial | MeshToonMaterial> {
  const positions: number[] = []
  const colors: number[] = []
  const palette = (gradientMap
    ? ['#7f9d85', '#8ca98c', '#9bb696', '#abc29f', '#bbcda7', '#cad7b1', '#d7dfbc']
    : ['#304c43', '#3d5c49', '#4f7055', '#628363', '#76956c', '#8ba776', '#a1b57f']).map(hex => new Color(hex))
  const scale = Math.min(1, Math.min(halfX, halfZ) / 3)
  const triangle = (a: Point, b: Point, c: Point, tone: number) => {
    // All visible facets face the overhead camera, including reflected edge frames.
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    if (up < 0) positions.push(...a, ...c, ...b)
    else positions.push(...a, ...b, ...c)
    const color = palette[tone % palette.length]
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b)
  }
  for (let side = 0; side < 4; side++) {
    // Side streams never consume grass, flowers or their global randomness.
    const random = randomFrom(seed ^ 0x5a7c31d9 ^ Math.imul(side + 1, 0x45d9f3b))
    const half = side < 2 ? halfX : halfZ
    const spanHalf = side < 2 ? halfZ : halfX
    const sign = side % 2 === 0 ? -1 : 1
    const crowns = 2 + Math.floor(random() * 2)
    for (let crown = 0; crown < crowns; crown++) {
      const center = (-0.76 + crown / (crowns - 1) * 1.52 + (random() - 0.5) * 0.24) * spanHalf
      const tangentRadius = Math.min((1.15 + random() * 0.75) * scale, spanHalf + 0.78 * scale - Math.abs(center))
      const intrusion = 0.38 + random() * 0.22
      const yaw = random() * Math.PI * 2
      // Smooth saturation, never hard vertex clipping (which collapses triangles).
      const point = (u: number, v: number, height: number): Point => {
        const tangent = center + tangentRadius * Math.tanh(u)
        const normal = sign * (half + scale * (-0.04 + 0.8 * Math.tanh(v + intrusion)))
        return side < 2 ? [normal, groundY + height, tangent] : [tangent, groundY + height, normal]
      }
      const sectors = 18
      const hub = point(0, 0, 2.5)
      const rim = Array.from({ length: sectors }, (_, i) => {
        const angle = i / sectors * Math.PI * 2
        const radius = 0.94 + Math.sin(angle * 5 + yaw) * 0.16 + Math.cos(angle * 3 + crown) * 0.09
        return point(Math.cos(angle) * radius, Math.sin(angle) * radius * 1.7, 2.07 + Math.sin(angle * 3) * 0.08)
      })
      for (let i = 0; i < sectors; i++) triangle(hub, rim[i], rim[(i + 1) % sectors], (i + crown) % 3)
      const sprays = { low: 12, mid: 20, high: 28 }[tier]
      for (let leaf = 0; leaf < sprays; leaf++) {
        const angle = leaf * 2.399 + yaw
        const radius = 0.12 + (leaf % 3) * 0.15
        const u = Math.cos(angle) * radius, v = Math.sin(angle) * radius
        const length = 0.65 + random() * 0.42
        const width = 0.2 + random() * 0.09
        const height = 2.38 + (leaf % 3) * 0.11
        const at = (along: number, across: number, rise: number) => point(
          u + Math.cos(angle) * along - Math.sin(angle) * across,
          v + Math.sin(angle) * along + Math.cos(angle) * across,
          height + rise,
        )
        const base = at(0, 0, 0), left = at(length * 0.47, -width, 0.01)
        const rib = at(length * 0.5, 0, 0.12), right = at(length * 0.47, width, 0.01)
        const tip = at(length, 0, 0.055)
        const tone = 2 + (leaf + crown + side) % 4
        triangle(base, left, rib, tone)
        triangle(base, rib, right, tone + 1)
        triangle(left, tip, rib, tone)
        triangle(rib, tip, right, tone + 1)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  // The shared ramp stays caller-owned; Material.dispose never disposes textures.
  const material = gradientMap
    ? new MeshToonMaterial({ vertexColors: true, gradientMap })
    : new MeshLambertMaterial({ vertexColors: true })
  // Thin upward sheets must cast from either light direction in the depth pass.
  material.shadowSide = DoubleSide
  const mesh = new Mesh(geometry, material)
  mesh.name = 'woodland-canopy'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.raycast = () => {}
  return mesh
}
