import { useRef, useCallback } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { Box } from '@react-three/drei'
import { useEffect } from 'react'
import { Physics, RigidBody } from '@react-three/rapier'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { PerformanceOverlay } from '../hooks/usePerformanceMonitor'
import { D6, D6Handle } from './dice/D6'
import { RollButton } from './RollButton'
import { DeviceMotionButton } from './DeviceMotionButton'
import { DebugOverlay } from './DebugOverlay'
import { SettingsButton } from './SettingsButton'
import { HamburgerMenu } from './HamburgerMenu'
import { useDiceRoll } from '../hooks/useDiceRoll'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useDeviceMotionRef } from '../contexts/DeviceMotionContext'

/**
 * Component to dynamically update physics gravity based on device motion
 * Uses R3F's useFrame hook - runs every frame (~60fps) synchronized with Three.js rendering
 * Reads from gravityRef without triggering any React re-renders
 */
function PhysicsController({ gravityRef }: { gravityRef: React.MutableRefObject<THREE.Vector3> }) {
  const { world } = useRapier()

  // useFrame runs every frame, synchronized with Three.js render loop
  // This is the correct way to update physics in R3F - no useEffect, no requestAnimationFrame
  useFrame(() => {
    if (world) {
      const gravity = gravityRef.current
      world.gravity = { x: gravity.x, y: gravity.y, z: gravity.z }
    }
  })

  return null
}

/**
 * Viewport-aligned boundaries component
 * Calculates frustum dimensions and renders ground, walls, and ceiling
 * Updates automatically on window resize via useThree's size reactivity
 *
 * Lives INSIDE Canvas context - keeps Scene component pure (no re-renders)
 */
function ViewportBoundaries() {
  const { camera, size } = useThree()

  // Ensure camera FOV is set (default to 40 if not yet configured)
  const perspectiveCamera = camera as THREE.PerspectiveCamera
  if (!perspectiveCamera.fov || perspectiveCamera.fov === 50) {
    // Default Three.js PerspectiveCamera FOV is 50, our setup sets it to 40
    perspectiveCamera.fov = 40
    perspectiveCamera.updateProjectionMatrix()
  }

  // Calculate viewport bounds based on camera frustum at ground level (y=0)
  const aspect = size.width / size.height
  const fov = perspectiveCamera.fov
  const distance = camera.position.y || 14 // Camera height (dynamically read, fallback to 14)

  // Calculate viewport dimensions at ground plane
  const vFOV = THREE.MathUtils.degToRad(fov)
  const height = 2 * Math.tan(vFOV / 2) * distance
  const width = height * aspect

  // Add 10% margin to ensure walls are slightly outside viewport
  const margin = 0.1
  const bounds = {
    left: -(width / 2) * (1 + margin),
    right: (width / 2) * (1 + margin),
    top: (height / 2) * (1 + margin),
    bottom: -(height / 2) * (1 + margin),
    width: width * (1 + margin),
    height: height * (1 + margin)
  }

  const wallThickness = 0.5
  const wallHeight = 8 // Height from ground to ceiling
  const wallY = wallHeight / 2 // Center Y position for walls

  return (
    <>
      {/* Ground Plane - sized to viewport */}
      <RigidBody type="fixed" position={[0, -0.5, 0]}>
        <Box args={[bounds.width, 1, bounds.height]} receiveShadow>
          <meshStandardMaterial color="#444444" />
        </Box>
      </RigidBody>

      {/* Top wall (positive Z) */}
      <RigidBody type="fixed" position={[0, wallY, bounds.top]}>
        <Box args={[bounds.width + wallThickness * 2, wallHeight, wallThickness]}>
          <meshStandardMaterial transparent opacity={0} />
        </Box>
      </RigidBody>

      {/* Bottom wall (negative Z) */}
      <RigidBody type="fixed" position={[0, wallY, bounds.bottom]}>
        <Box args={[bounds.width + wallThickness * 2, wallHeight, wallThickness]}>
          <meshStandardMaterial transparent opacity={0} />
        </Box>
      </RigidBody>

      {/* Right wall (positive X) */}
      <RigidBody type="fixed" position={[bounds.right, wallY, 0]}>
        <Box args={[wallThickness, wallHeight, bounds.height]}>
          <meshStandardMaterial transparent opacity={0} />
        </Box>
      </RigidBody>

      {/* Left wall (negative X) */}
      <RigidBody type="fixed" position={[bounds.left, wallY, 0]}>
        <Box args={[wallThickness, wallHeight, bounds.height]}>
          <meshStandardMaterial transparent opacity={0} />
        </Box>
      </RigidBody>

      {/* Ceiling - prevents dice from flying away when phone upside down */}
      <RigidBody type="fixed" position={[0, wallHeight, 0]}>
        <Box args={[bounds.width, wallThickness, bounds.height]}>
          <meshStandardMaterial transparent opacity={0} />
        </Box>
      </RigidBody>
    </>
  )
}

/**
 * Main 3D scene component
 * Sets up React Three Fiber Canvas with Rapier physics
 *
 * CRITICAL ARCHITECTURE:
 * - Physics world (Canvas) must NEVER re-render due to UI state changes
 * - UI state (lastResult, rollHistory) is in Zustand store
 * - Only UI components subscribe to store, not the Scene component
 * - Device motion updates physics gravity in real-time for tilt-based interaction
 */
