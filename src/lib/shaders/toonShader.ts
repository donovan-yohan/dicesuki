/**
 * Toon/Cel Shader for stylized cartoon rendering
 *
 * Features:
 * - Stepped/banded lighting (cel shading)
 * - Rim lighting for edge highlights
 * - Customizable color levels
 *
 * Based on Three.js toon shading but with custom control over banding
 */

import * as THREE from 'three'

export interface ToonShaderParams {
  color: string | THREE.Color
  levels: number // Number of color bands (3-5 recommended)
  rimPower?: number // Rim light falloff (default: 2.0)
  rimColor?: string | THREE.Color // Rim light color (default: white)
}

/**
 * Creates a custom toon shader material
 */
export function createToonMaterial(params: ToonShaderParams): THREE.ShaderMaterial {
  const {
    color,
    levels = 4,
    rimPower = 2.0,
    rimColor = '#ffffff',
  } = params

  const baseColor = typeof color === 'string' ? new THREE.Color(color) : color
  const rim = typeof rimColor === 'string' ? new THREE.Color(rimColor) : rimColor

  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: baseColor },
      uLevels: { value: levels },
      uRimPower: { value: rimPower },
      uRimColor: { value: rim },
      uLightPosition: { value: new THREE.Vector3(5, 10, 5) }, // Default directional light pos
      uAmbientColor: { value: new THREE.Color(0.3, 0.3, 0.3) },
    },

    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;

      void main() {
        // Transform normal to world space
        vNormal = normalize(normalMatrix * normal);

        // Calculate view position for rim lighting
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;

        // World position for lighting
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;

        gl_Position = projectionMatrix * mvPosition;
      }
    `,

    fragmentShader: `
      uniform vec3 uColor;
      uniform float uLevels;
      uniform float uRimPower;
      uniform vec3 uRimColor;
      uniform vec3 uLightPosition;
      uniform vec3 uAmbientColor;

      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;

      void main() {
        // Calculate light direction
        vec3 lightDir = normalize(uLightPosition - vWorldPosition);

        // Diffuse lighting (dot product)
        float diffuse = max(dot(vNormal, lightDir), 0.0);

        // Step/band the diffuse to create cel shading
        // Map continuous 0-1 to discrete levels
        float stepped = floor(diffuse * uLevels) / uLevels;

        // Ensure minimum ambient lighting
        stepped = max(stepped, 0.3);

        // Rim lighting (Fresnel-like edge highlight)
        vec3 viewDir = normalize(vViewPosition);
        float rimFactor = 1.0 - max(dot(viewDir, vNormal), 0.0);
        rimFactor = pow(rimFactor, uRimPower);

        // Combine base color with stepped lighting
        vec3 litColor = uColor * stepped;

        // Add rim light
        vec3 finalColor = litColor + (uRimColor * rimFactor * 0.5);

        // Add ambient light
        finalColor += uAmbientColor * uColor;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  })
}

/**
 * Updates toon material uniforms (for dynamic lighting changes)
 */
export function updateToonMaterialLighting(
  material: THREE.ShaderMaterial,
  lightPosition: THREE.Vector3,
  ambientColor?: THREE.Color
) {
  if (material.uniforms.uLightPosition) {
    material.uniforms.uLightPosition.value.copy(lightPosition)
  }
  if (ambientColor && material.uniforms.uAmbientColor) {
    material.uniforms.uAmbientColor.value.copy(ambientColor)
  }
}
