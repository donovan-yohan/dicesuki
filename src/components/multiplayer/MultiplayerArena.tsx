import { useMemo } from 'react'
import { Box } from '@react-three/drei'
import { useTheme } from '../../contexts/ThemeContext'
import { ThemedSurfaceMaterial } from '../environment/ThemedSurfaceMaterial'
import {
  MULTIPLAYER_ARENA_HALF_X,
  MULTIPLAYER_ARENA_HALF_Z,
} from '../../config/physicsConfig'

const WALL_HEIGHT = 6
const WALL_THICKNESS = 0.5
const GROUND_Y = -0.5
const CEILING_Y = 6
const FLOOR_WIDTH = MULTIPLAYER_ARENA_HALF_X * 2 + 2
const FLOOR_DEPTH = MULTIPLAYER_ARENA_HALF_Z * 2 + 2

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
      size: [WALL_THICKNESS, WALL_HEIGHT, MULTIPLAYER_ARENA_HALF_Z * 2 + WALL_THICKNESS * 2] as [number, number, number],
      surfaceSize: [MULTIPLAYER_ARENA_HALF_Z * 2 + WALL_THICKNESS * 2, WALL_HEIGHT] as [number, number] },
    // West wall (-X)
    { position: [-(MULTIPLAYER_ARENA_HALF_X + WALL_THICKNESS / 2), WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, MULTIPLAYER_ARENA_HALF_Z * 2 + WALL_THICKNESS * 2] as [number, number, number],
      surfaceSize: [MULTIPLAYER_ARENA_HALF_Z * 2 + WALL_THICKNESS * 2, WALL_HEIGHT] as [number, number] },
    // North wall (+Z)
    { position: [0, WALL_HEIGHT / 2, MULTIPLAYER_ARENA_HALF_Z + WALL_THICKNESS / 2] as [number, number, number],
      size: [MULTIPLAYER_ARENA_HALF_X * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number],
      surfaceSize: [MULTIPLAYER_ARENA_HALF_X * 2 + WALL_THICKNESS * 2, WALL_HEIGHT] as [number, number] },
    // South wall (-Z)
    { position: [0, WALL_HEIGHT / 2, -(MULTIPLAYER_ARENA_HALF_Z + WALL_THICKNESS / 2)] as [number, number, number],
      size: [MULTIPLAYER_ARENA_HALF_X * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number],
      surfaceSize: [MULTIPLAYER_ARENA_HALF_X * 2 + WALL_THICKNESS * 2, WALL_HEIGHT] as [number, number] },
  ], [])

  return (
    <>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_WIDTH, FLOOR_DEPTH]} />
        <ThemedSurfaceMaterial
          color={env.floor.color}
          roughness={env.floor.material.roughness}
          metalness={env.floor.material.metalness}
          texture={env.floor.texture}
          albedoTexture={env.floor.albedoTexture}
          colorTexture={env.floor.colorTexture}
          normalTexture={env.floor.normalTexture}
          normalScale={env.floor.normalScale}
          tileSize={env.floor.tileSize}
          repeat={env.floor.repeat}
          surfaceSize={[FLOOR_WIDTH, FLOOR_DEPTH]}
        />
      </mesh>

      {/* Walls */}
      {env.walls.visible && walls.map((wall, i) => (
        <Box key={i} args={wall.size} position={wall.position}>
          <ThemedSurfaceMaterial
            color={env.walls.color}
            roughness={env.walls.material.roughness}
            metalness={env.walls.material.metalness}
            texture={env.walls.texture}
            albedoTexture={env.walls.albedoTexture}
            colorTexture={env.walls.colorTexture}
            normalTexture={env.walls.normalTexture}
            normalScale={env.walls.normalScale}
            tileSize={env.walls.tileSize}
            repeat={env.walls.repeat}
            surfaceSize={wall.surfaceSize}
          />
        </Box>
      ))}

      {/* Ceiling */}
      {env.ceiling.visible && (
        <Box args={[FLOOR_WIDTH, 0.5, FLOOR_DEPTH]} position={[0, CEILING_Y, 0]}>
          <ThemedSurfaceMaterial
            color={env.ceiling.color ?? env.walls.color}
            roughness={env.ceiling.material?.roughness ?? env.walls.material.roughness}
            metalness={env.ceiling.material?.metalness ?? env.walls.material.metalness}
            texture={env.ceiling.texture}
            albedoTexture={env.ceiling.albedoTexture}
            colorTexture={env.ceiling.colorTexture}
            normalTexture={env.ceiling.normalTexture}
            normalScale={env.ceiling.normalScale}
            tileSize={env.ceiling.tileSize}
            repeat={env.ceiling.repeat}
            surfaceSize={[FLOOR_WIDTH, FLOOR_DEPTH]}
            transparent
            opacity={env.ceiling.color || env.ceiling.texture || env.ceiling.albedoTexture || env.ceiling.colorTexture ? 1 : 0}
          />
        </Box>
      )}
    </>
  )
}
