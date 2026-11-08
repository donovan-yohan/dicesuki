import { Camera, MathUtils, Mesh, Vector2, Vector3, Vector4 } from 'three'
import { ROOM_DICE_CAPACITY } from '../../config/roomCapacity'
import { getDiceShapeSize } from '../../lib/diceShapeScale'
import type { GrassContactDie } from './grassInteraction'

/** Instance-owned color-pass cutouts. No transparency, scene searches or shadow edits. */
export function createFoliageReveal(mesh: Mesh) {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const centers = Array.from({ length: ROOM_DICE_CAPACITY }, () => new Vector4())
  const uniforms = {
    uFoliageReveals: { value: centers },
    uFoliageRevealCount: { value: 0 },
    uFoliageRevealEnabled: { value: 0 },
  }
  const position = new Vector3(), projected = new Vector3()
  const priorCompile = material.onBeforeCompile, priorCacheKey = material.customProgramCacheKey
  const priorKey = priorCacheKey.call(material)
  const priorRender = mesh.onBeforeRender
  let primaryCamera: Camera | undefined, disposed = false
  material.onBeforeCompile = (shader, renderer) => {
    priorCompile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `varying float vFoliageViewDepth;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFoliageViewDepth = -mvPosition.z;')
    shader.fragmentShader = `varying float vFoliageViewDepth;
      uniform vec4 uFoliageReveals[${ROOM_DICE_CAPACITY}];
      uniform int uFoliageRevealCount; uniform float uFoliageRevealEnabled;
      ${shader.fragmentShader}`.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (uFoliageRevealEnabled > 0.5) {
        float revealCoverage = 0.0;
        for (int i = 0; i < ${ROOM_DICE_CAPACITY}; i++) {
          if (i >= uFoliageRevealCount) break;
          vec4 reveal = uFoliageReveals[i];
          if (vFoliageViewDepth < reveal.w) {
            float radius = length(gl_FragCoord.xy - reveal.xy) / reveal.z;
            revealCoverage = max(revealCoverage, 1.0 - smoothstep(0.78, 1.0, radius));
          }
        }
        // Fixed pixel pattern: soft edge without animated noise or sorting.
        float threshold = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
        if (revealCoverage > threshold) discard;
      }`)
  }
  material.customProgramCacheKey = () => `${priorKey}-foliage-reveal-v1`
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, renderedMaterial, group) {
    priorRender.call(this, renderer, scene, camera, geometry, renderedMaterial, group)
    uniforms.uFoliageRevealEnabled.value = !disposed && camera === primaryCamera ? 1 : 0
  }
  return {
    uniforms,
    update(dice: ReadonlyMap<string, GrassContactDie>, interpolation: number, camera?: Camera, pixels?: Vector2) {
      uniforms.uFoliageRevealCount.value = 0
      primaryCamera = camera
      if (disposed || !camera || !pixels || !(pixels.x > 0 && pixels.y > 0)
        || !Number.isFinite(pixels.x + pixels.y) || !Number.isFinite(interpolation)) return
      camera.updateWorldMatrix(true, false)
      const t = MathUtils.clamp(interpolation, 0, 1)
      const projection = camera.projectionMatrix.elements
      const perspective = projection[11] === -1
      let inspected = 0
      for (const die of dice.values()) {
        if (inspected++ === ROOM_DICE_CAPACITY) break
        position.fromArray(die.prevPosition)
        position.x += (die.targetPosition[0] - position.x) * t
        position.y += (die.targetPosition[1] - position.y) * t
        position.z += (die.targetPosition[2] - position.z) * t
        position.applyMatrix4(camera.matrixWorldInverse)
        const depth = -position.z
        const size = getDiceShapeSize(die.diceType, 1)
        const worldRadius = die.diceType === 'd6' ? size * Math.sqrt(3) / 2 : size
        if (!Number.isFinite(position.x + position.y + depth) || depth <= worldRadius + .1) continue
        projected.copy(position).applyMatrix4(camera.projectionMatrix)
        if (projected.z < -1 || projected.z > 1) continue
        // Conservative projected sphere, including off-axis perspective. The
        // clear core contains the full die plus a small world-space margin.
        const focal = Math.max(Math.abs(projection[0]) * pixels.x, Math.abs(projection[5]) * pixels.y) / 2
        const radius = focal * (worldRadius + .12) * (perspective
          ? Math.sqrt(1 + (position.x * position.x + position.y * position.y) / (depth * depth)) / (depth - worldRadius - .12)
          : 1) / .78
        const x = (projected.x + 1) * pixels.x / 2, y = (projected.y + 1) * pixels.y / 2
        if (!Number.isFinite(x + y + radius) || radius <= 0 || x + radius < 0 || y + radius < 0 || x - radius > pixels.x || y - radius > pixels.y) continue
        centers[uniforms.uFoliageRevealCount.value++].set(x, y, radius, depth - worldRadius)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      uniforms.uFoliageRevealCount.value = uniforms.uFoliageRevealEnabled.value = 0
      primaryCamera = undefined
      material.onBeforeCompile = priorCompile
      material.customProgramCacheKey = priorCacheKey
      mesh.onBeforeRender = priorRender
    },
  }
}
