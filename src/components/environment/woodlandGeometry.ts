import {
  AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group,
  CylinderGeometry, DataTexture, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, LinearFilter, Mesh, MeshLambertMaterial, MeshStandardMaterial, MeshToonMaterial, NearestFilter, NoColorSpace, Object3D, PlaneGeometry, Points, RepeatWrapping, RGBAFormat, ShaderMaterial, SphereGeometry, Vector2, Vector3,
} from 'three'
import type { EnvironmentQuality, WoodlandRecipe } from '../../lib/environmentQuality'
import { createGrassInteractionField, type GrassContactDie } from './grassInteraction'
import { sampleGrassField } from './grassField'
import { createGrassAlbedoTextures } from './woodlandTextures'
import { createForestDecor } from './forestEdgeGeometry'
import { createForestCanopy } from './forestCanopyGeometry'
import { createReviewedCanopy } from './reviewedCanopy'
import { repairWoodlandPalette } from './woodlandPalette'
import { attachCombinedCel } from '../../lib/woodlandCelMaterial'

const emptyGrassContacts: ReadonlyMap<string, GrassContactDie> = new Map()

// One palette function for the textured floor and attached blade roots. The
// existing patch/density field colors the short undercoat, not just tall tufts.
const groundAlbedoGLSL = `vec3 woodlandGroundAlbedo(vec3 paintedBase, vec3 base, vec3 tip, vec3 sun, vec2 field) {
  vec3 brush = paintedBase / max(base, vec3(0.001));
  vec3 undercoat = mix(paintedBase, tip * brush, 0.10 + field.x * 0.12 + field.y * 0.08);
  return undercoat * (0.96 + field.x * 0.08) + sun * smoothstep(0.42, 0.85, field.x) * 0.008;
}`

interface WoodlandOptions {
  recipe: WoodlandRecipe
  quality: Pick<EnvironmentQuality, 'tier' | 'grassCount' | 'particleCount' | 'shaftCount'>
  arenaHalfX: number
  arenaHalfZ: number
  groundY?: number
}

/** Local PRNG: theme rebuilds never consume global randomness. */
function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Bake the same field used by tuft admission for a static, quiet undercoat. */
function createMeadowTexture(seed: number, halfX: number, halfZ: number) {
  // RG channels carry the field; RGBA storage retains the WebGL1 fallback.
  const bytes = new Uint8Array(128 * 128 * 4)
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
    const field = sampleGrassField(((x + 0.5) / 128 * 2 - 1) * halfX, ((z + 0.5) / 128 * 2 - 1) * halfZ, seed)
    bytes[(z * 128 + x) * 4] = Math.round(field.patch * 255)
    bytes[(z * 128 + x) * 4 + 1] = Math.round(field.density * 255)
    bytes[(z * 128 + x) * 4 + 3] = 255
  }
  const texture = new DataTexture(bytes, 128, 128, RGBAFormat)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** Low-frequency toroidal spectrum baked once, never evaluated in the shader. */
