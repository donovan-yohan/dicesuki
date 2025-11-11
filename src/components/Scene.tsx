import { useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Box } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'
import { PerformanceOverlay } from '../hooks/usePerformanceMonitor'
import { D6, D6Handle } from './dice/D6'
import { RollButton } from './RollButton'
import { useDiceRoll } from '../hooks/useDiceRoll'

/**
 * Main 3D scene component
 * Sets up React Three Fiber Canvas with Rapier physics
 */
function Scene() {
  const diceRef = useRef<D6Handle>(null)
  const { canRoll, isRolling, lastResult, rollHistory, roll, onDiceRest } = useDiceRoll()

  // Debug: Log when lastResult changes
  console.log('Scene render - lastResult:', lastResult, 'canRoll:', canRoll, 'isRolling:', isRolling)

  const handleRollClick = useCallback(() => {
    console.log('Roll button clicked')
    const impulse = roll()
    console.log('Impulse generated:', impulse)
    if (impulse && diceRef.current) {
      diceRef.current.applyImpulse(impulse)
    }
  }, [roll])

  const handleDiceRest = useCallback((faceValue: number) => {
    console.log('Dice rolled:', faceValue)
    onDiceRest(faceValue)
  }, [onDiceRest])

  return (
    <>
      <Canvas
        shadows
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]} // Device pixel ratio (1x for low-end, 2x for high-end)
      >
        {/* Camera setup */}
        <PerspectiveCamera makeDefault position={[0, 5, 10]} fov={50} />

        {/* Camera controls */}
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={5}
          maxDistance={20}
          maxPolarAngle={Math.PI / 2}
        />

        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        {/* Physics world */}
        <Physics gravity={[0, -9.81, 0]}>
          {/* Ground Plane - Larger to prevent falling off */}
          <RigidBody type="fixed" position={[0, -0.25, 0]}>
            <Box args={[20, 0.5, 20]} receiveShadow>
              <meshStandardMaterial color="#444444" />
            </Box>
          </RigidBody>

          {/* Invisible walls to contain dice */}
          {/* North wall */}
          <RigidBody type="fixed" position={[0, 2, -10]}>
            <Box args={[20, 4, 0.5]}>
              <meshStandardMaterial transparent opacity={0} />
            </Box>
          </RigidBody>
          {/* South wall */}
          <RigidBody type="fixed" position={[0, 2, 10]}>
            <Box args={[20, 4, 0.5]}>
              <meshStandardMaterial transparent opacity={0} />
            </Box>
          </RigidBody>
          {/* East wall */}
          <RigidBody type="fixed" position={[10, 2, 0]}>
            <Box args={[0.5, 4, 20]}>
              <meshStandardMaterial transparent opacity={0} />
            </Box>
          </RigidBody>
          {/* West wall */}
          <RigidBody type="fixed" position={[-10, 2, 0]}>
            <Box args={[0.5, 4, 20]}>
              <meshStandardMaterial transparent opacity={0} />
            </Box>
          </RigidBody>

          {/* D6 Dice */}
          <D6
            ref={diceRef}
            position={[0, 5, 0]}
            rotation={[Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI]}
            size={1}
            color="orange"
            onRest={handleDiceRest}
          />
        </Physics>

        {/* Performance monitoring */}
        <PerformanceOverlay />
      </Canvas>

      {/* Result Display */}
      {lastResult !== null && (
        <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-6 py-4 rounded-lg text-center z-20 shadow-xl">
          <div className="text-sm text-gray-300 mb-1">You rolled:</div>
          <div className="text-4xl font-bold">{lastResult}</div>
        </div>
      )}

      {/* Roll Button */}
      <RollButton onClick={handleRollClick} disabled={!canRoll} />

      {/* Roll History (optional, for debugging) */}
      {rollHistory.length > 0 && (
        <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg text-sm">
          <div className="text-gray-400 mb-1">History:</div>
          <div className="flex gap-2">
            {rollHistory.slice(-5).map((value, idx) => (
              <span key={idx} className="text-orange-400">{value}</span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default Scene
