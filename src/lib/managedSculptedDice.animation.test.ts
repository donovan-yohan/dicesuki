import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { GltfDiceAsset } from '../types/gltfDice'
import { createManagedSculptedVisual } from './managedSculptedDice'

const asset = { id: 'monster-dungeon-set/d6', metadata: { setId: 'monster-dungeon-set', diceType: 'd6' } } as GltfDiceAsset
function fixture() {
  const scene = new THREE.Group()
  const wrapper = new THREE.Group()
  wrapper.name = 'canonical-wrapper'
  scene.add(wrapper)
  for (const name of ['1_eye', 'eye2_1', 'eye2_2', 'eye5_5']) {
    const eye = new THREE.Group()
    eye.name = name
    eye.position.set(0.5, 0.2, -0.3)
    wrapper.add(eye)
  }
  const rotation = (name: string) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2])
  const clip = (name: string, extra: THREE.KeyframeTrack[] = []) => new THREE.AnimationClip(`${name}Action`, 1, [rotation(name), ...extra])
  return { scene, wrapper, rotation, clip }
}

describe('Monster eye animation admission', () => {
  it('uses disjoint named eye rotations rather than blending the overlapping generic Action', () => {
    const { scene, clip } = fixture()
    const clips = ['1_eye', 'eye2_1', 'eye2_2', 'eye5_5'].map(name => clip(name))
    // The original GLB has both Action and eye2_2Action targeting this property.
    clips.unshift(new THREE.AnimationClip('Action', 1, [new THREE.QuaternionKeyframeTrack('eye2_2.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, -Math.SQRT1_2, Math.SQRT1_2])]))
    const owned = createManagedSculptedVisual(scene, asset, false, clips)
    owned.update(0.1, false)
    for (const name of ['1_eye', 'eye2_1', 'eye2_2', 'eye5_5']) {
      const eye = owned.scene.getObjectByName(name)!
      expect(eye.quaternion.z, name).toBeGreaterThan(0.05)
      expect(eye.position.toArray()).toEqual([0.5, 0.2, -0.3])
    }
    owned.dispose()
  })

  it.each(['eye2_1', 'eye5_5'])('accepts only redundant bind-position tracks for %s and never plays position', name => {
    const { scene, clip } = fixture()
    const position = new THREE.VectorKeyframeTrack(`${name}.position`, [0, 1], [0.5, 0.2, -0.3, 0.5, 0.2, -0.3])
    const owned = createManagedSculptedVisual(scene, asset, false, [clip(name, [position])])
    owned.update(0.1, false)
    const eye = owned.scene.getObjectByName(name)!
    expect(eye.quaternion.z).toBeGreaterThan(0.05)
    // Exact bind values, not even float32 position round-tripping.
    expect(eye.position.toArray()).toEqual([0.5, 0.2, -0.3])
    owned.dispose()
  })

  it.each(['root track', 'moving position', 'scale', 'duplicate rotation'])('rejects an entire named clip containing %s', kind => {
    const { scene, clip, rotation } = fixture()
    const extra = kind === 'root track' ? new THREE.QuaternionKeyframeTrack('canonical-wrapper.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 1, 0])
      : kind === 'duplicate rotation' ? rotation('eye2_1')
        : new THREE.VectorKeyframeTrack(`eye2_1.${kind === 'scale' ? 'scale' : 'position'}`, [0, 1], [0.5, 0.2, -0.3, 10, 10, 10])
    const owned = createManagedSculptedVisual(scene, asset, false, [clip('eye2_1', [extra])])
    owned.update(0.1, false)
    expect(owned.scene.getObjectByName('eye2_1')!.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(owned.scene.getObjectByName('canonical-wrapper')!.quaternion.toArray()).toEqual([0, 0, 0, 1])
    owned.dispose()
  })

  it.each(['duplicate clip', 'duplicate node', 'body ancestor', 'eye ancestor', 'scene root'])('refuses ambiguous or rigid-body-bearing %s targets', kind => {
    const { scene, clip } = fixture()
    const clips = [clip('1_eye')]
    if (kind === 'duplicate clip') clips.push(clip('1_eye'))
    if (kind === 'duplicate node') { const duplicate = new THREE.Group(); duplicate.name = '1_eye'; scene.add(duplicate) }
    if (kind === 'body ancestor' || kind === 'eye ancestor') {
      const child = new THREE.Group(); child.name = kind === 'body ancestor' ? 'BODY' : 'eye31'; scene.getObjectByName('1_eye')!.add(child)
    }
    if (kind === 'scene root') { scene.getObjectByName('1_eye')!.name = 'not-an-eye'; scene.name = '1_eye' }
    const owned = createManagedSculptedVisual(scene, asset, false, clips)
    owned.update(0.1, false)
    expect(owned.scene.getObjectByName('1_eye')!.quaternion.toArray()).toEqual([0, 0, 0, 1])
    owned.dispose()
  })
})