function createWindTexture(seed: number) {
  const random = seededRandom(seed ^ 0x2c7f34a1)
  const modes = Array.from({ length: 8 }, (_, i) => ({
    x: 1 + Math.floor(random() * 4), z: Math.floor(random() * 5) - 2,
    phase: random() * Math.PI * 2, amplitude: 1 / (1 + i * 0.5),
  }))
  const total = modes.reduce((sum, mode) => sum + mode.amplitude, 0)
  const bytes = new Uint8Array(64 * 64 * 4)
  for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
    for (let channel = 0; channel < 2; channel++) {
      let value = 0
      for (const mode of modes) {
        value += Math.sin((x * mode.x + z * mode.z) / 64 * Math.PI * 2 + mode.phase + channel * 1.93) * mode.amplitude
      }
      bytes[(z * 64 + x) * 4 + channel] = Math.round(128 + value / total * 120)
    }
    bytes[(z * 64 + x) * 4 + 3] = 255
  }
  const texture = new DataTexture(bytes, 64, 64, RGBAFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.minFilter = texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** One draw for all blades; roots stay dark and the tilted tips read from above. */
export function createWoodlandResources({ recipe, quality, arenaHalfX, arenaHalfZ, groundY = -.5 }: WoodlandOptions) {
  const random = seededRandom(recipe.seed)
  const root = new Group()
  root.position.y = groundY + .5
  const time = { value: 0 }
  const cloudStrength = { value: recipe.shading === 'cel' ? 0.18 : 0 }
  const interaction = createGrassInteractionField(arenaHalfX, arenaHalfZ)
  const windTexture = createWindTexture(recipe.seed)
  const meadowTexture = createMeadowTexture(recipe.seed, arenaHalfX + 0.4, arenaHalfZ + 0.4)
  const albedo = createGrassAlbedoTextures()
  // One shared light-response lookup, not a posterization of painted albedo.
  const celRamp = recipe.shading === 'cel'
    ? new DataTexture(new Uint8Array([48, 48, 48, 48, 112, 112, 200, 255].flatMap(level => [level, level, level, 255])), 8, 1, RGBAFormat)
    : null
  if (celRamp) {
    celRamp.minFilter = celRamp.magFilter = NearestFilter
    celRamp.colorSpace = NoColorSpace
    celRamp.generateMipmaps = false
    celRamp.needsUpdate = true
  }
  albedo.ground.repeat.set((arenaHalfX * 2 + 0.8) / 4, (arenaHalfZ * 2 + 0.8) / 4)
  const floorMaterial = celRamp
    ? new MeshToonMaterial({ color: recipe.grass.base, map: albedo.ground, gradientMap: celRamp })
    : new MeshStandardMaterial({ color: recipe.grass.base, map: albedo.ground, roughness: 0.96 })
  floorMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundBase = { value: new Color(recipe.grass.base) }
    shader.uniforms.uMossTip = { value: new Color(recipe.grass.tip) }
    shader.uniforms.uSun = { value: new Color(recipe.sunlight) }
    shader.uniforms.uMeadowField = { value: meadowTexture }
    shader.uniforms.uMeadowHalf = { value: new Vector2(arenaHalfX + 0.4, arenaHalfZ + 0.4) }
    shader.vertexShader = `varying vec2 vWoodlandPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodlandPosition = vec2(position.x, -position.y);')
    shader.fragmentShader = `varying vec2 vWoodlandPosition;
      uniform vec3 uGroundBase; uniform vec3 uMossTip; uniform vec3 uSun; uniform sampler2D uMeadowField; uniform vec2 uMeadowHalf;
      ${groundAlbedoGLSL}
      ${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 field = texture2D(uMeadowField, (vWoodlandPosition + uMeadowHalf) / (2.0 * uMeadowHalf)).rgb;
      vec3 shortGrass = woodlandGroundAlbedo(diffuseColor.rgb, uGroundBase, uMossTip, uSun, field.rg);
      ${celRamp ? 'float woodlandGroundOcclusion = 1.0 - field.b * 0.12;' : ''}
      diffuseColor.rgb = shortGrass ${celRamp ? '' : '* (1.0 - field.b * 0.12)'};
      `)
    if (celRamp) shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.directDiffuse *= woodlandGroundOcclusion;
      reflectedLight.indirectDiffuse *= woodlandGroundOcclusion;`)
  }
  floorMaterial.customProgramCacheKey = () => 'woodland-attached-undercoat-v6'
  const groundGeometry = new PlaneGeometry(recipe.shading === 'cel' ? Math.max(80, arenaHalfX * 8) : arenaHalfX * 2 + 0.8, recipe.shading === 'cel' ? Math.max(80, arenaHalfZ * 8) : arenaHalfZ * 2 + 0.8)
  if (recipe.shading === 'cel') {
    const positions = groundGeometry.attributes.position, uv = groundGeometry.attributes.uv
    for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) / (arenaHalfX * 2 + .8) + .5, positions.getY(i) / (arenaHalfZ * 2 + .8) + .5)
  }
  const ground = new Mesh(groundGeometry, floorMaterial)
  ground.name = 'woodland-ground'
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.5
  ground.receiveShadow = true
  root.add(ground)

  root.add(createForestDecor({
    halfX: arenaHalfX, halfZ: arenaHalfZ, groundY: -0.5,
    tier: quality.tier, seed: recipe.seed, time, gradientMap: celRamp ?? undefined,
  }))
  let reviewedCanopy: ReturnType<typeof createReviewedCanopy> | undefined
  if (recipe.shading === 'cel') {
    for (const name of ['woodland-tree-line', 'woodland-understory']) {
      const retired = root.getObjectByName(name) as Mesh | undefined
      if (!retired) continue
      retired.removeFromParent()
      retired.geometry.dispose()
      ;(retired.material as MeshToonMaterial).dispose()
    }
    reviewedCanopy = createReviewedCanopy({ halfX: arenaHalfX, halfZ: arenaHalfZ, groundY: -.5, time })
    root.add(reviewedCanopy.root)
  } else {
    root.add(createForestCanopy({
      halfX: arenaHalfX, halfZ: arenaHalfZ, groundY: -0.5,
      tier: quality.tier, seed: recipe.seed, time, gradientMap: celRamp ?? undefined,
    }))
  }

  const geometry = new InstancedBufferGeometry()
  // Three triangles: a bowed lower ribbon and a visibly projected tapered tip.
  geometry.setAttribute('position', new Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0,
    -0.4, 0.55, 0.23, 0.4, 0.55, 0.23,
    0, 1, 0.4,
  ], 3))
  // Face upward from the overhead camera, including DoubleSide normal flips.
  geometry.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3])
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0.22, 0.55, 0.78, 0.55, 0.5, 1], 2))
  geometry.computeVertexNormals()
  const roots: number[] = []
  const shapes: number[] = []
  const appearance: number[] = []
  const grassRandom = seededRandom(recipe.seed ^ 0x71ac93d5)
  // Actual blades, not raw candidate population. Broader, lower leaves spend
  // the predecessor's geometry budget on silhouette and more attachment sites.
  const bladeBudget = Math.ceil(quality.grassCount * 0.42)
  const baselineBlades = Math.floor(bladeBudget * 0.4 / 2) * 2
  const addTuft = (x: number, z: number, leaves: number, kind: 'short' | 'mid' | 'tall') => {
    const yaw = grassRandom() * Math.PI * 2
    const spread = 0.05 + grassRandom() * 0.03
    for (let leaf = 0; leaf < leaves; leaf++) {
      const angle = yaw + leaf / leaves * Math.PI * 2 + (grassRandom() - 0.5) * 0.7
      const rootX = Math.max(-arenaHalfX + 0.001, Math.min(arenaHalfX - 0.001, x + Math.cos(angle) * spread))
      const rootZ = Math.max(-arenaHalfZ + 0.001, Math.min(arenaHalfZ - 0.001, z + Math.sin(angle) * spread))
      const field = sampleGrassField(rootX, rootZ, recipe.seed)
      const direction = angle + (grassRandom() - 0.5) * 1.1
      const variation = grassRandom()
      const height = kind === 'short' ? 0.16 + grassRandom() * 0.10
        : kind === 'mid' ? 0.28 + grassRandom() * 0.12 : 0.46 + grassRandom() * 0.09
      roots.push(rootX, -0.5, rootZ)
      shapes.push(0.08 + grassRandom() * 0.05, height, direction, variation)
      appearance.push(field.patch, 0.94 + variation * 0.12, Math.cos(direction), Math.sin(direction))
    }
  }
  // Two-leaf low growth covers the whole arena, independent of tall density.
  // A short final stratified row still spans the full width.
  const baselineSites = baselineBlades / 2
  const columns = Math.max(1, Math.ceil(Math.sqrt(baselineSites * arenaHalfX / arenaHalfZ)))
  const rows = Math.ceil(baselineSites / columns)
  for (let candidate = 0; candidate < baselineSites; candidate++) {
    const row = Math.floor(candidate / columns)
    const rowColumns = Math.min(columns, baselineSites - row * columns)
    const x = ((candidate % columns + grassRandom()) / rowColumns * 2 - 1) * arenaHalfX
    const z = ((row + grassRandom()) / rows * 2 - 1) * arenaHalfZ
    addTuft(x, z, 2, 'short')
  }
  // Remaining sites are independently scattered, biased by the unchanged
  // coherent field. Bounded rejection avoids grid/quadrant-shaped clearings.
  const clusterBudgets = [
    ['short', Math.round(bladeBudget * 0.7) - baselineBlades],
    ['mid', Math.round(bladeBudget * 0.25)],
    ['tall', bladeBudget - Math.round(bladeBudget * 0.7) - Math.round(bladeBudget * 0.25)],
  ] as const
  for (const [kind, count] of clusterBudgets) {
    for (let placed = 0; placed < count;) {
      let x = 0, z = 0
      for (let attempt = 0; attempt < 8; attempt++) {
        x = (grassRandom() * 2 - 1) * arenaHalfX
        z = (grassRandom() * 2 - 1) * arenaHalfZ
        if (grassRandom() < 0.25 + sampleGrassField(x, z, recipe.seed).density * 0.75) break
      }
      const leaves = Math.min(count - placed, 3 + Math.floor(grassRandom() * 2))
      addTuft(x, z, leaves, kind)
      placed += leaves
    }
  }
  geometry.instanceCount = roots.length / 3
  geometry.setAttribute('aRoot', new InstancedBufferAttribute(new Float32Array(roots), 3))
  geometry.setAttribute('aShape', new InstancedBufferAttribute(new Float32Array(shapes), 4))
  geometry.setAttribute('aAppearance', new InstancedBufferAttribute(new Float32Array(appearance), 4))
  // Static root occlusion, not moving blade shadows. Use the spare B channel
  // in the same ground sample; bounded local stamps run only during creation.
  const groundBytes = meadowTexture.image.data
  const groundHalfX = arenaHalfX + 0.4, groundHalfZ = arenaHalfZ + 0.4
  const radius = 0.18
  for (let i = 0; i < roots.length; i += 3) {
    const x = roots[i], z = roots[i + 2]
    const minX = Math.max(0, Math.floor((x - radius + groundHalfX) / (2 * groundHalfX) * 128))
    const maxX = Math.min(127, Math.floor((x + radius + groundHalfX) / (2 * groundHalfX) * 128))
    const minZ = Math.max(0, Math.floor((z - radius + groundHalfZ) / (2 * groundHalfZ) * 128))
    const maxZ = Math.min(127, Math.floor((z + radius + groundHalfZ) / (2 * groundHalfZ) * 128))
    for (let row = minZ; row <= maxZ; row++) for (let column = minX; column <= maxX; column++) {
      const dx = (column + 0.5) / 128 * 2 * groundHalfX - groundHalfX - x
      const dz = (row + 0.5) / 128 * 2 * groundHalfZ - groundHalfZ - z
      const falloff = Math.max(0, 1 - (dx * dx + dz * dz) / (radius * radius))
      const offset = (row * 128 + column) * 4 + 2
      groundBytes[offset] = Math.max(groundBytes[offset], Math.round(falloff * falloff * 255))
    }
  }
  // Diffuse foliage retains Three's real shadow reception without the PBR lobe.
  // Shared uniforms retain the renderer/proof and reduced-motion contract.
  const foliageOptions = {
    side: DoubleSide, transparent: false, depthWrite: true, map: albedo.ground, color: recipe.grass.base,
  }
  const material = Object.assign(celRamp
    ? new MeshToonMaterial({ ...foliageOptions, gradientMap: celRamp })
    : new MeshLambertMaterial(foliageOptions), {
    uniforms: {
      uTime: time, uWindStrength: { value: 0.16 }, uWindNoise: { value: windTexture },
      uCloudStrength: cloudStrength,
      uBase: { value: new Color(recipe.grass.base) },
      uTip: { value: new Color(recipe.grass.tip) },
      uWarm: { value: new Color(recipe.sunlight) },
      uInteraction: { value: interaction.texture },
      uFieldHalf: { value: new Vector2(arenaHalfX, arenaHalfZ) },
      uMeadowHalf: { value: new Vector2(arenaHalfX + 0.4, arenaHalfZ + 0.4) },
    },
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.uniforms)
    shader.vertexShader = `attribute vec3 aRoot; attribute vec4 aShape; attribute vec4 aAppearance;
      uniform float uTime; uniform float uWindStrength;
      uniform sampler2D uWindNoise; uniform sampler2D uInteraction; uniform vec2 uFieldHalf; uniform vec2 uMeadowHalf;
      varying float vHeight; varying vec2 vGrassField; varying float vShade;
      ${shader.vertexShader}`
      .replace('void main() {', `void main() {
        // These are per-vertex fetches, evaluated once here and reused by both paths.
        vec2 windNoise = texture2D(uWindNoise, (aRoot.xz - vec2(0.55, 0.28) * uTime) / 12.0).rg;
        vec3 pressureData = texture2D(uInteraction, (aRoot.xz + uFieldHalf) / (uFieldHalf * 2.0)).rgb;
        vec3 pressure = vec3((pressureData.rg * 255.0 - 128.0) / 127.0, pressureData.b);
        vec2 downwind = vec2(0.891, 0.454);
        vec2 crosswind = vec2(-0.454, 0.891);
        vec2 wind = uWindStrength * (downwind * (0.32 + windNoise.r * 0.68)
          + crosswind * ((windNoise.g - 0.5) * 0.35)) * (0.65 + aShape.w * 0.45);
        vec2 woodlandBend = wind * (1.0 - pressure.z * 0.85) + pressure.xy * 0.55;
        float squash = 1.0 - pressure.z * 0.78;
        // Rest reach is independent of height, so short leaves remain visible
        // from the gameplay camera. Reuse stiffness variation, no new attribute.
        vec3 bladeScale = vec3(aShape.x, aShape.y * squash, (0.24 + aShape.w * 0.16) / 0.4);
        vec2 yaw = aAppearance.zw;
        mat2 rotation = mat2(yaw.x, -yaw.y, yaw.y, yaw.x);
      `)
      .replace('#include <beginnormal_vertex>', `
        vec3 objectNormal = normal / bladeScale;
        objectNormal.xz = rotation * objectNormal.xz;
        // Inverse transpose of the scaled, rotated, height-squared shear.
        objectNormal.y -= 2.0 * position.y / bladeScale.y * dot(woodlandBend, objectNormal.xz);
        objectNormal = normalize(objectNormal);
        // Only the attachment normal changes, not the cel shadow-band width.
        objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), objectNormal, smoothstep(0.0, 0.45, position.y)));
      `)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        // Sample the same four-world-unit brush tile as the floor at the root.
        vMapUv = vec2(aRoot.x + uMeadowHalf.x, uMeadowHalf.y - aRoot.z) / 4.0;
      `)
      .replace('#include <begin_vertex>', `
        vHeight = position.y;
        vGrassField = vec2(aAppearance.x, smoothstep(0.36, 0.66, aAppearance.x));
        vShade = aAppearance.y;
        vec3 transformed = position * bladeScale;
        transformed.xz = rotation * transformed.xz;
        transformed.xz += woodlandBend * position.y * position.y;
        transformed += aRoot;
      `)
    shader.fragmentShader = `uniform vec3 uBase; uniform vec3 uTip; uniform vec3 uWarm;
      varying float vHeight; varying vec2 vGrassField; varying float vShade;
      ${groundAlbedoGLSL}
      ${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 rootColor = woodlandGroundAlbedo(diffuseColor.rgb, uBase, uTip, uWarm, vGrassField);
        vec3 brush = diffuseColor.rgb / max(uBase, vec3(0.001));
        vec3 bodyColor = mix(uBase, uTip, 0.18 + smoothstep(0.25, 0.75, vGrassField.x) * 0.38) * brush;
        vec3 tipColor = mix(uTip * 0.94, uTip * 1.06 + uWarm * 0.012, smoothstep(0.25, 0.8, vGrassField.x)) * brush;
        ${celRamp ? `vec3 meadow = mix(bodyColor * 0.98, bodyColor, step(0.18, vHeight));
        meadow = mix(meadow, tipColor, step(0.78, vHeight));`
    : `vec3 meadow = mix(bodyColor, tipColor, smoothstep(0.38, 1.0, vHeight));`}
        diffuseColor.rgb = mix(rootColor, meadow * vShade, smoothstep(0.0, 0.20, vHeight));
      `)
  }
  material.customProgramCacheKey = () => celRamp ? 'woodland-attached-low-growth-cel-v2' : 'woodland-attached-low-growth-lambert-v3'
  const grass = new Mesh(geometry, material)
  grass.name = 'woodland-grass'
  grass.receiveShadow = true
  root.add(grass)

  // Small, asymmetric still-life clusters. All species share one draw per material.
  const clusterCount = quality.tier === 'low' ? 6 : 12
  const rocks = new InstancedMesh(new IcosahedronGeometry(1, 0),
    celRamp ? new MeshToonMaterial({ color: '#6f7963', gradientMap: celRamp })
      : new MeshStandardMaterial({ color: '#6f7963', roughness: 1, flatShading: true }), clusterCount * 2)
  rocks.name = 'woodland-rocks'
  const caps = new InstancedMesh(new SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2),
    celRamp ? new MeshToonMaterial({ color: '#bf6844', gradientMap: celRamp })
      : new MeshStandardMaterial({ color: '#bf6844', roughness: 0.87, flatShading: true }), clusterCount * 2)
  caps.name = 'woodland-mushroom-caps'
  const stems = new InstancedMesh(new CylinderGeometry(0.055, 0.07, 1, 5),
    celRamp ? new MeshToonMaterial({ color: '#e4d8ad', gradientMap: celRamp })
      : new MeshStandardMaterial({ color: '#e4d8ad', roughness: 1 }), clusterCount * 2)
  stems.name = 'woodland-mushroom-stems'
  const fernGeometry = new BufferGeometry()
  const leaves: number[] = []
  for (let frond = 0; frond < 5; frond++) {
    const angle = frond * Math.PI * 2 / 5
    const c = Math.cos(angle), s = Math.sin(angle)
    for (let leaf = 1; leaf <= 5; leaf++) {
      const distance = leaf * 0.1
      const width = (6 - leaf) * 0.035
      for (const sign of [-1, 1]) {
        for (const [x, y, z] of [
          [distance, 0.07 + distance * 0.22, 0],
          [distance + 0.11, 0.06 + distance * 0.25, sign * width],
          [distance - 0.035, 0.06 + distance * 0.15, sign * width * 0.65],
        ]) leaves.push(x * c - z * s, y, x * s + z * c)
      }
    }
  }
  fernGeometry.setAttribute('position', new Float32BufferAttribute(leaves, 3))
  fernGeometry.computeVertexNormals()
  const ferns = new InstancedMesh(fernGeometry,
    celRamp ? new MeshToonMaterial({ color: recipe.grass.tip, side: DoubleSide, gradientMap: celRamp })
      : new MeshStandardMaterial({ color: recipe.grass.tip, roughness: 1, side: DoubleSide, flatShading: true }), clusterCount)
  ferns.name = 'woodland-ferns'
  const transform = new Object3D()
  const tint = new Color()
  for (let i = 0; i < clusterCount; i++) {
    const side = i % 4
    const along = (random() * 1.6 - 0.8)
    const x = side < 2 ? (side === 0 ? -1 : 1) * arenaHalfX * 0.91 : along * arenaHalfX
    const z = side >= 2 ? (side === 2 ? -1 : 1) * arenaHalfZ * 0.93 : along * arenaHalfZ
    transform.position.set(x, -0.49, z)
    transform.rotation.set(0, random() * Math.PI * 2, 0)
    transform.scale.setScalar(0.55 + random() * 0.32)
    transform.updateMatrix()
    ferns.setMatrixAt(i, transform.matrix)
    for (let j = 0; j < 2; j++) {
      const index = i * 2 + j
      const scale = 0.12 + random() * 0.15
      transform.position.set(x + (random() - 0.5) * arenaHalfX * 0.055, -0.42, z + (random() - 0.5) * arenaHalfZ * 0.035)
      transform.rotation.set(random(), random() * Math.PI, random())
      transform.scale.set(scale * 1.25, scale * 0.65, scale)
      transform.updateMatrix()
      rocks.setMatrixAt(index, transform.matrix)
      rocks.setColorAt(index, tint.setHSL(0.21 + random() * 0.04, 0.10, 0.29 + random() * 0.15))
      const mushroomHeight = 0.13 + random() * 0.16
      transform.position.set(x + (random() - 0.5) * arenaHalfX * 0.05, -0.5 + mushroomHeight / 2, z + (random() - 0.5) * arenaHalfZ * 0.035)
      transform.rotation.set(0, random() * Math.PI, 0)
      transform.scale.set(0.65, mushroomHeight, 0.65)
      transform.updateMatrix()
      stems.setMatrixAt(index, transform.matrix)
      transform.position.y = -0.5 + mushroomHeight
      transform.scale.set(0.12 + random() * 0.07, 0.07, 0.12 + random() * 0.07)
      transform.updateMatrix()
      caps.setMatrixAt(index, transform.matrix)
      caps.setColorAt(index, tint.setHSL(0.045 + random() * 0.045, 0.43, 0.48 + random() * 0.14))
    }
  }
  root.add(rocks, caps, stems, ferns)
  if (quality.particleCount > 0) {
    const moteGeometry = new BufferGeometry()
    const particleCount = celRamp ? Math.min(38, quality.particleCount) : quality.particleCount
    const positions = new Float32Array(particleCount * 3)
    const phases = new Float32Array(particleCount)
    const kinds = new Float32Array(particleCount)
    for (let i = 0; i < particleCount; i++) {
      positions.set([(random() * 2 - 1) * arenaHalfX * 0.92, random() * 1.6, (random() * 2 - 1) * arenaHalfZ * 0.92], i * 3)
      phases[i] = random() * Math.PI * 2
      kinds[i] = !celRamp && i % 3 === 0 ? 1 : 0
    }
    moteGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    moteGeometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1))
    moteGeometry.setAttribute('aKind', new Float32BufferAttribute(kinds, 1))
    const moteMaterial = new ShaderMaterial({
      transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uTime: time, uColor: { value: new Color(recipe.pollen) }, uFieldHalf: { value: new Vector2(arenaHalfX, arenaHalfZ) } },
      vertexShader: `attribute float aPhase; attribute float aKind;
        uniform float uTime; uniform vec2 uFieldHalf; varying float vGlow; varying float vKind;
        void main() {
          vec3 drift = vec3(sin(uTime * 0.19 + aPhase) * 0.13, sin(uTime * 0.22 + aPhase) * 0.10, cos(uTime * 0.16 + aPhase) * 0.13);
          vec3 carried = position + drift;
          // Same prevailing direction as the grass. Wrap at the arena boundary,
          // while fading the edge, rather than flying out of a fixed emitter.
          carried.xz = mod(carried.xz + vec2(0.24, 0.122) * uTime + uFieldHalf, 2.0 * uFieldHalf) - uFieldHalf;
          vec2 edge = (uFieldHalf - abs(carried.xz)) / uFieldHalf;
          vec4 viewPosition = modelViewMatrix * vec4(carried, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = mix(clamp(54.0 / -viewPosition.z, 1.5, 3.5), clamp(110.0 / -viewPosition.z, 3.0, 7.0), aKind);
          vGlow = (${celRamp ? '0.30 + 0.12 * sin(aPhase)' : '0.48 + 0.18 * sin(aPhase)'}) * smoothstep(0.0, 0.13, min(edge.x, edge.y));
          vKind = aKind;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vGlow; varying float vKind;
        void main() {
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          float radius = length(p);
          float pollen = 1.0 - smoothstep(0.15, 1.0, radius);
          float spokes = max(1.0 - smoothstep(0.07, 0.21, abs(p.x)), 1.0 - smoothstep(0.07, 0.21, abs(p.y)));
          float seed = (0.2 + spokes * 0.8) * (1.0 - smoothstep(0.5, 1.0, radius));
          gl_FragColor = vec4(mix(uColor, vec3(0.9, 0.94, 0.82), vKind), mix(pollen, seed, vKind) * vGlow);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    const motes = new Points(moteGeometry, moteMaterial)
    motes.name = 'woodland-motes'
    motes.frustumCulled = false
    root.add(motes)
  }
  if (quality.shaftCount > 0) {
    const shaftGeometry = new PlaneGeometry(1, 1)
    const shaftMaterial = new ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending, side: DoubleSide,
      uniforms: { uSun: { value: new Color(recipe.sunlight) } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uSun;
        void main() {
          float width = 0.06 + vUv.y * 0.42;
          float edge = 1.0 - smoothstep(width * 0.25, width, abs(vUv.x - 0.5));
          float ends = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          gl_FragColor = vec4(uSun, edge * ends * 0.075);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    for (let i = 0; i < (celRamp ? Math.min(2, quality.shaftCount) : quality.shaftCount); i++) {
      const shaft = new Mesh<BufferGeometry, ShaderMaterial>(shaftGeometry, shaftMaterial)
      shaft.name = `woodland-shaft-${i}`
      shaft.rotation.set(-Math.PI / 2, 0, -0.28)
      shaft.scale.set(arenaHalfX * 0.20, arenaHalfZ * 0.32, 1)
      shaft.position.set((i % 2 === 0 ? -1 : 1) * arenaHalfX * 0.78, 0.75 + i * 0.015, (i < 2 ? -1 : 1) * arenaHalfZ * 0.77)
      if (celRamp) {
        // Reviewed tapered ribbons follow the real sun, not foreground fog cards.
        const gap = new Vector3((i === 0 ? -.39 : .55) * arenaHalfX, 5.5, -.8 * arenaHalfZ)
        const end = gap.clone().addScaledVector(new Vector3(-4, 10, -6).normalize(), -6.2)
        const axis = gap.clone().sub(end), side = new Vector3(-axis.z, 0, axis.x).normalize()
        const vertices: number[] = []
        for (const [point, width] of [[end, .52], [gap, .09]] as const) {
          vertices.push(...point.clone().addScaledVector(side, -width).toArray(), ...point.clone().addScaledVector(side, width).toArray())
        }
        const ribbon = new BufferGeometry()
        ribbon.setAttribute('position', new Float32BufferAttribute(vertices, 3))
        ribbon.setAttribute('uv', new Float32BufferAttribute([0,0,1,0,0,1,1,1], 2))
        ribbon.setIndex([0,1,2,1,3,2]);shaft.geometry = ribbon
        shaft.position.set(0,0,0);shaft.rotation.set(0,0,0);shaft.scale.set(1,1,1)
        shaftMaterial.fragmentShader = shaftMaterial.fragmentShader.replace('0.075', '0.065')
      }
      root.add(shaft)
    }
    if (celRamp) shaftGeometry.dispose()
  }
  if (celRamp) {
    // Broad cloud shade changes direct light, never the painted albedo or dice
    // materials. Reuse the owned seamless noise and the reduced-motion clock.
    for (const litMaterial of [floorMaterial, material]) {
      const compile = litMaterial.onBeforeCompile
      const cacheKey = litMaterial.customProgramCacheKey()
      litMaterial.onBeforeCompile = (shader, renderer) => {
        compile.call(litMaterial, shader, renderer)
        shader.uniforms.uCloudTime = time
        shader.uniforms.uCloudNoise = { value: windTexture }
        shader.uniforms.uCloudStrength = cloudStrength
        shader.vertexShader = `varying vec2 vCloudWorld;\n${shader.vertexShader}`
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCloudWorld = (modelMatrix * vec4(transformed, 1.0)).xz;')
        shader.fragmentShader = `varying vec2 vCloudWorld;
          uniform float uCloudTime; uniform float uCloudStrength; uniform sampler2D uCloudNoise;
          ${shader.fragmentShader}`.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float cloudField = texture2D(uCloudNoise, (vCloudWorld - vec2(0.12, 0.061) * uCloudTime) / 32.0).r;
          float woodlandCloud = 1.0 - uCloudStrength * smoothstep(0.45, 0.65, cloudField);
          reflectedLight.directDiffuse *= woodlandCloud;
          `)
      }
      litMaterial.customProgramCacheKey = () => `${cacheKey}-cel-cloud-v1`
    }
    // Last hook: grass deformation, flower sway, clouds and static root shade
    // all finish before the shared combined-light quantization.
    const attached = new Set<MeshToonMaterial>()
    root.traverse(object => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const entry of materials) {
        if (entry instanceof MeshToonMaterial && !entry.transparent && !attached.has(entry)) {
          attachCombinedCel(entry)
          attached.add(entry)
        }
      }
    })
  }
  if (recipe.shading === 'cel') {
    repairWoodlandPalette(root)
    // Same grass geometry/material/clock continues outside gameplay bounds.
    // One bounded extension batch, no new contacts or colliders.
    const extension = geometry.clone()
    const outerRoots = roots.slice()
    for (let i = 0; i < outerRoots.length; i += 3) {
      const x = outerRoots[i], z = outerRoots[i + 2]
      if (Math.abs(x / arenaHalfX) > Math.abs(z / arenaHalfZ)) outerRoots[i] += Math.sign(x) * 2.8
      else outerRoots[i + 2] += Math.sign(z) * 2.8
    }
    extension.setAttribute('aRoot', new InstancedBufferAttribute(new Float32Array(outerRoots), 3))
    const outerGrass = new Mesh(extension, material)
    outerGrass.name = 'woodland-outer-grass';outerGrass.receiveShadow = true;outerGrass.frustumCulled = false
    root.add(outerGrass)
  }
  // Decorative meshes must never intercept the existing ground drag ray.
  root.traverse((object) => { object.raycast = () => {} })
  grass.frustumCulled = false // custom instance offsets are not in the base triangle bounds
  let disposed = false
  return {
    root,
    update(delta: number, animate: boolean, dice?: ReadonlyMap<string, GrassContactDie>, interpolation = 1, groundY = -0.5) {
      if (disposed) return
      if (animate && Number.isFinite(delta)) time.value += Math.max(0, Math.min(delta, 0.1))
      interaction.update(delta, dice ?? emptyGrassContacts, interpolation, groundY)
    },
    dispose() {
      if (disposed) return
      disposed = true
      reviewedCanopy?.dispose()
      interaction.dispose()
      windTexture.dispose()
      meadowTexture.dispose()
      albedo.ground.dispose()
      albedo.blade.dispose()
      celRamp?.dispose()
      const owned = new Set<{ dispose: () => void }>()
      root.traverse((object) => {
        if (object instanceof Mesh || object instanceof Points) {
          owned.add(object.geometry)
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((entry) => owned.add(entry))
        }
        if (object instanceof InstancedMesh) owned.add(object)
      })
      owned.forEach((resource) => resource.dispose())
    },
  }
}
