import type { DirectionalLightShadow } from 'three'

/** Changing mapSize alone leaves Three's already-allocated render targets stale. */
export function setDirectionalShadowMapSize(shadow: DirectionalLightShadow, size: number): void {
  const staleTarget = [shadow.map, shadow.mapPass].some(target =>
    target !== null && (target.width !== size || target.height !== size),
  )
  if (shadow.mapSize.x === size && shadow.mapSize.y === size && !staleTarget) return

  // Three allocates only when map is null; VSM's optional blur target must also
  // be discarded. Compare real target dimensions even if a reconciler already
  // changed mapSize before this call. Do not touch the arena camera/frustum.
  shadow.dispose()
  shadow.map = null
  shadow.mapPass = null
  shadow.mapSize.set(size, size)
  shadow.needsUpdate = true
}
