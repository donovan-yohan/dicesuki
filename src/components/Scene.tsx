// External libraries
import { Environment } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

// Config
// Arena bounds come from the room's engine config (Shared-ADR-007), the single
// source of truth in dicesuki-core — not a copied client constant.
import { useEngineConfig } from '../config/engineConfig'

// Contexts
import { useDiceBackend } from '../contexts/DiceBackendContext'
import { useDeviceMotionState } from '../contexts/DeviceMotionContext'
import { useTheme } from '../contexts/ThemeContext'

// Hooks
import { useEnvironmentTheme } from '../hooks/useEnvironmentTheme'
import { PerformanceOverlay } from './effects/PerformanceOverlay'
import { useMultiplayerDrag } from '../hooks/useMultiplayerDrag'
import { useSnapshotInterpolation } from '../hooks/useSnapshotInterpolation'

// Utilities
import { formatBonus } from '../lib/diceHelpers'
import { detectRenderDeviceTier } from '../lib/deviceDetection'
import {
  type DiceRenderContext,
  type RenderDeviceTier,
  resolveDiceRenderLod,
  resolveRenderDeviceTier,
} from '../lib/renderLod'

// Stores
import { useDiceManagerStore, type DiceInstance } from '../store/useDiceManagerStore'
import { useDiceStore, type DieSettledState } from '../store/useDiceStore'
import { useDragStore } from '../store/useDragStore'
import { useInventoryStore } from '../store/useInventoryStore'
import type { DiceShape } from '../types/diceShape'
import type { InventoryDie } from '../types/inventory'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useUIStore } from '../store/useUIStore'

// Components
import { BottomNav, CenterRollButton, CornerIcon, DiceToolbar, UIToggleMini } from './layout'
import { MultiplayerArena } from './multiplayer/MultiplayerArena'
import { MultiplayerDie } from './multiplayer/MultiplayerDie'
import { PlayerPanel } from './multiplayer/PlayerPanel'
import { RoomNotices } from './multiplayer/RoomNotices'
import { MultiplayerMotionController } from './multiplayer/MultiplayerMotionController'
import { RoomMotionHint } from './multiplayer/RoomMotionHint'
import { HeroDieInspector, HistoryPanel, InventoryPanel, SavedRollsPanel, SettingsPanel } from './panels'
import type { TableDieSummary } from '../types/tableDice'

/**
 * Shared styles for top-right corner buttons
 */
const TOP_RIGHT_BUTTON_STYLES = {
  backgroundColor: 'rgba(31, 41, 55, 0.7)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
  border: '1px solid rgba(251, 146, 60, 0.2)'
} as const

const LOD_DEBUG_NAMESPACE = 'RenderLOD'

function isRenderLodDebugEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('lod') === '1' || params.get('lodDebug') === '1') return true

    const debugConfig = window.localStorage.getItem('debug')
    if (!debugConfig) return false
    if (debugConfig === '*') return true
    return debugConfig.split(',').some((namespace) => namespace.trim() === LOD_DEBUG_NAMESPACE)
  } catch {
    return false
  }
}

function getRenderDeviceTierOverride(): RenderDeviceTier | null {
  try {
    const tier = new URLSearchParams(window.location.search).get('lodTier')
    return tier === 'low' || tier === 'mid' || tier === 'high' ? tier : null
  } catch {
    return null
  }
}

