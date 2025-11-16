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
  const removeAllDice = useDiceManagerStore((state) => state.removeAllDice)

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
      console.log(`Rolling ${dice.length} dice, refs map has ${diceRefs.current.size} entries`)
      console.log('Dice IDs:', dice.map(d => d.id))
      console.log('Ref keys:', Array.from(diceRefs.current.keys()))

      // Check if dice count changed from saved roll - if so, clear bonuses
      const activeSavedRoll = useDiceStore.getState().activeSavedRoll
      if (activeSavedRoll && dice.length !== activeSavedRoll.expectedDiceCount) {
        console.log(`Dice count changed (${dice.length} vs ${activeSavedRoll.expectedDiceCount}), clearing saved roll bonuses`)
        useDiceStore.getState().clearActiveSavedRoll()
      }

      // Apply impulse to ALL dice in their current positions
      // This allows spam clicking to shake up dice
      diceRefs.current.forEach((diceHandle, id) => {
        console.log(`Applying impulse to dice ${id}`)
        diceHandle.applyRollImpulse(impulse)
      })
    }
  }, [roll, dice.length])

  const handleDiceRest = useCallback(
    (id: string, faceValue: number, diceType: string) => {
      onDiceRest(id, faceValue, diceType)
    },
    [onDiceRest]
  )

  // Get current theme
  const { currentTheme } = useTheme()

  const handleAddDice = useCallback(
    (type: string) => {
      console.log('Adding dice:', type)
      // Clear active saved roll when manually adding dice
      useDiceStore.getState().clearActiveSavedRoll()
      addDice(type as import('../lib/geometries').DiceShape, currentTheme.id)
    },
    [addDice, currentTheme.id]
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
    // Clear active saved roll when manually removing dice
    useDiceStore.getState().clearActiveSavedRoll()
    removeDice(id)

    // Check if we're in the middle of a roll
    const store = useDiceStore.getState()
    if (store.expectedDiceCount > 0) {
      // Reset roll state since dice count changed
      console.log('Scene: Dice removed during roll, resetting roll state')
      useDiceStore.getState().reset()
    }
  }, [removeDice])

  const handleClearAll = useCallback(() => {
    // Clear active saved roll when manually clearing all dice
    useDiceStore.getState().clearActiveSavedRoll()
    removeAllDice()
  }, [removeAllDice])

  // Register delete callback with drag store
  useEffect(() => {
    setOnDiceDelete(handleRemoveDice)
    return () => setOnDiceDelete(undefined)
  }, [setOnDiceDelete, handleRemoveDice])

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
        style={{
          touchAction: 'none',
          width: '100%',
          height: '100%',
          display: 'block',
          position: 'absolute',
          top: 0,
          left: 0
        }}
      >
        {/* Camera already configured via Canvas props */}

        {/* Themed Background */}
        <ThemedBackground />

        {/* Themed Lighting */}
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
      onOpenDiceManager={() => setIsDiceManagerOpen(!isDiceManagerOpen)}
      onOpenHistory={() => setIsHistoryOpen(true)}
      onToggleMotion={handleToggleMotion} // Request permission when enabling
      isMobile={isMobile}
      motionModeActive={motionMode}
      diceManagerOpen={isDiceManagerOpen}
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
      onClearAll={handleClearAll}
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
  const activeSavedRoll = useDiceStore((state) => state.activeSavedRoll)
  const dice = useDiceManagerStore((state) => state.dice)

  // Track previous sum to trigger animation only on change
  // IMPORTANT: Must be declared before any conditional returns (Rules of Hooks)
  const prevSumRef = useRef<number | null>(null)
  const [shouldAnimate, setShouldAnimate] = useState(false)

  // Show current roll if in progress, otherwise show last completed roll
  const isRolling = currentRoll.length > 0 && currentRoll.length < expectedDiceCount
  const hasRoll = currentRoll.length > 0 || lastResult !== null

  // Show currentRoll only if we have actual dice in it, otherwise show lastResult
  const displayDice = currentRoll.length > 0 ? currentRoll : lastResult?.dice || []
  
  // Calculate dice sum (raw values)
  const diceSum = displayDice.reduce((acc, d) => acc + d.value, 0)
  
  // Calculate per-die bonuses total
  const perDieBonusesTotal = activeSavedRoll 
    ? displayDice.reduce((acc, d) => {
        const bonus = activeSavedRoll.perDieBonuses.get(d.id) || 0
        return acc + bonus
      }, 0)
    : 0
  
  // Calculate grand total (dice + per-die bonuses + flat bonus)
  const flatBonus = activeSavedRoll?.flatBonus || 0
  const grandTotal = diceSum + perDieBonusesTotal + flatBonus

  // Calculate pending dice - find which dice haven't reported yet
  const pendingDice = isRolling
    ? dice.filter(die => !currentRoll.some(r => r.id === die.id))
    : []

  // Trigger bounce animation only when sum changes
  // IMPORTANT: This hook must always be called, even if we don't render anything
  useEffect(() => {
    if (hasRoll && prevSumRef.current !== null && prevSumRef.current !== grandTotal) {
      setShouldAnimate(true)
      // Reset animation after it completes
      const timer = setTimeout(() => setShouldAnimate(false), 500)
      return () => clearTimeout(timer)
    }
    prevSumRef.current = grandTotal
  }, [grandTotal, hasRoll])

  // Early return AFTER all hooks have been called
  if (!hasRoll) return null

  return (
    <div className="absolute top-8 left-1/2 -translate-x-1/2 text-white text-center z-20 flex flex-col items-center gap-4 pointer-events-none">
      {/* Grand Total at Top - Large with bounce animation */}
      <div className={`flex flex-col items-center gap-1 transition-transform ${shouldAnimate ? 'animate-bounce' : ''}`}>
        <div 
          className="text-7xl font-bold"
          style={{ 
            color: 'var(--color-accent)',
            textShadow: '0 0 20px rgba(251, 146, 60, 0.5), 0 4px 8px rgba(0, 0, 0, 0.8)'
          }}
        >
          {isRolling ? '?' : grandTotal}
        </div>
        
        {/* Breakdown label if there's a flat bonus */}
        {!isRolling && flatBonus !== 0 && (
          <div className="text-sm text-gray-300 bg-black bg-opacity-75 px-3 py-1 rounded">
            {diceSum + perDieBonusesTotal} + {flatBonus}
          </div>
        )}
      </div>

      {/* Individual dice values */}
      <div className="flex gap-3 justify-center flex-wrap max-w-lg">
        {displayDice.map((die, idx) => {
          const perDieBonus = activeSavedRoll?.perDieBonuses.get(die.id) || 0
          return (
            <div key={idx} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-gray-400 uppercase font-semibold">{die.type}</span>
              <div 
                className="px-4 py-2 rounded min-w-[48px] flex items-center justify-center"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  border: '1px solid rgba(251, 146, 60, 0.3)'
                }}
              >
                <span className="text-2xl font-bold">{die.value}</span>
              </div>
              {/* Per-die bonus label */}
              {perDieBonus !== 0 && (
                <div className="text-xs text-orange-300">
                  +{perDieBonus}
                </div>
              )}
            </div>
          )
        })}
        
        {/* Show pending dice */}
        {pendingDice.map((die) => (
          <div key={`pending-${die.id}`} className="flex flex-col items-center gap-1 animate-pulse">
            <span className="text-[10px] text-gray-400 uppercase font-semibold">{die.type}</span>
            <div 
              className="px-4 py-2 rounded min-w-[48px] flex items-center justify-center"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(251, 146, 60, 0.2)'
              }}
            >
              <span className="text-2xl font-bold">?</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Scene
