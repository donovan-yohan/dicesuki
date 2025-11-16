/**
 * ThemedEffects Component
 *
 * Applies post-processing effects based on the current theme's visual configuration.
 * Uses @react-three/postprocessing EffectComposer for performant real-time effects.
 *
 * Supported effects:
 * - Film Grain (noise/grit)
 * - Bloom (glow)
 * - Vignette (darkened edges)
 * - Color Grading (temperature, tint, saturation)
 */

import { EffectComposer, Bloom, Noise, Vignette, HueSaturation } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { useTheme } from '../../contexts/ThemeContext'
import { useMemo, ReactElement } from 'react'

export function ThemedEffects() {
  const { currentTheme } = useTheme()
  const effects = currentTheme.visualEffects.postProcessing

  // Calculate hue shift from temperature
  // Temperature: -1 (cool blue) to 1 (warm orange)
  const hueShift = useMemo(() => {
    if (effects.colorGrading?.temperature !== undefined) {
      // Map temperature to hue rotation
      // Cool (-1) -> blue shift (-0.15)
      // Warm (1) -> orange shift (0.15)
      return effects.colorGrading.temperature * 0.15
    }
    return 0
  }, [effects.colorGrading?.temperature])

  const saturation = effects.colorGrading?.saturation ?? 1.0

  // Build effects array
  const effectsArray: ReactElement[] = []

  // Film Grain Effect
  if (effects.filmGrain) {
    effectsArray.push(
      <Noise
        key="filmGrain"
        premultiply // Blend with scene
        blendFunction={BlendFunction.OVERLAY}
        opacity={effects.filmGrain.intensity}
      />
    )
  }

  // Bloom Effect (Glow)
  if (effects.bloom) {
    effectsArray.push(
      <Bloom
        key="bloom"
        intensity={effects.bloom.intensity}
        luminanceThreshold={effects.bloom.threshold}
        luminanceSmoothing={0.9}
        radius={effects.bloom.radius}
        mipmapBlur
      />
    )
  }

  // Vignette Effect (Darkened Edges)
  if (effects.vignette) {
    effectsArray.push(
      <Vignette
        key="vignette"
        offset={effects.vignette.offset}
        darkness={effects.vignette.darkness}
        eskil={false}
      />
    )
  }

  // Color Grading (Hue/Saturation)
  if (effects.colorGrading && (saturation !== 1.0 || hueShift !== 0)) {
    effectsArray.push(
      <HueSaturation
        key="colorGrading"
        hue={hueShift}
        saturation={saturation - 1.0} // HueSaturation expects offset from 1.0
        blendFunction={BlendFunction.NORMAL}
      />
    )
  }

  // Don't render if no effects
  if (effectsArray.length === 0) {
    return null
  }

  return <EffectComposer>{effectsArray}</EffectComposer>
}
