import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { MultiplayerDie } from './MultiplayerDie'
import { useSnapshotInterpolation } from '../../hooks/useSnapshotInterpolation'

/** Visual-only ground plane (no physics) */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
      <planeGeometry args={[20, 12]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

/** Renders all dice from multiplayer store with interpolation */
function DiceRenderer() {
  const dice = useMultiplayerStore((s) => s.dice)
  const players = useMultiplayerStore((s) => s.players)
  const tRef = useSnapshotInterpolation()

  const diceArray = Array.from(dice.values())

  return (
    <>
      {diceArray.map((die) => {
        const player = players.get(die.ownerId)
        const color = player?.color || '#ffffff'

        return (
          <MultiplayerDie
            key={die.id}
            diceType={die.diceType}
            color={color}
            targetPosition={die.targetPosition}
            targetRotation={die.targetRotation}
            prevPosition={die.prevPosition}
            prevRotation={die.prevRotation}
            interpolationT={tRef.current}
          />
        )
      })}
    </>
  )
}

export function MultiplayerScene() {
  return (
    <Canvas
      shadows
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
      camera={{
        position: [0, 15, 0],
        fov: 40,
        near: 0.1,
        far: 100,
      }}
      style={{
        touchAction: 'none',
        width: '100%',
        height: '100%',
        display: 'block',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    >
      {/* Lighting — matches single-player setup */}
      <ambientLight intensity={0.6} color="#999999" />
      <directionalLight
        position={[5, 10, 5]}
        intensity={0.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <Environment preset="night" />

      {/* Visual ground (no physics) */}
      <Ground />

      {/* Dice driven by server state */}
      <DiceRenderer />
    </Canvas>
  )
}
