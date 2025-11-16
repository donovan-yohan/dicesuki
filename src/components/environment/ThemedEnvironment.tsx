/**
 * ThemedEnvironment Component
 *
 * Renders environmental elements (grass, particles, props) based on current theme.
 */

import { useTheme } from '../../contexts/ThemeContext'
import { GrassField } from './GrassField'
import { Particles } from './Particles'

interface ThemedEnvironmentProps {
  floorBounds?: { width: number; height: number }
}

export function ThemedEnvironment({
  floorBounds = { width: 20, height: 15 },
}: ThemedEnvironmentProps) {
  const { currentTheme } = useTheme()
  const env = currentTheme.visualEffects.environment

  if (!env) {
    return null
  }

  return (
    <>
      {/* Grass Field */}
      {env.grass && (
        <GrassField
          density={env.grass.density}
          color={env.grass.color}
          height={env.grass.height}
          floorBounds={floorBounds}
        />
      )}

      {/* Particles */}
      {env.particles && env.particles.type !== 'none' && (
        <Particles
          type={env.particles.type}
          count={env.particles.count}
          color={env.particles.color}
          bounds={{
            width: floorBounds.width,
            height: 6, // Bounds height (vertical)
            depth: floorBounds.height,
          }}
        />
      )}
    </>
  )
}
