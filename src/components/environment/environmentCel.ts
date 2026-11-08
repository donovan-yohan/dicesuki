import * as THREE from 'three'

// Ported from the reviewed dungeon. Real Three lights/shadows precede band selection.
export function attachWorldCel(material: THREE.MeshToonMaterial, response: 'original' | 'night' = 'original') {
  material.gradientMap = null;
  const extended = material as THREE.MeshToonMaterial & { extensions?: { derivatives?: boolean } };
  extended.extensions = { ...extended.extensions, derivatives: true };
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <gradientmap_pars_fragment>', `
vec3 getGradientIrradiance(const in vec3 normal, const in vec3 lightDirection) {
  return vec3(max(dot(normal, lightDirection), 0.0));
}
vec3 dungeonBands(vec3 illumination) {
  float light = max(dot(illumination, vec3(.2126,.7152,.0722)), .0001);
  float width = .003;
  #if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
    width = min(fwidth(light), .009) + .001;
  #endif
  float band = .26;
  band = mix(band, .45, smoothstep(.075-width,.075+width,light));
  band = mix(band, .68, smoothstep(.23-width,.23+width,light));
  band = mix(band, .94, smoothstep(.52-width,.52+width,light));
  vec3 hue = clamp(illumination / light, vec3(.65), vec3(1.35));
  return band * mix(vec3(.80,.87,1.0),hue,.58);
}`)
      .replace('#include <lights_toon_fragment>', 'ToonMaterial material; material.diffuseColor = vec3(1.0);')
      .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', 'vec3 outgoingLight = diffuseColor.rgb * dungeonBands(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) + totalEmissiveRadiance;');
    if (response === 'night') {
      // Keep source hue and falloff: a bright floor band would erase local pools.
      shader.fragmentShader = shader.fragmentShader
        .replace('float band = .26;', 'float band = .045;')
        .replace('mix(band, .45,', 'mix(band, .12,')
        .replace('mix(band, .68,', 'mix(band, .38,')
        .replace('mix(band, .94,', 'mix(band, .85,')
        .replace('vec3(.65), vec3(1.35)', 'vec3(.08), vec3(2.5)')
        .replace('mix(vec3(.80,.87,1.0),hue,.58)', 'mix(vec3(1.0),hue,.9)');
    }
    material.userData.compiled = true;
  };
  material.customProgramCacheKey = () => response === 'original' ? 'monster-dungeon-combined-cel-v1' : 'world-night-combined-cel-v1';
  material.userData.dungeonCel = true;
  return material;
}
