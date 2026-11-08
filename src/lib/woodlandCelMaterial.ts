import { Group, Material, Mesh, MeshPhysicalMaterial, MeshToonMaterial } from 'three'

const attached = new WeakSet<MeshToonMaterial>()

/** Room illumination response, independent of the selected managed family. */
export type CelLightingResponse = 'original' | 'night'

/** Recompile only owned materials; switching rooms must not restart an idle mixer. */
export function setCelLightingResponse(material: MeshToonMaterial | MeshPhysicalMaterial, response: CelLightingResponse): void {
  const night = response === 'night'
  if ((material.defines.MANAGED_CEL_NIGHT_RESPONSE !== undefined) === night) return
  material.defines = { ...material.defines }
  if (night) material.defines.MANAGED_CEL_NIGHT_RESPONSE = ''
  else delete material.defines.MANAGED_CEL_NIGHT_RESPONSE
  material.needsUpdate = true
}

// Screen-locked ordered coverage only at band boundaries; no temporal noise and
// no material.dithering (which would add unrelated output-color noise).
export const woodlandCelBandFunctions = /* glsl */`
float woodlandCelBayer(vec2 pixel) {
  vec2 p = mod(floor(pixel), 4.0);
  float low = mod(p.x, 2.0) * 2.0 + mod(p.y, 2.0) * 3.0;
  low = mod(low, 4.0);
  vec2 high = floor(p / 2.0);
  float upper = mod(high.x * 2.0 + high.y * 3.0, 4.0);
  return (low * 4.0 + upper + 0.5) / 16.0;
}
float woodlandCelEdge(float light, float threshold, float width, float ordered) {
  if (width <= 0.0) return step(threshold, light);
  float center = threshold + (ordered - 0.5) * width * 0.65;
  return smoothstep(center - width * 0.175, center + width * 0.175, light);
}
vec3 woodlandCelBands(vec3 illumination) {
  float light = max(dot(illumination, vec3(0.2126, 0.7152, 0.0722)), 0.0) / 0.80714;
  float width = 0.0;
  #if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
    // Total dither + analytic transition spans at most one derivative footprint.
    width = min(fwidth(light), 0.015);
  #endif
  float ordered = woodlandCelBayer(gl_FragCoord.xy);
  #ifdef MANAGED_CEL_NIGHT_RESPONSE
    // Quantize actual incident intensity, retaining its RGB ratio separately.
    // No artificial ambient floor: an unlit, nonemissive receiver is black.
    float peak = max(max(illumination.r, illumination.g), illumination.b);
    vec3 hue = max(illumination, vec3(0.0)) / max(peak, 0.00001);
    float band = 0.0;
    band = mix(band, 0.09, woodlandCelEdge(light, 0.035, width, ordered));
    band = mix(band, 0.24, woodlandCelEdge(light, 0.12, width, ordered));
    band = mix(band, 0.52, woodlandCelEdge(light, 0.35, width, ordered));
    band = mix(band, 1.0, woodlandCelEdge(light, 0.8, width, ordered));
    return hue * band;
  #else
  vec3 band = vec3(0.56, 0.65, 0.61);
  band = mix(band, vec3(0.70, 0.77, 0.70), woodlandCelEdge(light, 0.09, width, ordered));
  band = mix(band, vec3(0.88, 0.90, 0.80), woodlandCelEdge(light, 0.38, width, ordered));
  return mix(band, vec3(1.0, 0.98, 0.90), woodlandCelEdge(light, 0.76, width, ordered));
  #endif
}
`

