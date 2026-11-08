import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, MeshToonMaterial, type Texture } from 'three'

export interface ForestDecorOptions {
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

/** Only final buffers are GPU resources; no temporary primitive geometries. */
function batch() {
  const positions: number[] = [], colors: number[] = [], plants: number[] = [], sway: number[] = []
  let plant: Point | undefined
  let ground = 0
  const setPlant = (value: Point, groundY: number) => { plant = value; ground = groundY }
  const triangle = (a: Point, b: Point, c: Point, shades: Color[]) => {
    for (const [i, p] of [a, b, c].entries()) {
      positions.push(...p)
      colors.push(shades[i % shades.length].r, shades[i % shades.length].g, shades[i % shades.length].b)
      if (plant) {
        plants.push(...plant)
        sway.push(Math.min(1, Math.max(0, (p[1] - ground) / 0.65)) ** 2)
      }
    }
  }
  const finish = () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    if (plants.length) {
      geometry.setAttribute('aPlant', new Float32BufferAttribute(plants, 3))
      geometry.setAttribute('aSway', new Float32BufferAttribute(sway, 1))
    }
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }
  return { triangle, finish, setPlant }
}

/** Opaque cupped blade: a raised central rib, lower shoulders and a curled tip. */
function leaf(target: ReturnType<typeof batch>, origin: Point, angle: number, length: number, width: number, rise: number, palette: Color[]) {
  const at = (distance: number, across: number, up: number): Point => [
    origin[0] + Math.cos(angle) * distance - Math.sin(angle) * across,
    origin[1] + up,
    origin[2] + Math.sin(angle) * distance + Math.cos(angle) * across,
  ]
  const left = at(length * 0.46, -width, rise * 0.46)
  const rib = at(length * 0.49, 0, rise * 0.74)
  const right = at(length * 0.46, width, rise * 0.46)
  const tip = at(length, 0, rise)
  target.triangle(origin, left, rib, [palette[0], palette[1], palette[2]])
  target.triangle(origin, rib, right, [palette[0], palette[2], palette[1]])
  target.triangle(left, tip, rib, [palette[1], palette[3], palette[2]])
  target.triangle(rib, tip, right, [palette[2], palette[3], palette[1]])
}

