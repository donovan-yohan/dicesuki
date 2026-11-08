import * as THREE from 'three'
import type { GltfDiceAsset } from '../types/gltfDice'
import { createCelPreviewScene, setCelLightingResponse, type CelLightingResponse } from './woodlandCelMaterial'
import { cloneManagedPhysicalCel } from './managedPhysicalCelMaterial'
import { repairWoodlandPalette } from '../components/environment/woodlandPalette'

const SCULPTED_SET_IDS = new Set(['woodland-sculpted-set', 'cyberpunk-cutline-set', 'monster-dungeon-set'])

// Zabi D6: one named rotation action per eye. The extra generic `Action`
// overlaps eye2_2Action with different keys; never blend both onto that eye.
const MONSTER_EYES = [
  '1_eye', 'eye2_1', 'eye2_2', 'eye31', 'eye32', 'eye33',
  'eye4_1', 'eye4_2', 'eye4_3', 'eye4_4',
  'eye5_1', 'eye5_2', 'eye5_3', 'eye5_4', 'eye5_5',
  'eye6_1', 'eye62', 'eye63', 'eye64', 'eye65', 'eye66',
]

function monsterEyeIdles(scene: THREE.Group, animations: THREE.AnimationClip[]) {
  return MONSTER_EYES.flatMap(name => {
    const nodes: THREE.Object3D[] = []
    scene.traverse(node => { if (node.name === name) nodes.push(node) })
    const matches = animations.filter(clip => clip.name === `${name}Action`)
    if (nodes.length !== 1 || nodes[0] === scene || matches.length !== 1) return []
    const node = nodes[0]
    // A renamed ancestor must not acquire authority over the rigid body/peers.
    let rigidAncestor = false
    node.traverse(child => { if (child !== node && (child.name === 'BODY' || MONSTER_EYES.includes(child.name))) rigidAncestor = true })
    if (rigidAncestor) return []
    const clip = matches[0]
    const rotations = clip.tracks.filter(track => track.name === `${name}.quaternion` && track instanceof THREE.QuaternionKeyframeTrack)
    if (rotations.length !== 1) return []
    // Two named actions also contain redundant bind-position keys. Validate
    // those, then play only rotation: never move/scale an eye or the die wrapper.
    const safe = clip.tracks.every(track => {
      if (track === rotations[0]) return true
      if (!['eye2_1', 'eye5_5'].includes(name) || track.name !== `${name}.position` || track.getValueSize() !== 3) return false
      const rest = node.position.toArray()
      return Array.from(track.values).every((value, index) => Number.isFinite(value) && Math.abs(value - rest[index % 3]) < 1e-6)
    })
    return safe ? [new THREE.AnimationClip(clip.name, clip.duration, [rotations[0]], clip.blendMode)] : []
  })
}

/** Catalog identity, not a URL/name/tag guess. This never selects or grants a die. */
export function managedSculptedSetId(asset: GltfDiceAsset): string | null {
  const [setId, item, extra] = asset.id.split('/')
  if (!SCULPTED_SET_IDS.has(setId) || !item || extra !== undefined) return null
  if (asset.metadata.setId && asset.metadata.setId !== setId) return null
  return setId
}

/** Own only cloned materials and nodes. Geometry, maps and clips remain cache-owned. */
export function createManagedSculptedVisual(source: THREE.Group, asset: GltfDiceAsset, cel: boolean, animations: THREE.AnimationClip[] = [], response: CelLightingResponse = 'original') {
  const setId = managedSculptedSetId(asset)
  const useCel = cel && setId !== null
  const adapted = useCel ? createCelPreviewScene(source, setId === 'woodland-sculpted-set' ? 'original' : response) : null
  const scene = adapted?.scene ?? source.clone(true)
  const replacements = new Map<THREE.Material, THREE.Material>()
  // Match the cloned traversal to its cache-owned source without mutating either
  // loader materials or the opaque Toon path. Optical materials retain native PBR.
  const sourceMeshes: THREE.Mesh[] = []
  if (adapted) source.traverse(object => { if (object instanceof THREE.Mesh) sourceMeshes.push(object) })
  let meshIndex = 0
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const original = adapted ? sourceMeshes[meshIndex++].material : object.material
    const adaptedMaterials = Array.isArray(object.material) ? object.material : [object.material]
    const cloneMaterial = (material: THREE.Material, index: number) => {
      const physical = useCel && material instanceof THREE.MeshPhysicalMaterial
        && (material.transmission > 0 || material.transmissionMap !== null)
      if (adapted && !physical) return adaptedMaterials[index]
      let owned = replacements.get(material)
      if (!owned) {
        owned = physical ? cloneManagedPhysicalCel(material as THREE.MeshPhysicalMaterial, response) : material.clone()
        replacements.set(material, owned)
      }
      return owned
    }
    object.material = Array.isArray(original) ? original.map(cloneMaterial) : cloneMaterial(original, 0)
  })
  if (setId === 'woodland-sculpted-set') {
    if (cel) repairWoodlandPalette(scene, 0)
    const wrapped = new Set<THREE.Material>()
    if (useCel) scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshToonMaterial) || wrapped.has(material)) continue
        wrapped.add(material)
        // The existing palette wrapper captures its predecessor key once. Keep
        // that exact original key, but fence subsequent room-profile switches.
        const originalKey = material.customProgramCacheKey()
        material.customProgramCacheKey = () => `${originalKey}${material.defines.MANAGED_CEL_NIGHT_RESPONSE !== undefined ? '-night-v1' : ''}`
        setCelLightingResponse(material, response)
      }
    })
    if (asset.metadata.diceType === 'd8') scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.name === 'runtime pale bone numeral inlay study' && 'color' in material) {
          (material as THREE.MeshStandardMaterial).color.set('#24352f')
        }
      }
    })
  }
  // Keep all 22 cache-owned clips, but run only disjoint verified eye rotations.
  scene.animations = [...animations]
  const idles = setId === 'monster-dungeon-set' && asset.metadata.diceType === 'd6'
    ? monsterEyeIdles(scene, animations)
    : []
  const mixer = idles.length ? new THREE.AnimationMixer(scene) : null
  if (mixer) idles.forEach(clip => mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play())
  scene.userData.managedSculptedDie = { assetId: asset.id, setId, cel: useCel, ambientClip: idles[0]?.name ?? null, ambientClips: idles.map(clip => clip.name) }
  let disposed = false
  return {
    scene,
    setLightingResponse(next: CelLightingResponse) {
      if (disposed || !useCel) return
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          setCelLightingResponse(material as THREE.MeshToonMaterial, next)
        }
      })
    },
    update(delta: number, reducedMotion: boolean) {
      if (!disposed && !reducedMotion && Number.isFinite(delta) && delta > 0) mixer?.update(Math.min(delta, 0.1))
    },
    dispose() {
      if (disposed) return
      disposed = true
      mixer?.stopAllAction()
      mixer?.uncacheRoot(scene)
      adapted?.dispose()
      replacements.forEach(material => material.dispose())
    },
  }
}
