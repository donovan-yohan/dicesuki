import { MeshPhysicalMaterial } from 'three'
import { setCelLightingResponse, woodlandCelBandFunctions, type CelLightingResponse } from './woodlandCelMaterial'

/** Preserve the native optical pipeline; only its reflected diffuse light is banded. */
export function cloneManagedPhysicalCel(source: MeshPhysicalMaterial, response: CelLightingResponse = 'original'): MeshPhysicalMaterial {
  const material = source.clone()
  setCelLightingResponse(material, response)
  const compile = source.onBeforeCompile
  const cacheKey = source.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${woodlandCelBandFunctions}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
// Accumulate illumination against white, rather than posterizing painted albedo.
// Physical specular parameters have already been derived from the native albedo.
vec3 woodlandCelAlbedo = material.diffuseColor;
material.diffuseColor = vec3(1.0);`)
      .replace('#include <transmission_fragment>', `
// Native direct shadows, indirect light/light maps and AO have all accumulated.
totalDiffuse = woodlandCelAlbedo * woodlandCelBands(totalDiffuse);
// Refraction needs the original absorption/albedo, not the white light probe.
material.diffuseColor = woodlandCelAlbedo;
#include <transmission_fragment>`)
  }
  material.customProgramCacheKey = () => `${cacheKey}-managed-physical-cel-v1${material.defines.MANAGED_CEL_NIGHT_RESPONSE !== undefined ? '-night-v1' : ''}`
  material.userData.managedPhysicalCel = true
  return material
}