/** Parent owns traversal disposal and the shared clock (including reduced motion). */
export function createForestDecor({ halfX, halfZ, groundY, tier, seed, time, gradientMap }: ForestDecorOptions): Group {
  const root = new Group()
  root.name = 'woodland-forest'
  root.raycast = () => {}
  const wood = batch(), leaves = batch(), flowers = batch()
  const scale = Math.min(1, Math.min(halfX, halfZ) / 3)
  const bark = (gradientMap
    ? ['#958775', '#ab9980', '#bbaa91', '#9fa084', '#ccba9c']
    : ['#4e5148', '#686452', '#7c7965', '#5b6651', '#8b8470']).map(color => new Color(color))
  const foliage = (gradientMap
    ? ['#7e9d87', '#94af90', '#aec39e', '#c5d2aa']
    : ['#304f49', '#4d6c59', '#71876c', '#8c9c78']).map(color => new Color(color))
  const random = randomFrom(seed ^ 0x4ab19d71)
  // Every vertex retains its owning side's safe band, including corner roots.
  const constrained = (p: Point, side: number, inward: number, outward: number): Point => {
    const q: Point = [Math.max(-halfX - outward * scale, Math.min(halfX + outward * scale, p[0])), p[1], Math.max(-halfZ - outward * scale, Math.min(halfZ + outward * scale, p[2]))]
    const axis = side < 2 ? 0 : 2
    const half = axis === 0 ? halfX : halfZ
    const sign = side % 2 === 0 ? -1 : 1
    q[axis] = sign * Math.max(half - inward * scale, Math.min(half + outward * scale, q[axis] * sign))
    return q
  }
  const edge = (side: number, t: number, inset = 0): Point => side < 2
    ? [(side === 0 ? -1 : 1) * (halfX - inset), groundY, t * halfZ]
    : [t * halfX, groundY, (side === 2 ? -1 : 1) * (halfZ - inset)]
  const tube = (a: Point, b: Point, r0: number, r1: number, side: number) => {
    for (let j = 0; j < 7; j++) {
      const ring = (p: Point, radius: number, n: number): Point => constrained([
        p[0] + Math.cos(n / 7 * Math.PI * 2) * radius,
        p[1], p[2] + Math.sin(n / 7 * Math.PI * 2) * radius,
      ], side, 0.25, 0.38)
      const p = ring(a, r0, j), q = ring(a, r0, j + 1), r = ring(b, r1, j), s = ring(b, r1, j + 1)
      const color = bark[j % bark.length]
      wood.triangle(p, q, r, [color])
      wood.triangle(q, s, r, [color, bark[(j + 1) % bark.length], color])
    }
  }
  for (let side = 0; side < 4; side++) {
    const span = 2 * (side < 2 ? halfZ : halfX)
    const trees = Math.max(3, Math.min(9, Math.round(span / 1.65)))
    for (let i = 0; i < trees; i++) {
      const t = -0.95 + (i + 0.2 + random() * 0.55) / trees * 1.9
      const base = edge(side, t, -0.025 * scale)
      const height = (0.65 + random() * 0.87) * scale
      const size = (0.1 + random() * 0.055) * scale
      const leanX = (random() - 0.5) * 0.17 * scale, leanZ = (random() - 0.5) * 0.17 * scale
      const knee: Point = [base[0] + leanX * 0.4, groundY + height * 0.22, base[2] + leanZ * 0.4]
      const crown: Point = [base[0] + leanX, groundY + height, base[2] + leanZ]
      tube(base, knee, size * 1.65, size, side)
      tube(knee, crown, size, size * 0.42, side)
      for (let fork = 0; fork < 2; fork++) {
        const angle = random() * Math.PI * 2
        const start: Point = [base[0] + leanX * 0.7, groundY + height * 0.62, base[2] + leanZ * 0.7]
        const end: Point = [crown[0] + Math.cos(angle) * 0.18 * scale, groundY + height * (0.89 + random() * 0.1), crown[2] + Math.sin(angle) * 0.18 * scale]
        tube(start, end, size * 0.45, 0.012 * scale, side)
      }
      for (let flare = 0; flare < 4; flare++) {
        const angle = random() * Math.PI * 2
        const foot: Point = [base[0] + Math.cos(angle) * 0.26 * scale, groundY, base[2] + Math.sin(angle) * 0.26 * scale]
        const shoulder: Point = [base[0], groundY + 0.19 * scale, base[2]]
        const left: Point = [base[0] + Math.cos(angle - 0.5) * size, groundY, base[2] + Math.sin(angle - 0.5) * size]
        wood.triangle(constrained(foot, side, 0.25, 0.38), constrained(left, side, 0.25, 0.38), constrained(shoulder, side, 0.25, 0.38), [bark[3], bark[0], bark[2]])
      }
    }
    const clusters = Math.min({ low: 12, mid: 16, high: 20 }[tier], Math.max(5, Math.ceil(span / 0.65)))
    for (let i = 0; i < clusters; i++) {
      const center = edge(side, -0.98 + (i + random() * 0.65) / clusters * 1.96, 0.05 * scale)
      const cluster = {
        ...leaves,
        triangle: (a: Point, b: Point, c: Point, shades: Color[]) => leaves.triangle(
          constrained(a, side, 0.65, 0.4), constrained(b, side, 0.65, 0.4), constrained(c, side, 0.65, 0.4), shades,
        ),
      }
      const count = { low: 7, mid: 9, high: 11 }[tier]
      const yaw = random() * Math.PI * 2
      for (let j = 0; j < count; j++) {
        const origin: Point = [center[0] + (random() - 0.5) * 0.14 * scale, groundY + (0.1 + random() * 0.24) * scale, center[2] + (random() - 0.5) * 0.14 * scale]
        leaf(cluster, origin, yaw + j * 2.399, (0.25 + random() * 0.32) * scale, (0.075 + random() * 0.065) * scale, (0.1 + random() * 0.25) * scale, foliage)
      }

    }
  }
  const flowerRandom = randomFrom(seed ^ 0x71d03fa9)
  const cream = ['#b7b89d', '#dfdfc5', '#eee9d4', '#f4eedb'].map(color => new Color(color))
  const yellow = ['#a88d45', '#c1a650', '#e0c369', '#e9ce7b'].map(color => new Color(color))
  const stems = (gradientMap
    ? ['#849e7d', '#99af88', '#adc097', '#bdcca6']
    : ['#42664c', '#5c7955', '#718961', '#83966d']).map(color => new Color(color))
  let anchorX = 0, anchorZ = 0
  const kinds = { daisy: 0, seedhead: 0, yellow: 0 }
  for (let i = 0; i < { low: 28, mid: 48, high: 80 }[tier]; i++) {
    // Loose local groups, independent of tier, tree density and grass admission.
    if (i % 4 === 0) {
      anchorX = (flowerRandom() * 2 - 1) * halfX * 0.88
      anchorZ = (flowerRandom() * 2 - 1) * halfZ * 0.88
    }
    const x = Math.max(-halfX + 0.15, Math.min(halfX - 0.15, anchorX + (flowerRandom() - 0.5) * 0.95))
    const z = Math.max(-halfZ + 0.15, Math.min(halfZ - 0.15, anchorZ + (flowerRandom() - 0.5) * 0.95))
    const height = 0.34 + flowerRandom() * 0.29
    const phase = flowerRandom() * Math.PI * 2
    const radius = 0.065 + flowerRandom() * 0.035
    const head: Point = [x + Math.cos(phase) * 0.015, groundY + height, z + Math.sin(phase) * 0.015]
    flowers.setPlant([x, phase, z], groundY)
    for (let axis = 0; axis < 2; axis++) {
      const dx = axis === 0 ? 0.007 : 0, dz = axis === 1 ? 0.007 : 0
      const a: Point = [x - dx, groundY, z - dz], b: Point = [x + dx, groundY, z + dz]
      const c: Point = [head[0] - dx * 0.5, head[1], head[2] - dz * 0.5], d: Point = [head[0] + dx * 0.5, head[1], head[2] + dz * 0.5]
      flowers.triangle(a, b, c, [stems[0], stems[1], stems[2]])
      flowers.triangle(b, d, c, [stems[1], stems[3], stems[2]])
    }
    for (let j = 0; j < 2; j++) leaf(flowers, [x, groundY + height * (0.2 + j * 0.2), z], phase + j * 2.4, 0.095, 0.024, 0.045, stems)
    const kind = i % 3
    kinds[kind === 0 ? 'daisy' : kind === 1 ? 'seedhead' : 'yellow']++
    const petals = kind === 1 ? 13 : kind === 0 ? 8 : 6
    const palette = kind === 2 ? yellow : cream
    for (let j = 0; j < petals; j++) {
      const angle = phase + j / petals * Math.PI * 2
      const at = (r: number, tangent: number, up: number): Point => [head[0] + Math.cos(angle) * r - Math.sin(angle) * tangent, head[1] + up, head[2] + Math.sin(angle) * r + Math.cos(angle) * tangent]
      if (kind === 1) {
        // Separated spokes and tiny parasol tufts: a pale airy seed head, not a disk.
        const tip = at(radius * 0.88, 0, 0.018 + (j % 3) * 0.008)
        flowers.triangle(head, at(radius * 0.8, -0.003, 0.026), tip, [cream[0], cream[1], cream[2]])
        flowers.triangle(at(radius * 0.66, -0.014, 0.037), at(radius, 0, 0.025), at(radius * 0.66, 0.014, 0.037), [cream[1], cream[3], cream[2]])
      } else {
        const inner = at(radius * 0.2, 0, 0), left = at(radius * 0.65, -radius * 0.21, 0.01), tip = at(radius, 0, 0.02), right = at(radius * 0.65, radius * 0.21, 0.01)
        flowers.triangle(inner, left, tip, [palette[0], palette[1], palette[3]])
        flowers.triangle(inner, tip, right, [palette[0], palette[3], palette[2]])
      }
      if (kind !== 1) flowers.triangle([head[0], head[1] + 0.017, head[2]], at(radius * 0.25, 0, 0.008), [head[0] + Math.cos(angle + Math.PI * 2 / petals) * radius * 0.25, head[1] + 0.008, head[2] + Math.sin(angle + Math.PI * 2 / petals) * radius * 0.25], [yellow[2], yellow[0], yellow[1]])
    }
  }
  root.userData.flowerKinds = kinds
  for (const [name, data] of [['woodland-tree-line', wood], ['woodland-understory', leaves], ['woodland-wildflowers', flowers]] as const) {
    const material = gradientMap
      ? new MeshToonMaterial({ vertexColors: true, side: DoubleSide, gradientMap })
      : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
    const mesh = new Mesh(data.finish(), material)
    mesh.name = name
    if (name === 'woodland-wildflowers') {
      mesh.material.onBeforeCompile = shader => {
        shader.uniforms.uForestTime = time
        shader.vertexShader = `attribute vec3 aPlant; attribute float aSway;
          uniform float uForestTime;
          ${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
          // Shared slow world drift plus an independent, smaller plant flutter.
          float drift = sin(dot(aPlant.xz, vec2(0.63, 0.39)) - uForestTime * 0.72)
            * 0.62 + sin(dot(aPlant.xz, vec2(-0.31, 0.78)) - uForestTime * 0.43 + 1.7) * 0.38;
          float flutter = sin(uForestTime * 1.31 + aPlant.y) * 0.009;
          transformed.xz += aSway * (vec2(0.891, 0.454) * drift * 0.035 + vec2(flutter, -flutter * 0.6));
          `)
      }
      mesh.material.customProgramCacheKey = () => 'forest-flowers-pinned-sway-v1'
    }
    mesh.receiveShadow = true
    mesh.raycast = () => {}
    root.add(mesh)
  }
  return root
}