function Scene() {
  const diceRef = useRef<D6Handle>(null)
  // Only subscribe to RefContext - STABLE, never causes re-renders
  const { gravityRef } = useDeviceMotionRef()
  const { canRoll, roll, onDiceRest } = useDiceRoll()

  // Subscribe to dice manager store
  const dice = useDiceManagerStore((state) => state.dice)
  const addDice = useDiceManagerStore((state) => state.addDice)
  const removeDice = useDiceManagerStore((state) => state.removeDice)
  const removeAllDice = useDiceManagerStore((state) => state.removeAllDice)

  // Component to set up top-down camera
  function CameraSetup() {
    const { camera } = useThree()

    useEffect(() => {
      // Reduce FOV to 40 degrees (from default 75) for less distortion
      // Camera at 14 units up for appropriate dice size
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = 40
      }
      camera.position.set(0, 14, 0)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }, [camera])

    return null
  }

  const handleRollClick = useCallback(() => {
    const impulse = roll(dice.length)
    if (impulse && diceRef.current) {
      diceRef.current.applyImpulse(impulse)
    }
  }, [roll, dice.length])

  const handleDiceRest = useCallback((diceId: string, faceValue: number) => {
    onDiceRest(diceId, faceValue)
  }, [onDiceRest])

  const handleAddDice = useCallback((type: string) => {
    if (type === 'd6') {
      addDice('d6')
    }
    // Other dice types not yet implemented
  }, [addDice])

  const handleRemoveDice = useCallback((id: string) => {
    if (id === 'all') {
      removeAllDice()
    } else {
      removeDice(id)
    }
  }, [removeDice, removeAllDice])

  return (
    <>
      {/* Hamburger Menu */}
      <HamburgerMenu
        onAddDice={handleAddDice}
        onRemoveDice={handleRemoveDice}
        diceCount={dice.length}
      />

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

      {/* Physics world - gravity updated via PhysicsController, not props */}
      <Physics gravity={[0, -9.81, 0]}>
        <PhysicsController gravityRef={gravityRef} />

        {/* Viewport-aligned boundaries (ground, walls, ceiling) */}
        <ViewportBoundaries />

        {/* Render all dice from store */}
        {dice.map((die, index) => (
          <D6
            key={die.id}
            id={die.id}
            ref={index === 0 ? diceRef : undefined}
            position={die.position}
            rotation={die.rotation}
            size={1}
            color={die.color}
            onRest={handleDiceRest}
          />
        ))}
      </Physics>

      {/* Performance monitoring */}
      <PerformanceOverlay />
    </Canvas>

    {/* Result Display - subscribes to store */}
    <ResultDisplay />

    {/* Roll Button */}
    <RollButton onClick={handleRollClick} disabled={!canRoll} />

    {/* Device Motion Permission Button - subscribes to device motion directly */}
    <DeviceMotionButton />

    {/* Debug Overlay - subscribes to device motion directly */}
    <DebugOverlay />

    {/* Settings Button */}
    <SettingsButton />

    {/* Roll History */}
    <HistoryDisplay />
  </>
  )
}

/**
 * Result display component
 * Shows current roll with dynamic updates as dice settle
 */
function ResultDisplay() {
  const currentRoll = useDiceStore((state) => state.currentRoll)
  const expectedDiceCount = useDiceStore((state) => state.expectedDiceCount)
  const lastResult = useDiceStore((state) => state.lastResult)

  // Show current roll if in progress, otherwise show last completed roll
  const isRolling = currentRoll.length > 0 && currentRoll.length < expectedDiceCount
  const hasRoll = currentRoll.length > 0 || lastResult !== null

  if (!hasRoll) return null

  const displayDice = isRolling || currentRoll.length === expectedDiceCount ? currentRoll : lastResult?.dice || []
  const displaySum = displayDice.reduce((acc, d) => acc + d.value, 0)

  // Calculate how many dice are still pending
  const pendingCount = isRolling ? expectedDiceCount - currentRoll.length : 0

  return (
    <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-6 py-4 rounded-lg text-center z-20 shadow-xl min-w-[200px]">
      <div className="text-sm text-gray-300 mb-2">
        {isRolling ? 'Rolling...' : 'You rolled:'}
      </div>

      {/* Individual dice values */}
      <div className="flex gap-2 justify-center mb-3 flex-wrap">
        {displayDice.map((die, idx) => (
          <span key={idx} className="text-2xl font-bold bg-gray-700 px-3 py-1 rounded">
            {die.value}
          </span>
        ))}
        {/* Show ? for pending dice */}
        {Array.from({ length: pendingCount }).map((_, idx) => (
          <span key={`pending-${idx}`} className="text-2xl font-bold bg-gray-600 px-3 py-1 rounded animate-pulse">
            ?
          </span>
        ))}
      </div>

      {/* Sum */}
      {displayDice.length > 1 && (
        <div className="border-t border-gray-600 pt-2">
          <div className="text-xs text-gray-400">Sum</div>
          <div className="text-3xl font-bold text-orange-400">
            {isRolling ? `${displaySum} + ?` : displaySum}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * History display component
 * Subscribes ONLY to rollHistory from store
 */
function HistoryDisplay() {
  const rollHistory = useDiceStore((state) => state.rollHistory)

  if (rollHistory.length === 0) return null

  return (
    <div className="absolute top-4 left-72 bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg text-sm">
      <div className="text-gray-400 mb-1">History:</div>
      <div className="flex gap-2 flex-wrap max-w-xs">
        {rollHistory.slice(-5).map((roll, idx) => (
          <div key={idx} className="flex flex-col items-center">
            {roll.dice.length > 1 ? (
              <>
                <div className="text-xs text-gray-500">
                  {roll.dice.map(d => d.value).join('+')}
                </div>
                <span className="text-orange-400 font-bold">{roll.sum}</span>
              </>
            ) : (
              <span className="text-orange-400 font-bold">{roll.sum}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Scene
