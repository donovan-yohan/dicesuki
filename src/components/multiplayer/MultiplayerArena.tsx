import { useMemo } from 'react'
import { Box } from '@react-three/drei'
import { useEnvironmentTheme } from '../../hooks/useEnvironmentTheme'
import { useEngineConfig } from '../../config/engineConfig'

// Visual-only wall geometry (no colliders — the room's Rapier owns collisions),
// so these render heights are a client styling choice, not shared physics.
const WALL_HEIGHT = 6
const WALL_THICKNESS = 0.5
const GROUND_Y = -0.5
const CEILING_Y = 6

/**
 * Fixed 9:16 visual arena for multiplayer.
 * No physics colliders — server Rapier handles all collisions.
 * Matches the themed appearance of single-player ViewportBoundaries.
 *
 * Arena half-extents come from the room's engine config (Shared-ADR-007), the
 * single source of truth in `dicesuki-core`, so the drawn walls always match the
 * server/wasm collider bounds without a copied constant.
 */
export function MultiplayerArena() {
  const currentTheme = useEnvironmentTheme()
  const env = currentTheme.environment
  const config = useEngineConfig()
  const arenaHalfX = config?.arenaHalfX
  const arenaHalfZ = config?.arenaHalfZ

  const walls = useMemo(() => (arenaHalfX === undefined || arenaHalfZ === undefined ? [] : [
    // East wall (+X)
    { position: [arenaHalfX + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, arenaHalfZ * 2 + WALL_THICKNESS * 2] as [number, number, number] },
    // West wall (-X)
    { position: [-(arenaHalfX + WALL_THICKNESS / 2), WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, arenaHalfZ * 2 + WALL_THICKNESS * 2] as [number, number, number] },
    // North wall (+Z)
    { position: [0, WALL_HEIGHT / 2, arenaHalfZ + WALL_THICKNESS / 2] as [number, number, number],
      size: [arenaHalfX * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number] },
    // South wall (-Z)
    { position: [0, WALL_HEIGHT / 2, -(arenaHalfZ + WALL_THICKNESS / 2)] as [number, number, number],
      size: [arenaHalfX * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number] },
  ]), [arenaHalfX, arenaHalfZ])

  // Nothing to draw until the room delivers its engine config (arena bounds).
  // In the app this is present on the first connected render; this guard just
  // keeps the component safe before a room exists.
  if (arenaHalfX === undefined || arenaHalfZ === undefined) {
    return null
  }

  return (
    <>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
        <planeGeometry args={[arenaHalfX * 2 + 2, arenaHalfZ * 2 + 2]} />
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

      {/* Ceiling: server physics always collides here; keep it invisible unless themed. */}
      <Box args={[arenaHalfX * 2 + 2, 0.5, arenaHalfZ * 2 + 2]} position={[0, CEILING_Y, 0]}>
        <meshStandardMaterial
          color={env.ceiling.color || env.walls.color}
          transparent
          opacity={env.ceiling.visible && env.ceiling.color ? 0.35 : 0}
          depthWrite={false}
        />
      </Box>
    </>
  )
}
