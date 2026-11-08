import * as THREE from 'three'
import { DICE_SHAPES, type DiceShape } from '../../types/diceShape'
import { createDiceGeometry } from '../../lib/geometries'

export interface GrassContactDie {
  id: string
  diceType: DiceShape
  prevPosition: [number, number, number]
  targetPosition: [number, number, number]
  prevRotation: [number, number, number, number]
  targetRotation: [number, number, number, number]
}

const SIZE = 64
const MAX_CONTACTS = 128
const MAX_STAMP_STEPS = 12
const shapeVertices = new Map<DiceShape, Float32Array>()

/** Retain CPU vertices only; temporary canonical render geometries never reach a renderer. */
function cacheShapeVertices() {
  for (const shape of DICE_SHAPES) {
    if (shapeVertices.has(shape)) continue
    const geometry = createDiceGeometry(shape)
    shapeVertices.set(shape, new Float32Array(geometry.getAttribute('position').array))
    geometry.dispose()
  }
}

/**
 * Visual-only circular footprint approximation from canonical shape vertices,
 * not a collider or a force on dice. The caller owns blade flattening (e.g. 80%
 * at B=1) and samples (root.xz + halfExtents) / (2 * halfExtents).
 * Decode RG as (sample.rg * 255 - 128) / 127; B is unsigned pressure.
 * All field, contact and math storage is allocated at creation, not per frame.
 */
