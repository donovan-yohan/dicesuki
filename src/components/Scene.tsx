import { useRef, useCallback, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Box } from '@react-three/drei'
import { useEffect } from 'react'
import { Physics, RigidBody } from '@react-three/rapier'
import { PerformanceOverlay } from '../hooks/usePerformanceMonitor'
import { D6, D6Handle } from './dice/D6'
import { RollButton } from './RollButton'
import { DeviceMotionButton } from './DeviceMotionButton'
import { useDiceRoll } from '../hooks/useDiceRoll'
import { useDiceStore } from '../store/useDiceStore'

/**
 * Main 3D scene component
 * Sets up React Three Fiber Canvas with Rapier physics
 *
 * CRITICAL ARCHITECTURE:
 * - Physics world (Canvas) must NEVER re-render due to UI state changes
 * - UI state (lastResult, rollHistory) is in Zustand store
 * - Only UI components subscribe to store, not the Scene component
 */
function Scene() {
  console.log('🎬 Scene component rendered')

  const diceRef = useRef<D6Handle>(null)
  const { canRoll, roll, onDiceRest } = useDiceRoll()

  // Component to set up top-down camera
  function CameraSetup() {
    const { camera } = useThree()

    useEffect(() => {
      camera.position.set(0, 12, 0)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }, [camera])

    return null
  }

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

  // Memoize Canvas to prevent re-renders when UI state changes
  // This is CRITICAL to prevent physics world corruption
  const canvas = useMemo(() => (
    <Canvas
      shadows
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]} // Device pixel ratio (1x for low-end, 2x for high-end)
    >
      {/* Set up top-down camera */}
      <CameraSetup />

      {/* Lighting - optimized for top-down view */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[5, 15, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
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
  ), [handleDiceRest]) // Only re-create if handleDiceRest changes (which it shouldn't)

  return (
    <>
      {canvas}

      {/* Result Display - subscribes to store */}
      <ResultDisplay />

      {/* Roll Button */}
      <RollButton onClick={handleRollClick} disabled={!canRoll} />

      {/* Device Motion Permission Button */}
      <DeviceMotionButton />

      {/* Roll History */}
      <HistoryDisplay />
    </>
  )
}

/**
 * Result display component
 * Subscribes ONLY to lastResult from store
 */
function ResultDisplay() {
  const lastResult = useDiceStore((state) => state.lastResult)

  console.log('📊 ResultDisplay render - lastResult:', lastResult)

  if (lastResult === null) return null

  return (
    <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-6 py-4 rounded-lg text-center z-20 shadow-xl">
      <div className="text-sm text-gray-300 mb-1">You rolled:</div>
      <div className="text-4xl font-bold">{lastResult}</div>
    </div>
  )
}

/**
 * History display component
 * Subscribes ONLY to rollHistory from store
 */
function HistoryDisplay() {
  const rollHistory = useDiceStore((state) => state.rollHistory)

  console.log('📜 HistoryDisplay render - history length:', rollHistory.length)

  if (rollHistory.length === 0) return null

  return (
    <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg text-sm">
      <div className="text-gray-400 mb-1">History:</div>
      <div className="flex gap-2">
        {rollHistory.slice(-5).map((value, idx) => (
          <span key={idx} className="text-orange-400">{value}</span>
        ))}
      </div>
    </div>
  )
}

export default Scene
