import { useMemo } from 'react'
import { Box } from '@react-three/drei'
import { useTheme } from '../../contexts/ThemeContext'
import {
  MULTIPLAYER_ARENA_HALF_X,
  MULTIPLAYER_ARENA_HALF_Z,
} from '../../config/physicsConfig'

const WALL_HEIGHT = 6
const WALL_THICKNESS = 0.5
const GROUND_Y = -0.5
const CEILING_Y = 6

/**
 * Fixed 9:16 visual arena for multiplayer.
 * No physics colliders — server Rapier handles all collisions.
 * Matches the themed appearance of single-player ViewportBoundaries.
 */
export function MultiplayerArena() {
  const { currentTheme } = useTheme()
  const env = currentTheme.environment

  const walls = useMemo(() => [
    // East wall (+X)
    { position: [MULTIPLAYER_ARENA_HALF_X + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, MULTIPLAYER_ARENA_HALF_Z * 2 + WALL_THICKNESS * 2] as [number, number, number] },
    // West wall (-X)
    { position: [-(MULTIPLAYER_ARENA_HALF_X + WALL_THICKNESS / 2), WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, MULTIPLAYER_ARENA_HALF_Z * 2 + WALL_THICKNESS * 2] as [number, number, number] },
    // North wall (+Z)
    { position: [0, WALL_HEIGHT / 2, MULTIPLAYER_ARENA_HALF_Z + WALL_THICKNESS / 2] as [number, number, number],
      size: [MULTIPLAYER_ARENA_HALF_X * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number] },
    // South wall (-Z)
    { position: [0, WALL_HEIGHT / 2, -(MULTIPLAYER_ARENA_HALF_Z + WALL_THICKNESS / 2)] as [number, number, number],
      size: [MULTIPLAYER_ARENA_HALF_X * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number] },
  ], [])

  return (
    <>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
        <planeGeometry args={[MULTIPLAYER_ARENA_HALF_X * 2 + 2, MULTIPLAYER_ARENA_HALF_Z * 2 + 2]} />
        <meshStandardMaterial
          color={env.floor.color}
          roughness={env.floor.material.roughness}
          metalness={env.floor.material.metalness}
        />
      </mesh>

      {/* Walls */}
      {env.walls.visible && walls.map((wall, i) => (
        <Box key={i} args={wall.size} position={wall.position}>
          <meshStandardMaterial
            color={env.walls.color}
            roughness={env.walls.material.roughness}
            metalness={env.walls.material.metalness}
          />
        </Box>
      ))}

      {/* Ceiling */}
      {env.ceiling.visible && (
        <Box args={[MULTIPLAYER_ARENA_HALF_X * 2 + 2, 0.5, MULTIPLAYER_ARENA_HALF_Z * 2 + 2]} position={[0, CEILING_Y, 0]}>
          <meshStandardMaterial
            color={env.ceiling.color || env.walls.color}
            transparent
            opacity={env.ceiling.color ? 1 : 0}
          />
        </Box>
      )}
    </>
  )
}