function RenderLodDebugOverlay({
  isVisible,
  deviceTier,
  tableDiceCount,
  isMultiplayer,
}: {
  isVisible: boolean
  deviceTier: RenderDeviceTier
  tableDiceCount: number
  isMultiplayer: boolean
}) {
  if (!isVisible) return null

  const contexts: DiceRenderContext[] = ['hero', 'tray', 'grid', 'offscreen']
  const policies = contexts.map((context) => resolveDiceRenderLod({
    context,
    deviceTier,
    isVisible: context !== 'offscreen',
    isFocused: context === 'hero',
    isInteracting: context === 'tray',
  }))

  return (
    <div
      data-testid="render-lod-debug"
      className="fixed bottom-20 left-3 z-50 max-w-[min(92vw,360px)] rounded-xl border border-orange-400/30 bg-black/75 px-3 py-2 font-mono text-[10px] text-orange-100 shadow-xl backdrop-blur"
      style={{ pointerEvents: 'none' }}
    >
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-orange-300">
        render lod · {deviceTier} · {isMultiplayer ? 'multiplayer' : 'local'} · table {tableDiceCount}
      </div>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5">
        {policies.map((policy) => {
          const textureSizeLabel = policy.textureSize > 0 ? `${policy.textureSize}px` : 'none'

          return (
            <div key={policy.context} className="contents">
              <span className="text-orange-300">{policy.context}</span>
              <span>{policy.fidelity} · {textureSizeLabel} · {policy.physicsMode}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Compute camera frustum width and height at a given distance from the camera.
 * @param camera - An object with a fov property (degrees)
 * @param distance - The distance along the camera's view axis (e.g. camera height above ground)
 * @param aspect - Aspect ratio (width / height)
 */
function getCameraFrustumDimensions(
  camera: { fov: number },
  distance: number,
  aspect: number
): { width: number; height: number } {
  const vFOV = THREE.MathUtils.degToRad(camera.fov)
  const height = 2 * Math.tan(vFOV / 2) * distance
  const width = height * aspect
  return { width, height }
}

/**
 * Themed background component
 * Sets the Three.js scene background color from theme
 */
function ThemedBackground() {
  const { scene } = useThree()
  const currentTheme = useEnvironmentTheme()
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
  const currentTheme = useEnvironmentTheme()
  const lighting = currentTheme.environment.lighting
  const { size } = useThree()

  // Mobile detection for performance optimization
  const isMobile = size.width < 768

  // Calculate wall positions for torch placement (for dungeon theme)
  const isDungeonTheme = currentTheme.id === 'dungeon-castle'

  // Calculate viewport bounds for torch positioning
  const aspect = size.width / size.height
  const distance = 15 // camera height
  const { width, height } = getCameraFrustumDimensions({ fov: 40 }, distance, aspect)
  const margin = -0.05

  const wallPositions = {
    left: -(width / 2) * (1 + margin),
    right: (width / 2) * (1 + margin),
    top: (height / 2) * (1 + margin),
    bottom: -(height / 2) * (1 + margin),
  }

  // Performance optimization: lower shadow quality on mobile
  const shadowMapSize = isMobile ? 512 : 2048

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
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />

      {/* Torch lights on walls for dungeon theme */}
      {isDungeonTheme && (
        <>
          {/* North wall torch - no shadows on mobile for performance */}
          <pointLight
            position={[0, 3, wallPositions.top - 1.5]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}

          />
          {/* South wall torch */}
          <pointLight
            position={[0, 3, wallPositions.bottom + 1.5]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}

          />
          {/* East wall torch */}
          <pointLight
            position={[wallPositions.right - 1.5, 3, 0]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}

          />
          {/* West wall torch */}
          <pointLight
            position={[wallPositions.left + 1.5, 3, 0]}
            color="#ff8c42"
            intensity={16.0}
            distance={15}
            decay={1.5}

          />
        </>
      )}

      {/* HDR Environment lighting with city preset */}
      <Environment preset="night" />
    </>
  )
}

/**
 * Renders multiplayer dice with interpolation (no physics).
 * Used inside Canvas when mode === 'multiplayer'.
 */
function MultiplayerDiceRenderer({ renderDeviceTier }: { renderDeviceTier: RenderDeviceTier }) {
  const dice = useMultiplayerStore((s) => s.dice)
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const tRef = useSnapshotInterpolation()
  const { onPointerDown } = useMultiplayerDrag()

  return (
    <>
      {Array.from(dice.values()).map((die) => (
        <MultiplayerDie
          key={die.id}
          dieId={die.id}
          diceType={die.diceType}
          color={players.get(die.ownerId)?.color ?? '#ffffff'}
          presentation={die.presentation}
          tRef={tRef}
          isOwnedByLocalPlayer={die.ownerId === localPlayerId}
          renderDeviceTier={renderDeviceTier}
          onDragStart={onPointerDown}
        />
      ))}
    </>
  )
}

/**
 * Camera controller for multiplayer mode.
 * Adjusts camera height so the full 9:16 arena is visible on any screen.
 */
function MultiplayerCamera() {
  const { camera, size } = useThree()
  // Arena half-extents come from the room's engine config (Shared-ADR-007): the
  // single source of truth in dicesuki-core, not a copied client constant.
  const config = useEngineConfig()
  const arenaHalfX = config?.arenaHalfX
  const arenaHalfZ = config?.arenaHalfZ

  useEffect(() => {
    if (!('fov' in camera)) return // Only for PerspectiveCamera
    if (arenaHalfX === undefined || arenaHalfZ === undefined) return // wait for config
    const perspCamera = camera as THREE.PerspectiveCamera
    const aspect = size.width / size.height

    const fovRad = (perspCamera.fov * Math.PI) / 180
    const halfFovV = fovRad / 2

    // Calculate height needed to see full arena depth (Z axis)
    const heightForZ = arenaHalfZ / Math.tan(halfFovV)

    // Calculate height needed to see full arena width (X axis)
    const halfFovH = Math.atan(Math.tan(halfFovV) * aspect)
    const heightForX = arenaHalfX / Math.tan(halfFovH)

    // Use the larger height (ensures both dimensions fit) + margin
    const cameraHeight = Math.max(heightForZ, heightForX) * 1.05 // 5% margin

    perspCamera.position.set(0, cameraHeight, 0)
    perspCamera.lookAt(0, 0, 0)
    perspCamera.updateProjectionMatrix()
  }, [camera, size.width, size.height, arenaHalfX, arenaHalfZ])

  return null
}

/**
 * Main 3D scene content — must be rendered inside a DiceBackendProvider.
 *
 * All dice play (solo and multiplayer) flows through the room backend: dice are
 * rendered as positioned meshes driven by snapshot interpolation, never local
 * `<Physics>` bodies. The server (native for multiplayer, the in-browser WASM
 * room worker for solo) owns physics and face detection.
 *
 * CRITICAL ARCHITECTURE:
 * - The Canvas must NEVER re-render due to UI state changes
 * - UI state (settledDice, rollHistory) is in Zustand store
 * - Only UI components subscribe to store, not the Scene component
 */
function SceneContent() {
  // Get requestPermission from state context
  const { requestPermission } = useDeviceMotionState()

  // Room-authoritative dice (positioned meshes, snapshot-interpolated)
  const multiplayerDice = useMultiplayerStore((state) => state.dice)
  const localPlayerId = useMultiplayerStore((state) => state.localPlayerId)

  // Subscribe to inventory dice for reactive lookup during render
  const inventoryDice = useInventoryStore((state) => state.dice)

  // O(1) lookup map for inventory dice by id, avoiding O(n*m) .find() inside .map()
  const inventoryDiceMap = useMemo(() => {
    const map = new Map<string, InventoryDie>()
    for (const die of inventoryDice) {
      map.set(die.id, die)
    }
    return map
  }, [inventoryDice])

  // Subscribe to drag store
  const setOnDiceDelete = useDragStore((state) => state.setOnDiceDelete)

  // UI state
  const { isUIVisible, toggleUIVisibility, motionMode, toggleMotionMode } = useUIStore()
  const { currentTheme } = useTheme()
  const [isDiceManagerOpen, setIsDiceManagerOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSavedRollsOpen, setIsSavedRollsOpen] = useState(false)
  const [isInventoryOpen, setIsInventoryOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isPlayerPanelOpen, setIsPlayerPanelOpen] = useState(false)
  const [inspectedInventoryDieId, setInspectedInventoryDieId] = useState<string | null>(null)
  const [renderDeviceTier, setRenderDeviceTier] = useState<RenderDeviceTier>('high')
  const [showRenderLodDebug, setShowRenderLodDebug] = useState(false)
  const detectedRenderDeviceTierRef = useRef<RenderDeviceTier | null>(null)

  // Detect if mobile
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    let isCancelled = false

    const checkMobile = () => {
      const nextIsMobile = window.innerWidth < 768
      const tierOverride = getRenderDeviceTierOverride()
      setIsMobile(nextIsMobile)
      setRenderDeviceTier(tierOverride ?? detectedRenderDeviceTierRef.current ?? resolveRenderDeviceTier({
        isMobile: nextIsMobile,
        viewportWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
      }))
      setShowRenderLodDebug(isRenderLodDebugEnabled())
    }

    checkMobile()
    detectRenderDeviceTier().then((detectedTier) => {
      if (!isCancelled) {
        detectedRenderDeviceTierRef.current = detectedTier
        setRenderDeviceTier(getRenderDeviceTierOverride() ?? detectedTier)
      }
    })

    window.addEventListener('resize', checkMobile)
    return () => {
      isCancelled = true
      window.removeEventListener('resize', checkMobile)
    }
  }, [])


  // Initialize starter dice on first load
  useEffect(() => {
    useInventoryStore.getState().initializeStarterDice()
  }, [])

  // Get the active backend — always provided by SoloRoom / MultiplayerRoom
  const activeBackend = useDiceBackend()
  const isMultiplayer = activeBackend.mode === 'multiplayer'

  // Delegate add/remove/clear through the active room backend
  const handleAddDice = useCallback(
    (type: string, specificInventoryDieId?: string) => {
      activeBackend.addDie(type as DiceShape, specificInventoryDieId)
    },
    [activeBackend]
  )

  const tableDice = useMemo<TableDieSummary[]>(() => {
    return Array.from(multiplayerDice.values())
      .filter((die) => !localPlayerId || die.ownerId === localPlayerId)
      .map((die) => ({
        id: die.id,
        type: die.diceType,
        inventoryDieId: die.presentation?.inventoryDieId,
        displayName: die.presentation?.displayName,
        setId: die.presentation?.setId,
        rarity: die.presentation?.rarity,
      }))
  }, [localPlayerId, multiplayerDice])
  const inspectedInventoryDie = inspectedInventoryDieId
    ? inventoryDiceMap.get(inspectedInventoryDieId)
    : undefined

  const handleToggleMotion = useCallback(async () => {
    if (!motionMode) {
      // Enabling motion mode - request permission first
      console.log('Requesting device motion permission...')
      await requestPermission()
    }
    // Toggle the mode
    toggleMotionMode()
  }, [motionMode, requestPermission, toggleMotionMode])

  // Register delete callback with drag store
  useEffect(() => {
    setOnDiceDelete(activeBackend.removeDie)
    return () => setOnDiceDelete(undefined)
  }, [setOnDiceDelete, activeBackend.removeDie])

  const content = (
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

        {/* Room dice: positioned meshes driven by snapshot interpolation. */}
        <MultiplayerCamera />
        <MultiplayerArena />
        <MultiplayerDiceRenderer renderDeviceTier={renderDeviceTier} />
        <MultiplayerMotionController />

        {/* Performance monitoring */}
        <PerformanceOverlay />
      </Canvas>

      {/* Result Display - subscribes to store */}
      <ResultDisplay />

      <RenderLodDebugOverlay
        isVisible={showRenderLodDebug}
        deviceTier={renderDeviceTier}
        tableDiceCount={useMultiplayerStore.getState().dice.size}
        isMultiplayer={isMultiplayer}
      />

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
      <CenterRollButton
        onClick={activeBackend.roll}
        disabled={tableDice.length === 0}
      />

      {/* Top-Left Corner: Settings */}
      <CornerIcon
        position="top-left"
        onClick={() => setIsSettingsOpen(true)}
        label="Settings"
        isVisible={isUIVisible}
      >
        ⚙️
      </CornerIcon>

      {/* Top-Right: My Dice Rolls */}
      <div
        className="fixed z-40"
        style={{
          top: '16px',
          right: '16px',
          pointerEvents: isUIVisible ? 'auto' : 'none'
        }}
      >
        <button
          onClick={() => setIsSavedRollsOpen(true)}
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all hover:scale-110"
          style={{
            ...TOP_RIGHT_BUTTON_STYLES,
            opacity: isUIVisible ? 1 : 0,
            transform: isUIVisible ? 'scale(1)' : 'scale(0.8)'
          }}
          aria-label="My Dice Rolls"
          title="Saved Rolls"
        >
          📋
        </button>
      </div>

      {/* Top-Right (Lowest): Room Players — multiplayer only */}
      {isMultiplayer && (
        <div
          className="fixed z-40"
          style={{
            top: '80px',
            right: '16px',
            pointerEvents: isUIVisible ? 'auto' : 'none'
          }}
        >
          <button
            onClick={() => setIsPlayerPanelOpen(!isPlayerPanelOpen)}
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all hover:scale-110"
            style={{
              ...TOP_RIGHT_BUTTON_STYLES,
              opacity: isUIVisible ? 1 : 0,
              transform: isUIVisible ? 'scale(1)' : 'scale(0.8)',
            }}
            aria-label="Room Players"
            title="Toggle player list"
          >
            👥
          </button>
        </div>
      )}

      {/* Mini UI Toggle - shows when UI hidden */}
      <UIToggleMini onClick={toggleUIVisibility} isVisible={isUIVisible} />

      {/* DICE TOOLBAR - Compact slide-out dice management */}
      <DiceToolbar
        isOpen={isDiceManagerOpen}
        onAddDice={handleAddDice}
        onClearAllDice={activeBackend.clearAll}
        onOpenInventory={() => {
          setIsInventoryOpen(true)
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
        tableDice={tableDice}
      />

      <InventoryPanel
        isOpen={isInventoryOpen}
        onClose={() => {
          setIsInventoryOpen(false)
        }}
        onSpawnDie={handleAddDice}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {inspectedInventoryDie && (
        <HeroDieInspector
          die={inspectedInventoryDie}
          theme={currentTheme}
          onClose={() => setInspectedInventoryDieId(null)}
          onSpawn={() => {
            handleAddDice(inspectedInventoryDie.type, inspectedInventoryDie.id)
            setInspectedInventoryDieId(null)
          }}
        />
      )}

      {/* Multiplayer player panel + join/leave notices */}
      {isMultiplayer && (
        <>
          <PlayerPanel isOpen={isPlayerPanelOpen} />
          <RoomNotices />
          <RoomMotionHint />
        </>
      )}

    </>
  )

  return content
}

/**
 * Scene entry point. Must be rendered inside a DiceBackendProvider — SoloRoom
 * (WASM worker room) and MultiplayerRoom (network room) each supply their own
 * room backend before mounting Scene.
 */
function Scene() {
  return <SceneContent />
}

/**
 * Shared chip container styles for dice result display
 */
const CHIP_STYLES = {
  solid: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(251, 146, 60, 0.3)',
  },
  muted: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(251, 146, 60, 0.2)',
  },
} as const

/**
 * Reusable chip component for displaying individual die results, rolling state, or bonuses
 */
function DiceChip({ label, children, variant = 'solid', className = '' }: {
  label: string
  children: React.ReactNode
  variant?: 'solid' | 'muted'
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <span className="max-w-20 truncate text-[8px] text-gray-400 uppercase font-semibold" title={label}>
        {label}
      </span>
      <div
        className="backdrop-blur-sm px-3 py-1.5 rounded min-w-[40px] flex items-center justify-center"
        style={CHIP_STYLES[variant]}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Unified result display component
 * Shows sum of all settled dice, individual dice chips, and "?" for rolling dice
 */
function ResultDisplay() {
  const settledDice = useDiceStore((s) => s.settledDice)
  const rollingDice = useDiceStore((s) => s.rollingDice)
  const activeSavedRoll = useDiceStore((s) => s.activeSavedRoll)
  const dice = useDiceManagerStore((s) => s.dice)
  const inventoryDice = useInventoryStore((s) => s.dice)
  const inventoryDiceById = useMemo(() => {
    const map = new Map<string, InventoryDie>()
    for (const die of inventoryDice) {
      map.set(die.id, die)
    }
    return map
  }, [inventoryDice])

  // Per-player filtering (multiplayer only)
  const selectedPlayerId = useMultiplayerStore((s) => s.selectedPlayerId)
  const multiplayerDice = useMultiplayerStore((s) => s.dice)
  const isMultiplayerMode = useMultiplayerStore((s) => s.localPlayerId) !== null
  const isFilterActive = isMultiplayerMode && selectedPlayerId !== null

  const isOwnedBySelectedPlayer = useCallback(
    (dieId: string): boolean => {
      const mpDie = multiplayerDice.get(dieId)
      return mpDie !== undefined && mpDie.ownerId === selectedPlayerId
    },
    [multiplayerDice, selectedPlayerId],
  )

  const filteredSettledDice = useMemo(() => {
    if (!isFilterActive) return settledDice
    const filtered = new Map<string, DieSettledState>()
    for (const [id, die] of settledDice) {
      if (isOwnedBySelectedPlayer(id)) filtered.set(id, die)
    }
    return filtered
  }, [settledDice, isFilterActive, isOwnedBySelectedPlayer])

  const filteredRollingDice = useMemo(() => {
    if (!isFilterActive) return rollingDice
    const filtered = new Set<string>()
    for (const id of rollingDice) {
      if (isOwnedBySelectedPlayer(id)) filtered.add(id)
    }
    return filtered
  }, [rollingDice, isFilterActive, isOwnedBySelectedPlayer])

  const prevSumRef = useRef<number | null>(null)
  const [shouldAnimate, setShouldAnimate] = useState(false)

  const settledArray = Array.from(filteredSettledDice.values())
  const rawSum = settledArray.reduce((acc, d) => acc + d.value, 0)
  const isAnyRolling = filteredRollingDice.size > 0
  const hasSettled = settledArray.length > 0

  // Calculate grand total with bonuses
  const perDieBonusTotal = activeSavedRoll
    ? settledArray.reduce((acc, d) => acc + (activeSavedRoll.perDieBonuses.get(d.diceId) ?? 0), 0)
    : 0
  const flatBonus = activeSavedRoll?.flatBonus ?? 0
  const grandTotal = rawSum + perDieBonusTotal + flatBonus

  // Animate sum changes
  useEffect(() => {
    if (prevSumRef.current !== null && prevSumRef.current !== grandTotal) {
      setShouldAnimate(true)
      const timer = setTimeout(() => setShouldAnimate(false), 500)
      return () => clearTimeout(timer)
    }
    prevSumRef.current = grandTotal
  }, [grandTotal])

  if (!hasSettled && !isAnyRolling) return null

  const rollingDiceOnTable = dice.filter(d => filteredRollingDice.has(d.id))

  return (
    <div
      className="absolute top-8 left-0 right-0 text-white z-20 flex items-start justify-center gap-4 overflow-x-auto pointer-events-none px-4"
      style={{
        maxHeight: '40vh',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(251, 146, 60, 0.5) transparent'
      }}
    >
      <div className="flex flex-col items-center gap-2">
        {/* Roll name (if saved roll active) */}
        {activeSavedRoll && (
          <div className="text-xs font-semibold uppercase tracking-wider" style={{
            color: 'var(--color-text-secondary, rgba(255,255,255,0.6))',
          }}>
            {activeSavedRoll.name}
          </div>
        )}

        {/* Grand total */}
        <div className={`flex flex-col items-center gap-1 transition-transform ${shouldAnimate ? 'animate-bounce' : ''}`}>
          <div className="text-5xl font-bold" style={{
            color: 'var(--color-accent)',
            textShadow: '0 0 15px rgba(251, 146, 60, 0.5)'
          }}>
            {isAnyRolling ? '?' : grandTotal}
          </div>
        </div>

        {/* Individual dice chips + flat bonus */}
        <div className="flex gap-2 justify-center flex-wrap">
          {/* Settled dice */}
          {settledArray.map((die) => {
            const bonusStr = formatBonus(activeSavedRoll?.perDieBonuses.get(die.diceId) ?? 0)
            return (
              <DiceChip key={die.diceId} label={getResultDieLabel(die)}>
                <span className="text-lg font-bold">{die.value}</span>
                {bonusStr && (
                  <span className="text-sm font-semibold ml-0.5" style={{ color: 'var(--color-accent)' }}>
                    {bonusStr}
                  </span>
                )}
              </DiceChip>
            )
          })}
          {/* Rolling dice */}
          {rollingDiceOnTable.map((die) => (
            <DiceChip key={`rolling-${die.id}`} label={getRollingDieLabel(die, inventoryDiceById)} variant="muted" className="animate-pulse">
              <span className="text-lg font-bold">?</span>
            </DiceChip>
          ))}
          {/* Flat bonus chip */}
          {activeSavedRoll && flatBonus !== 0 && !isAnyRolling && (
            <DiceChip label="Bonus">
              <span className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
                {formatBonus(flatBonus)}
              </span>
            </DiceChip>
          )}
        </div>
      </div>
    </div>
  )
}

function getResultDieLabel(die: DieSettledState) {
  return die.presentation?.displayName ?? die.type.toUpperCase()
}

function getRollingDieLabel(die: DiceInstance, inventoryDiceById: Map<string, InventoryDie>) {
  if (!die.inventoryDieId) return die.type.toUpperCase()
  return inventoryDiceById.get(die.inventoryDieId)?.name ?? die.type.toUpperCase()
}

export default Scene