export function createGrassInteractionField(halfX: number, halfZ: number) {
  if (!Number.isFinite(halfX) || !Number.isFinite(halfZ) || halfX <= 0 || halfZ <= 0) {
    throw new RangeError('Grass interaction half extents must be finite and positive')
  }
  cacheShapeVertices()
  const bendX = new Float64Array(SIZE * SIZE)
  const bendZ = new Float64Array(SIZE * SIZE)
  const pressure = new Float64Array(SIZE * SIZE)
  const rotation = new THREE.Quaternion()
  const targetRotation = new THREE.Quaternion()
  const vertex = new THREE.Vector3()
  const history = Array.from({ length: MAX_CONTACTS }, () => ({ id: null as string | null, x: 0, z: 0, radius: 0, strength: 0 }))
  const admitted: (GrassContactDie | undefined)[] = new Array(MAX_CONTACTS)
  let disposed = false
  const bytes = new Uint8Array(64 * 64 * 4)
  for (let offset = 0; offset < bytes.length; offset += 4) {
    bytes[offset] = 128
    bytes[offset + 1] = 128
    bytes[offset + 3] = 255
  }
  const texture = new THREE.DataTexture(bytes, 64, 64, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  function stamp(x: number, z: number, radius: number, strength: number, motionX: number, motionZ: number) {
    const speed = Math.hypot(motionX, motionZ)
    const moving = speed > 0.001
    const directionX = moving ? motionX / speed : 0
    const directionZ = moving ? motionZ / speed : 0
    const minColumn = Math.max(0, Math.floor((x - radius + halfX) / (2 * halfX) * SIZE))
    const maxColumn = Math.min(SIZE - 1, Math.floor((x + radius + halfX) / (2 * halfX) * SIZE))
    const minRow = Math.max(0, Math.floor((z - radius + halfZ) / (2 * halfZ) * SIZE))
    const maxRow = Math.min(SIZE - 1, Math.floor((z + radius + halfZ) / (2 * halfZ) * SIZE))
    for (let row = minRow; row <= maxRow; row++) {
      const dz = (row + 0.5) / SIZE * 2 * halfZ - halfZ - z
      for (let column = minColumn; column <= maxColumn; column++) {
        const dx = (column + 0.5) / SIZE * 2 * halfX - halfX - x
        const distance = Math.hypot(dx, dz)
        const edge = THREE.MathUtils.clamp((1 - distance / radius) / 0.5, 0, 1)
        const weight = edge * edge * (3 - 2 * edge) * strength
        const cell = row * SIZE + column
        if (weight <= pressure[cell]) continue
        pressure[cell] = weight
        const radialX = distance > 0.0001 ? dx / distance : 1
        const radialZ = distance > 0.0001 ? dz / distance : 0
        bendX[cell] = weight * (moving ? directionX * 0.8 + radialX * 0.15 : radialX * 0.85)
        bendZ[cell] = weight * (moving ? directionZ * 0.8 + radialZ * 0.15 : radialZ * 0.85)
      }
    }
  }
  function publish() {
    let changed = false
    for (let cell = 0; cell < pressure.length; cell++) {
      const offset = cell * 4
      const r = Math.round(128 + bendX[cell] * 127)
      const g = Math.round(128 + bendZ[cell] * 127)
      const b = Math.round(pressure[cell] * 255)
      if (bytes[offset] !== r || bytes[offset + 1] !== g || bytes[offset + 2] !== b) {
        bytes[offset] = r
        bytes[offset + 1] = g
        bytes[offset + 2] = b
        changed = true
      }
    }
    if (changed) texture.needsUpdate = true
  }
  return {
    texture,
    update(delta: number, dice: ReadonlyMap<string, GrassContactDie>, interpolation: number, groundY: number): void {
      if (disposed) return
      // Analytic overdamped spring: 95% recovery in one second, byte-neutral by two.
      // Floats stay separate from the upload buffer, so tiny steps cannot stick.
      const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0
      const recovery = Math.exp(-3.2 * dt)
      for (let cell = 0; cell < pressure.length; cell++) {
        pressure[cell] *= recovery
        bendX[cell] *= recovery
        bendZ[cell] *= recovery
      }
      const t = THREE.MathUtils.clamp(interpolation, 0, 1)
      // Stable map insertion-order truncation includes airborne dice. Both work
      // and retained history are bounded even if a room exceeds the visual cap.
      let count = 0
      for (const die of dice.values()) {
        admitted[count++] = die
        if (count === MAX_CONTACTS) break
      }
      for (const contact of history) {
        let present = false
        for (let index = 0; index < count; index++) {
          if (admitted[index]!.id === contact.id) { present = true; break }
        }
        if (!present) contact.id = null
      }
      for (let contactIndex = 0; contactIndex < count; contactIndex++) {
        const die = admitted[contactIndex]!
        admitted[contactIndex] = undefined
        const x = THREE.MathUtils.lerp(die.prevPosition[0], die.targetPosition[0], t)
        const y = THREE.MathUtils.lerp(die.prevPosition[1], die.targetPosition[1], t)
        const z = THREE.MathUtils.lerp(die.prevPosition[2], die.targetPosition[2], t)
        const vertices = shapeVertices.get(die.diceType)!
        rotation.fromArray(die.prevRotation).slerp(targetRotation.fromArray(die.targetRotation), t)
        targetRotation.fromArray(die.prevRotation)
        let lowest = Infinity
        let previousLowest = Infinity
        let radius = 0
        for (let index = 0; index < vertices.length; index += 3) {
          vertex.fromArray(vertices, index).applyQuaternion(rotation)
          lowest = Math.min(lowest, vertex.y)
          radius = Math.max(radius, Math.hypot(vertex.x, vertex.z))
          vertex.fromArray(vertices, index).applyQuaternion(targetRotation)
          previousLowest = Math.min(previousLowest, vertex.y)
        }
        const previouslyGrounded = die.prevPosition[1] + previousLowest < groundY + 0.82
        const depth = THREE.MathUtils.clamp((groundY + 0.82 - y - lowest) / 0.82, 0, 1)
        const strength = depth * depth * (3 - 2 * depth)
        let slot = -1
        let emptySlot = -1
        for (let index = 0; index < history.length; index++) {
          if (history[index].id === die.id) { slot = index; break }
          if (history[index].id === null && emptySlot === -1) emptySlot = index
        }
        if (slot === -1) slot = emptySlot
        if (slot === -1) continue
        const previous = history[slot]
        if (strength <= 0) {
          previous.id = null
          continue
        }
        const motionX = die.targetPosition[0] - die.prevPosition[0]
        const motionZ = die.targetPosition[2] - die.prevPosition[2]
        const distance = Math.hypot(x - previous.x, z - previous.z)
        const canSweep = previous.id === die.id && previouslyGrounded && Number.isFinite(delta)
          && delta >= 0 && dt <= 0.25 && distance <= 3 && Math.hypot(motionX, motionZ) <= 3
        const steps = canSweep
          ? Math.min(MAX_STAMP_STEPS, Math.max(1, Math.ceil(distance / Math.max(0.12, radius * 0.35)))) : 1
        for (let step = 1; step <= steps; step++) {
          const fraction = step / steps
          stamp(steps > 1 ? THREE.MathUtils.lerp(previous.x, x, fraction) : x,
            steps > 1 ? THREE.MathUtils.lerp(previous.z, z, fraction) : z,
            steps > 1 ? THREE.MathUtils.lerp(previous.radius, radius, fraction) + 0.18 : radius + 0.18,
            steps > 1 ? THREE.MathUtils.lerp(previous.strength, strength, fraction) : strength, motionX, motionZ)
        }
        previous.id = die.id
        previous.x = x
        previous.z = z
        previous.radius = radius
        previous.strength = strength
      }
      publish()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const contact of history) contact.id = null
      admitted.fill(undefined)
      texture.dispose()
    },
  }
}
