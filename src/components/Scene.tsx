import { Box } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Physics, RigidBody, useRapier } from '@react-three/rapier'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GRAVITY } from '../config/physicsConfig'
import { useDeviceMotionRef, useDeviceMotionState } from '../contexts/DeviceMotionContext'
import { useTheme } from '../contexts/ThemeContext'
import { useDiceRoll } from '../hooks/useDiceRoll'
import { PerformanceOverlay } from '../hooks/usePerformanceMonitor'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useDiceStore } from '../store/useDiceStore'
import { useDragStore } from '../store/useDragStore'
import { useUIStore } from '../store/useUIStore'
import { Dice, DiceHandle } from './dice/Dice'
import { BottomNav, CenterRollButton, CornerIcon, DiceToolbar, UIToggleMini } from './layout'
import { HistoryPanel, SettingsPanel, SavedRollsPanel } from './panels'

/**
 * Component to dynamically update physics gravity based on device motion
 * Uses R3F's useFrame hook - runs every frame (~60fps) synchronized with Three.js rendering
 * Reads from gravityRef without triggering any React re-renders
 */
function PhysicsController({ gravityRef }: { gravityRef: React.MutableRefObject<THREE.Vector3> }) {
  const { world } = useRapier()
  const motionMode = useUIStore((state) => state.motionMode)

  // Log when motion mode changes
  useEffect(() => {
    console.log('PhysicsController: Motion mode changed to:', motionMode)
  }, [motionMode])

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
 * Themed background component
 * Sets the Three.js scene background color from theme
 */
function ThemedBackground() {
  const { scene } = useThree()
  const { currentTheme } = useTheme()
  const bgColor = currentTheme.environment.background.color

  useEffect(() => {
    console.log(`[ThemedBackground] Setting scene background to: ${bgColor} for theme: ${currentTheme.id}`)
    const color = new THREE.Color(bgColor)
    scene.background = color
    console.log(`[ThemedBackground] Scene background object:`, scene.background, 'R:', scene.background.r, 'G:', scene.background.g, 'B:', scene.background.b)
  }, [scene, bgColor, currentTheme.id])

  return null
}

/**
 * Themed lighting component
 * Uses theme's lighting configuration for ambient and directional lights
 */
function ThemedLighting() {
  const { currentTheme } = useTheme()
  const lighting = currentTheme.environment.lighting
  const { size } = useThree()

  // Calculate wall positions for torch placement (for dungeon theme)
  const isDungeonTheme = currentTheme.id === 'dungeon-castle'

  // Calculate viewport bounds for torch positioning
  const aspect = size.width / size.height
  const distance = 15 // camera height
  const vFOV = THREE.MathUtils.degToRad(40)
  const height = 2 * Math.tan(vFOV / 2) * distance
  const width = height * aspect
  const margin = -0.05

  const wallPositions = {
    left: -(width / 2) * (1 + margin),
    right: (width / 2) * (1 + margin),
    top: (height / 2) * (1 + margin),
    bottom: -(height / 2) * (1 + margin),
  }

  return (
    <>
      <ambientLight
        color={lighting.ambient.color}
        intensity={lighting.ambient.intensity}
      />
      <directionalLight
        position={lighting.directional.position}
        color={lighting.directional.color}
        intensity={lighting.directional.intensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />

      {/* Torch lights on walls for dungeon theme */}
      {isDungeonTheme && (
        <>
          {/* North wall torch */}
          <pointLight
            position={[0, 3, wallPositions.top - 1.5]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}
            castShadow
          />
          {/* South wall torch */}
          <pointLight
            position={[0, 3, wallPositions.bottom + 1.5]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}
            castShadow
          />
          {/* East wall torch */}
          <pointLight
            position={[wallPositions.right - 1.5, 3, 0]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}
            castShadow
          />
          {/* West wall torch */}
          <pointLight
            position={[wallPositions.left + 1.5, 3, 0]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}
            castShadow
          />
        </>
      )}
    </>
  )
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
  const { currentTheme } = useTheme()
  const env = currentTheme.environment

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
  const wallHeight = env.walls.height || 6 // Use theme's wall height or default to 6
  const wallY = wallHeight / 2 // Center Y position for walls

  return (
    <>
      {/* Ground Plane - sized to viewport */}
      <RigidBody type="fixed" position={[0, -0.5, 0]}>
        <Box
          args={[bounds.width, 1, bounds.height]}
          receiveShadow={env.floor.receiveShadow !== false}
        >
          <meshStandardMaterial
            color={env.floor.color}
            roughness={env.floor.material.roughness}
            metalness={env.floor.material.metalness}
          />
        </Box>
      </RigidBody>

      {/* Walls - only render if visible */}
      {env.walls.visible && (
        <>
          {/* Top wall (positive Z) */}
          <RigidBody type="fixed" position={[0, wallY, bounds.top]}>
            <Box args={[bounds.width + wallThickness * 2, wallHeight, wallThickness]} receiveShadow>
              <meshStandardMaterial
                color={env.walls.color}
                roughness={env.walls.material.roughness}
                metalness={env.walls.material.metalness}
              />
            </Box>
          </RigidBody>

          {/* Bottom wall (negative Z) */}
          <RigidBody type="fixed" position={[0, wallY, bounds.bottom]}>
            <Box args={[bounds.width + wallThickness * 2, wallHeight, wallThickness]} receiveShadow>
              <meshStandardMaterial
                color={env.walls.color}
                roughness={env.walls.material.roughness}
                metalness={env.walls.material.metalness}
              />
            </Box>
          </RigidBody>

          {/* Right wall (positive X) */}
          <RigidBody type="fixed" position={[bounds.right, wallY, 0]}>
            <Box args={[wallThickness, wallHeight, bounds.height]} receiveShadow>
              <meshStandardMaterial
                color={env.walls.color}
                roughness={env.walls.material.roughness}
                metalness={env.walls.material.metalness}
              />
            </Box>
          </RigidBody>

          {/* Left wall (negative X) */}
          <RigidBody type="fixed" position={[bounds.left, wallY, 0]}>
            <Box args={[wallThickness, wallHeight, bounds.height]} receiveShadow>
              <meshStandardMaterial
                color={env.walls.color}
                roughness={env.walls.material.roughness}
                metalness={env.walls.material.metalness}
              />
            </Box>
          </RigidBody>
        </>
      )}

      {/* Ceiling - prevents dice from flying away when phone upside down */}
      {env.ceiling.visible && (
        <RigidBody type="fixed" position={[0, 6, 0]}>
          <Box args={[bounds.width, wallThickness, bounds.height]}>
            <meshStandardMaterial
              color={env.ceiling.color || '#1a1a1a'}
              transparent
              opacity={env.ceiling.color ? 1 : 0}
            />
          </Box>
        </RigidBody>
      )}
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
  // Create refs for ALL dice (not just the first one)
  const diceRefs = useRef<Map<string, DiceHandle>>(new Map())

  // Only subscribe to RefContext - STABLE, never causes re-renders
  const { gravityRef } = useDeviceMotionRef()
  // Get requestPermission from state context
  const { requestPermission } = useDeviceMotionState()
  const { roll, onDiceRest } = useDiceRoll()

  // Subscribe to dice manager store
  const dice = useDiceManagerStore((state) => state.dice)
  const addDice = useDiceManagerStore((state) => state.addDice)
  const removeDice = useDiceManagerStore((state) => state.removeDice)

  // Subscribe to drag store
  const setOnDiceDelete = useDragStore((state) => state.setOnDiceDelete)

  // UI state
  const { isUIVisible, toggleUIVisibility, motionMode, toggleMotionMode } = useUIStore()
  const [isDiceManagerOpen, setIsDiceManagerOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSavedRollsOpen, setIsSavedRollsOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Detect if mobile
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const handleRollClick = useCallback(() => {
    // Allow spam clicking - no canRoll check
    const impulse = roll(dice.length)
    if (impulse) {
      // Apply impulse to ALL dice in their current positions
      // This allows spam clicking to shake up dice
      diceRefs.current.forEach((diceHandle) => {
        diceHandle.applyImpulse(impulse)
      })
    }
  }, [roll, dice.length])

  const handleDiceRest = useCallback(
    (id: string, faceValue: number, diceType: string) => {
      onDiceRest(id, faceValue, diceType)
    },
    [onDiceRest]
  )

  const handleAddDice = useCallback(
    (type: string) => {
      addDice(type as any)
    },
    [addDice]
  )

  const handleToggleMotion = useCallback(async () => {
    if (!motionMode) {
      // Enabling motion mode - request permission first
      console.log('Requesting device motion permission...')
      await requestPermission()
    }
    // Toggle the mode
    toggleMotionMode()
  }, [motionMode, requestPermission, toggleMotionMode])

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

  // Set up the onDiceDelete callback for drag-to-delete
  useEffect(() => {
    setOnDiceDelete(handleRemoveDice)
  }, [handleRemoveDice, setOnDiceDelete])

  return (
    <>
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

      {/* Themed background */}
      <ThemedBackground />

      {/* Themed lighting from theme config */}
      <ThemedLighting />

      {/* Physics world - gravity updated via PhysicsController, not props */}
      <Physics gravity={[0, GRAVITY, 0]} timeStep="vary">
        <PhysicsController gravityRef={gravityRef} />

        {/* Viewport-aligned boundaries (ground, walls, ceiling) */}
        <ViewportBoundaries />

        {/* Render all dice from store */}
        {dice.map((die) => (
          <Dice
            key={die.id}
            id={die.id}
            shape={die.type}
            ref={(el) => {
              if (el) {
                diceRefs.current.set(die.id, el)
              } else {
                diceRefs.current.delete(die.id)
              }
            }}
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

    {/* NEW LAYOUT SYSTEM */}
    {/* Bottom Navigation Bar */}
    <BottomNav
      isVisible={isUIVisible}
      onToggleUI={toggleUIVisibility}
      onOpenDiceManager={() => setIsDiceManagerOpen(true)}
      onOpenHistory={() => setIsHistoryOpen(true)}
      onToggleMotion={handleToggleMotion} // Request permission when enabling
      isMobile={isMobile}
      motionModeActive={motionMode}
    />

    {/* Center Roll Button - elevated above nav */}
    <CenterRollButton onClick={handleRollClick} isRolling={false} />

    {/* Top-Left Corner: Settings */}
    <CornerIcon
      position="top-left"
      onClick={() => setIsSettingsOpen(true)}
      label="Settings"
      isVisible={isUIVisible}
    >
      ⚙️
    </CornerIcon>

    {/* Top-Right Corner: My Dice Rolls */}
    <CornerIcon
      position="top-right"
      onClick={() => setIsSavedRollsOpen(true)}
      label="My Dice Rolls"
      isVisible={isUIVisible}
    >
      📋
    </CornerIcon>

    {/* Mini UI Toggle - shows when UI hidden */}
    <UIToggleMini onClick={toggleUIVisibility} isVisible={isUIVisible} />

    {/* DICE TOOLBAR - Compact slide-out dice management */}
    <DiceToolbar
      isOpen={isDiceManagerOpen}
      onAddDice={handleAddDice}
      onClearAll={() => {
        // Clear all dice
        dice.forEach(die => removeDice(die.id))
        setIsDiceManagerOpen(false)
      }}
    />

    {/* THEMED PANELS */}
    <HistoryPanel
      isOpen={isHistoryOpen}
      onClose={() => setIsHistoryOpen(false)}
    />

    <SavedRollsPanel
      isOpen={isSavedRollsOpen}
      onClose={() => setIsSavedRollsOpen(false)}
    />

    <SettingsPanel
      isOpen={isSettingsOpen}
      onClose={() => setIsSettingsOpen(false)}
    />
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
  const dice = useDiceManagerStore((state) => state.dice)

  // Don't show anything if there are no dice
  if (dice.length === 0) return null

  // Show last result if available
  if (lastResult && lastResult.dice.length > 0) {
    return (
      <div
        className="fixed top-24 left-1/2 transform -translate-x-1/2 z-10 pointer-events-none"
        style={{
          textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div className="text-center">
          <div
            className="text-7xl font-bold mb-2 animate-bounce"
            style={{
              color: 'var(--color-accent)',
              textShadow: '0 0 20px var(--color-accent-glow)'
            }}
          >
            {lastResult.sum}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {lastResult.dice.map((die, idx) => (
              <span
                key={`${die.id}-${idx}`}
                className="text-lg"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {die.type.toUpperCase()}: {die.value}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Show rolling state if dice are in motion
  if (currentRoll.length > 0 && currentRoll.length < expectedDiceCount) {
    return (
      <div
        className="fixed top-24 left-1/2 transform -translate-x-1/2 z-10 pointer-events-none"
        style={{
          textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div
          className="text-3xl"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Rolling... ({currentRoll.length}/{expectedDiceCount})
        </div>
      </div>
    )
  }

  return null
}

export default Scene