/** Compose after existing hooks; quantize shadowed, AO-modulated lighting, not albedo. */
export function attachCombinedCel(material: MeshToonMaterial, options?: { vertexOcclusion?: boolean; response?: CelLightingResponse }): void {
  material.defines = { ...material.defines }
  if (options?.vertexOcclusion) material.defines.WOODLAND_CEL_VERTEX_OCCLUSION = ''
  else delete material.defines.WOODLAND_CEL_VERTEX_OCCLUSION
  setCelLightingResponse(material, options?.response ?? 'original')
  material.gradientMap = null
  // Three r162 reads extensions on built-ins too, although only ShaderMaterial
  // declares them in @types/three.
  const extended = material as MeshToonMaterial & { extensions?: { derivatives?: boolean } }
  extended.extensions = { ...extended.extensions, derivatives: true }
  material.userData.woodlandCombinedCel = true
  material.needsUpdate = true
  if (attached.has(material)) return
  attached.add(material)
  const compile = material.onBeforeCompile
  const cacheKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    shader.vertexShader = `
#ifdef WOODLAND_CEL_VERTEX_OCCLUSION
attribute float _cel_occlusion;
varying float vWoodlandCelOcclusion;
#endif
${shader.vertexShader}`.replace('void main() {', `void main() {
#ifdef WOODLAND_CEL_VERTEX_OCCLUSION
vWoodlandCelOcclusion = _cel_occlusion;
#endif`)
    shader.fragmentShader = `
#ifdef WOODLAND_CEL_VERTEX_OCCLUSION
varying float vWoodlandCelOcclusion;
#endif
${shader.fragmentShader}`
      .replace('#include <gradientmap_pars_fragment>', `
vec3 getGradientIrradiance(const in vec3 normal, const in vec3 lightDirection) {
  return vec3(max(dot(normal, lightDirection), 0.0));
}
${woodlandCelBandFunctions}`)
      .replace('#include <lights_toon_fragment>', `ToonMaterial material;
material.diffuseColor = vec3( 1.0 );`)
      .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', `
float woodlandCelOcclusion = 1.0;
#ifdef WOODLAND_CEL_VERTEX_OCCLUSION
woodlandCelOcclusion = clamp(vWoodlandCelOcclusion, 0.0, 1.0);
#endif
vec3 woodlandCelIllumination = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse * woodlandCelOcclusion;
vec3 outgoingLight = diffuseColor.rgb * woodlandCelBands(woodlandCelIllumination) + totalEmissiveRadiance;`)
  }
  material.customProgramCacheKey = () => `${cacheKey}-woodland-combined-cel-v1${material.defines.MANAGED_CEL_NIGHT_RESPONSE !== undefined ? '-night-v1' : ''}`
}

/** Clone nodes and own replacements only; geometry/textures remain loader-owned. */
export function createCelPreviewScene(source: Group, response: CelLightingResponse = 'original'): { scene: Group; dispose(): void } {
  const scene = source.clone(true)
  const replacements = new Map<Material, Map<boolean, MeshToonMaterial>>()
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return
    const vertexOcclusion = object.geometry.hasAttribute('_cel_occlusion')
    const adapt = (original: Material): MeshToonMaterial => {
      let variants = replacements.get(original)
      if (!variants) {
        variants = new Map()
        replacements.set(original, variants)
      }
      const cached = variants.get(vertexOcclusion)
      if (cached) return cached
      const replacement = new MeshToonMaterial()
      // Base state includes clipping, blending, alpha/depth/side, and userData.
      Material.prototype.copy.call(replacement, original)
      const input = original as unknown as Record<string, unknown>
      const output = replacement as unknown as Record<string, unknown>
      for (const key of [
        'color', 'map', 'vertexColors', 'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity',
        'emissive', 'emissiveIntensity', 'emissiveMap', 'bumpMap', 'bumpScale', 'normalMap',
        'normalMapType', 'normalScale', 'displacementMap', 'displacementScale', 'displacementBias',
        'alphaMap', 'wireframe', 'wireframeLinewidth', 'fog',
      ]) {
        const value = input[key]
        if (value === undefined) continue
        if (key === 'color' || key === 'emissive' || key === 'normalScale') {
          (output[key] as { copy(value: unknown): void }).copy(value)
        } else output[key] = value
      }
      replacement.name = original.name
      attachCombinedCel(replacement, { vertexOcclusion, response })
      variants.set(vertexOcclusion, replacement)
      return replacement
    }
    object.material = Array.isArray(object.material) ? object.material.map(adapt) : adapt(object.material)
  })
  let disposed = false
  return {
    scene,
    dispose() {
      if (disposed) return
      disposed = true
      replacements.forEach(variants => variants.forEach(material => material.dispose()))
    },
  }
}
