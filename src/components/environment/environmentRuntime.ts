import type { Group, Object3D, Texture } from 'three'

export interface EnvironmentResources {
  root: Group
  update(delta: number, animate: boolean): void
  dispose(): void
}

/** Effect-owned roots, not render-owned memoized GPU objects. */
export function createEnvironmentOwner(scene: Object3D, resources: EnvironmentResources) {
  let retired = false
  scene.add(resources.root)
  return {
    update(delta: number, animate: boolean) {
      if (!retired) resources.update(Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.05)) : 0, animate)
    },
    dispose() {
      if (retired) return
      retired = true
      resources.root.removeFromParent()
      resources.dispose()
    },
  }
}

/** TextureLoader cannot cancel decode. Every callback crosses this lifetime gate. */
export function createTextureOwner() {
  let retired = false
  const textures = new Set<Texture>()
  return {
    accept(texture: Texture, publish: (texture: Texture) => void) {
      if (retired) { texture.dispose(); return }
      textures.add(texture)
      publish(texture)
    },
    dispose() {
      if (retired) return
      retired = true
      textures.forEach(texture => texture.dispose())
      textures.clear()
    },
  }
}

/** Move dressing anchors, never rescale physics, dice or a root transform. */
export function resolveWorldLayout(halfX: number, halfZ: number) {
  return {
    edgeX: (x: number) => Math.sign(x) * (Math.abs(x) <= 4.9 ? Math.abs(x) / 4.9 * halfX : halfX + Math.abs(x) - 4.9),
    edgeZ: (z: number) => Math.sign(z) * Math.max(0, halfZ + Math.abs(z) - 5.2),
    groundSize: Math.max(80, Math.hypot(halfX, halfZ) * 8),
  }
}
