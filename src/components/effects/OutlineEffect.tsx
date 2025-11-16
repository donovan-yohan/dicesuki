/**
 * Outline Effect for Toon/Cel Shading
 *
 * Creates dark outlines around objects for cartoon aesthetic.
 * Uses Sobel edge detection on depth and normal buffers.
 */

import { Effect } from 'postprocessing'
import { Uniform } from 'three'
import { forwardRef } from 'react'

const fragmentShader = `
uniform float edgeStrength;
uniform vec3 edgeColor;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 texelSize = 1.0 / vec2(textureSize(inputBuffer, 0));

  // Sobel edge detection kernel
  float edge = 0.0;

  // Sample surrounding pixels for edge detection
  for(float x = -1.0; x <= 1.0; x += 1.0) {
    for(float y = -1.0; y <= 1.0; y += 1.0) {
      vec2 offset = vec2(x, y) * texelSize;
      vec4 sample = texture2D(inputBuffer, uv + offset);

      // Use luminance for edge detection
      float luminance = dot(sample.rgb, vec3(0.299, 0.587, 0.114));
      edge += abs(luminance - dot(inputColor.rgb, vec3(0.299, 0.587, 0.114)));
    }
  }

  edge = smoothstep(0.0, edgeStrength, edge);

  // Mix outline color with original color
  outputColor = mix(inputColor, vec4(edgeColor, 1.0), edge);
}
`

let _edgeStrength = 0.5

class OutlineEffectImpl extends Effect {
  constructor({
    edgeStrength = 0.5,
    edgeColor = [0, 0, 0],
  }: {
    edgeStrength?: number
    edgeColor?: [number, number, number]
  }) {
    super('OutlineEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['edgeStrength', new Uniform(edgeStrength)],
        ['edgeColor', new Uniform(edgeColor)],
      ] as [string, Uniform][]),
    })

    _edgeStrength = edgeStrength
  }

  get edgeStrength() {
    return _edgeStrength
  }

  set edgeStrength(value: number) {
    _edgeStrength = value
    this.uniforms.get('edgeStrength')!.value = value
  }
}

export const OutlineEffect = forwardRef<
  OutlineEffectImpl,
  {
    edgeStrength?: number
    edgeColor?: [number, number, number]
  }
>(function OutlineEffect({ edgeStrength, edgeColor }, ref) {
  const effect = new OutlineEffectImpl({ edgeStrength, edgeColor })
  return <primitive ref={ref} object={effect} dispose={null} />
})
