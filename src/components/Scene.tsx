import { useRef, useCallback, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { Box } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { GRAVITY } from '../config/physicsConfig'
import { PerformanceOverlay } from '../hooks/usePerformanceMonitor'
import { Dice, DiceHandle } from './dice/Dice'
import { RollButton } from './RollButton'
import { DebugOverlay } from './DebugOverlay'
import { SettingsButton } from './SettingsButton'
import { HamburgerMenu } from './HamburgerMenu'
import { useDiceRoll } from '../hooks/useDiceRoll'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useUIStore } from '../store/useUIStore'
import { useDeviceMotionRef } from '../contexts/DeviceMotionContext'

/**
 * Component to dynamically update physics gravity based on device motion
 * Uses R3F's useFrame hook - runs every frame (~60fps) synchronized with Three.js rendering
 * Reads from gravityRef without triggering any React re-renders
 */
function PhysicsController({ gravityRef }: { gravityRef: React.MutableRefObject<THREE.Vector3> }) {
  const { world } = useRapier()
  const motionMode = useUIStore((state) => state.motionMode)

  // useFrame runs every frame, synchronized with Three.js render loop
  // This is the correct way to update physics in R3F - no useEffect, no requestAnimationFrame
  useFrame(() => {
    if (world) {
      if (motionMode) {
        // Use device motion gravity when motion mode is enabled
        const gravity = gravityRef.current
        world.gravity = { x: gravity.x, y: gravity.y, z: gravity.z }
      } else {
        // Use standard downward gravity when motion mode is disabled
        world.gravity = { x: 0, y: GRAVITY, z: 0 }
      }
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
  const distance = camera.position.y || 15 // Camera height (dynamically read, fallback to 15)

  // Calculate viewport dimensions at ground plane
  const vFOV = THREE.MathUtils.degToRad(fov)
  const height = 2 * Math.tan(vFOV / 2) * distance
  const width = height * aspect

  // Tighter bounds - reduce margin to create a more confined dice tray
  const margin = -0.05 // Negative margin to make space tighter than viewport
  const bounds = {
    left: -(width / 2) * (1 + margin),
    right: (width / 2) * (1 + margin),
    top: (height / 2) * (1 + margin),
    bottom: -(height / 2) * (1 + margin),
    width: width * (1 + margin),
    height: height * (1 + margin)
  }

  const wallThickness = 0.3
  const wallHeight = 6 // Match ceiling height to prevent dice escape
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
        <Box args={[bounds.width + wallThickness * 2, wallHeight, wallThickness]} receiveShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.8} metalness={0.2} />
        </Box>
      </RigidBody>

      {/* Bottom wall (negative Z) */}
      <RigidBody type="fixed" position={[0, wallY, bounds.bottom]}>
        <Box args={[bounds.width + wallThickness * 2, wallHeight, wallThickness]} receiveShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.8} metalness={0.2} />
        </Box>
      </RigidBody>

      {/* Right wall (positive X) */}
      <RigidBody type="fixed" position={[bounds.right, wallY, 0]}>
        <Box args={[wallThickness, wallHeight, bounds.height]} receiveShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.8} metalness={0.2} />
        </Box>
      </RigidBody>

      {/* Left wall (negative X) */}
      <RigidBody type="fixed" position={[bounds.left, wallY, 0]}>
        <Box args={[wallThickness, wallHeight, bounds.height]} receiveShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.8} metalness={0.2} />
        </Box>
      </RigidBody>

      {/* Ceiling - prevents dice from flying away when phone upside down */}
      <RigidBody type="fixed" position={[0, 6, 0]}>
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
  const diceRef = useRef<DiceHandle>(null)
  // Only subscribe to RefContext - STABLE, never causes re-renders
  const { gravityRef } = useDeviceMotionRef()
  const { canRoll, roll, onDiceRest } = useDiceRoll()

  // Subscribe to dice manager store
  const dice = useDiceManagerStore((state) => state.dice)
  const addDice = useDiceManagerStore((state) => state.addDice)
  const removeDice = useDiceManagerStore((state) => state.removeDice)

  const handleRollClick = useCallback(() => {
    const impulse = roll(dice.length)
    if (impulse && diceRef.current) {
      diceRef.current.applyImpulse(impulse)
    }
  }, [roll, dice.length])

  const handleDiceRest = useCallback((diceId: string, faceValue: number, diceType: string) => {
    onDiceRest(diceId, faceValue, diceType)
  }, [onDiceRest])

  const handleAddDice = useCallback((type: string) => {
    console.log('Adding dice:', type)
    addDice(type)
  }, [addDice])

  const handleRemoveDice = useCallback((id: string) => {
    removeDice(id)

    // Check if we're in the middle of a roll
    const store = useDiceStore.getState()
    if (store.expectedDiceCount > 0) {
      // Reset roll state since dice count changed
      console.log('Scene: Dice removed during roll, resetting roll state')
      useDiceStore.getState().reset()
    }
  }, [removeDice])

  return (
    <>
      {/* Hamburger Menu */}
      <HamburgerMenu
        onAddDice={handleAddDice}
        onRemoveDice={handleRemoveDice}
        dice={dice}
      />

      <Canvas
        shadows
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]} // Device pixel ratio (1x for low-end, 2x for high-end)
        camera={{
          position: [0, 15, 0],
          fov: 40
        }}
        // Enable pointer events for touch and mouse
        // This ensures pointer events reach the mesh components
        style={{ touchAction: 'none' }}
      >
      {/* Camera already configured via Canvas props */}

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
      <Physics gravity={[0, GRAVITY, 0]} timeStep="vary">
        <PhysicsController gravityRef={gravityRef} />

        {/* Viewport-aligned boundaries (ground, walls, ceiling) */}
        <ViewportBoundaries />

        {/* Render all dice from store */}
        {dice.map((die, index) => (
          <Dice
            key={die.id}
            id={die.id}
            shape={die.type}
            ref={index === 0 ? diceRef : undefined}
            position={die.position}
            rotation={die.rotation}
            size={0.67}
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

  // Show currentRoll only if we have actual dice in it, otherwise show lastResult
  const displayDice = currentRoll.length > 0 ? currentRoll : lastResult?.dice || []
  const displaySum = displayDice.reduce((acc, d) => acc + d.value, 0)

  // Calculate how many dice are still pending
  const pendingCount = isRolling ? expectedDiceCount - currentRoll.length : 0

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 md:top-20 md:left-auto md:right-4 md:translate-x-0 bg-black bg-opacity-75 text-white px-6 py-4 rounded-lg text-center z-20 shadow-xl min-w-[200px]">
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
 * History display component with flyout panel
 * Shows compact icon with most recent sum in top-right
 * Expands to show full roll history breakdown when clicked
 */
function HistoryDisplay() {
  const rollHistory = useDiceStore((state) => state.rollHistory)
  const [isOpen, setIsOpen] = useState(false)

  // Only show history when we have at least 2 rolls (current + at least 1 historical)
  if (rollHistory.length < 2) return null

  // Show the second-most recent roll (first historical entry, not current)
  const displayRoll = rollHistory[rollHistory.length - 2]

  return (
    <>
      {/* Compact history button - top right */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-30 bg-black bg-opacity-75 hover:bg-opacity-90 text-white px-3 py-2 rounded-lg shadow-lg transition-all flex items-center gap-2"
        title="View roll history"
      >
        <span className="text-lg">📜</span>
        <span className="font-bold text-orange-400">{displayRoll.sum}</span>
      </button>

      {/* Flyout panel - slides in from right */}
      {isOpen && (
        <>
          {/* Backdrop - click to close */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Flyout content */}
          <div className="fixed top-0 right-0 h-full w-80 bg-gray-900 shadow-2xl z-50 overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Roll History</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            {/* History list - newest first */}
            <div className="px-6 py-4 space-y-3">
              {[...rollHistory].reverse().map((roll, idx) => (
                <div
                  key={idx}
                  className="bg-gray-800 rounded-lg p-4 border border-gray-700"
                >
                  {/* Roll number */}
                  <div className="text-xs text-gray-500 mb-2">
                    Roll #{rollHistory.length - idx}
                  </div>

                  {/* Dice values */}
                  <div className="flex gap-2 flex-wrap mb-2">
                    {roll.dice.map((die, dieIdx) => (
                      <div
                        key={dieIdx}
                        className="flex flex-col items-center"
                      >
                        <span className="bg-gray-700 text-white px-3 py-1 rounded font-bold">
                          {die.value}
                        </span>
                        <span className="text-xs text-gray-500 mt-1">
                          {die.type.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Sum */}
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <div className="text-xs text-gray-400">Sum</div>
                    <div className="text-2xl font-bold text-orange-400">
                      {roll.sum}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default Scene
