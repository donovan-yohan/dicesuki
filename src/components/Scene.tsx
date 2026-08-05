// External libraries
import { Environment } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

// Config
import { resolvePixelsPerUnit, arenaFitCameraHeight } from '../config/renderScale'
import { useEngineConfig } from '../config/engineConfig'
import { TABLE_ENVIRONMENT_MAP_URL } from '../config/environmentMaps'

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
import {
  formatDiceShapeLabel,
  groupPercentileResults,
  percentileSumCorrection,
} from '../lib/percentileRolls'
import { dieChipLabel, isBasicDiePresentation } from '../lib/basicDice'
import { aggregateSavedRollPlan, facesFromSettled } from '../lib/savedRollPlan'
import { detectRenderDeviceTier } from '../lib/deviceDetection'
import {
  type DiceRenderContext,
  type RenderDeviceTier,
  resolveDiceRenderLod,
  resolveRenderDeviceTier,
} from '../lib/renderLod'

// Stores
import { useDiceStore, type DieSettledState } from '../store/useDiceStore'
import { useDragStore } from '../store/useDragStore'
import { useInventoryStore } from '../store/useInventoryStore'
import type { DiceShape } from '../types/diceShape'
import type { InventoryDie } from '../types/inventory'
import { useMultiplayerStore, type MultiplayerDie as MultiplayerDieState } from '../store/useMultiplayerStore'
import { useUIStore } from '../store/useUIStore'
import { swapsAxes } from '../lib/viewRotation'
import { isPaymentsEnabled } from '../lib/paymentsConfig'

// Components
import { TableHud } from './layout/TableHud'
import { SceneAssetErrorBoundary } from './SceneAssetErrorBoundary'
import { MultiplayerArena } from './multiplayer/MultiplayerArena'
import { MultiplayerDie } from './multiplayer/MultiplayerDie'
import { PlayerPanel } from './multiplayer/PlayerPanel'
import { RoomNotices } from './multiplayer/RoomNotices'
import { MultiplayerMotionController } from './multiplayer/MultiplayerMotionController'
import { RoomMotionHint } from './multiplayer/RoomMotionHint'
import { STANDARD_ROLL_CONVERSION_AVAILABLE } from './economy/shopCatalog'
import { HeroDieInspector, HistoryPanel, InventoryPanel, SavedRollsPanel, SettingsPanel, ShopPanel } from './panels'
import type { TableDieSummary } from '../types/tableDice'

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
      className="fixed bottom-20 left-3 z-50 max-w-[min(92vw,360px)] rounded-xl border border-[#f98797]/30 bg-black/75 px-3 py-2 font-mono text-[10px] text-white/90 shadow-xl backdrop-blur"
      style={{ pointerEvents: 'none' }}
    >
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#f98797]">
        render lod · {deviceTier} · {isMultiplayer ? 'multiplayer' : 'local'} · table {tableDiceCount}
      </div>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5">
        {policies.map((policy) => {
          const textureSizeLabel = policy.textureSize > 0 ? `${policy.textureSize}px` : 'none'

          return (
            <div key={policy.context} className="contents">
              <span className="text-[#f98797]">{policy.context}</span>
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
  const dirLightRef = useRef<THREE.DirectionalLight>(null)

  // Size the shadow frustum to the arena's half-diagonal × 1.4 (tilt allowance for
  // the angled light) + margin: a fixed ±10 box clipped corner dice out of the
  // shadow map. Bounds from the room EngineConfig (Shared-ADR-007); fallback pre-config.
  const config = useEngineConfig()
  const shadowExtent = useMemo(() => {
    const hx = config?.arenaHalfX
    const hz = config?.arenaHalfZ
    if (hx === undefined || hz === undefined) return 16
    const halfDiagonal = Math.hypot(hx, hz)
    return halfDiagonal * 1.4 + 3 // tilt allowance (~1/cos40°) + margin
  }, [config])

  useEffect(() => {
    const light = dirLightRef.current
    if (!light) return
    const cam = light.shadow.camera as THREE.OrthographicCamera
    cam.left = -shadowExtent
    cam.right = shadowExtent
    cam.top = shadowExtent
    cam.bottom = -shadowExtent
    // Depth range along the light axis: generous so no die is clipped near/far even
    // for a large arena viewed from the angled light.
    cam.near = 0.5
    cam.far = shadowExtent * 4 + 40
    cam.updateProjectionMatrix()
  }, [shadowExtent])

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
        ref={dirLightRef}
        position={lighting.directional.position}
        color={lighting.directional.color}
        intensity={lighting.directional.intensity}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        // Frustum bounds are set to the arena size in the effect above.
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

      {/* HDR Environment lighting with the night preset */}
      <ThemedEnvironmentMap />
    </>
  )
}

/**
 * HDR image-based lighting for the table.
 *
 * The map is served from our own origin and precached by the service worker
 * (issue #222), so the common failure it used to have — drei's asset CDN being
 * slow, blocked, or simply unreachable offline — is gone, and an offline boot
 * now gets the same lighting as an online one.
 *
 * It stays isolated on BOTH failure axes anyway (issue #210), because "same
 * origin" is not "cannot fail": a corrupted precache entry, an evicted cache on
 * a storage-pressured device, or a partial response still reject or hang here.
 *
 * - `Suspense`, because `<Canvas>` puts every child in a single Suspense
 *   boundary: an unguarded suspend here also suspends {@link SceneReadySignal},
 *   so a slow or never-landing request left the startup splash mounted with
 *   nothing on screen to explain it.
 * - {@link SceneAssetErrorBoundary}, because a *rejected* request re-throws out
 *   of the Canvas into the DOM tree, where nothing catches it and the app blanks.
 *
 * Both fallbacks are `null`, which is a real but survivable downgrade rather
 * than a no-op: without the map the table is lit only by `ThemedLighting`'s
 * ambient/directional/point lights, and metallic dice lose roughly 30-38% of
 * their body brightness because most of a metal's diffuse response comes from
 * the environment. Hue, speculars and numeral contrast all survive, so the
 * table stays readable and playable — which is the trade we want against a
 * splash that never leaves.
 *
 * `resetKey` is constant on purpose. The URL never changes, and re-mounting a
 * request that just failed on every re-render would be worse than the dimmer
 * lighting; the map is retried on the next page load.
 */
function ThemedEnvironmentMap() {
  return (
    <SceneAssetErrorBoundary resetKey={TABLE_ENVIRONMENT_MAP_URL} fallback={null}>
      <Suspense fallback={null}>
        <Environment files={TABLE_ENVIRONMENT_MAP_URL} />
      </Suspense>
    </SceneAssetErrorBoundary>
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
 * Camera controller. Fixed zoom so a die always covers `DICE_PIXELS_PER_UNIT` CSS px
 * whatever the canvas size; camera height derives from the CSS height (a bigger
 * canvas shows MORE arena, not bigger dice). The solo arena is sized from the SAME
 * scale, so the walls frame exactly what this camera shows. `?ppu=NN` overrides it.
 */
function MultiplayerCamera() {
  const { camera, size } = useThree()
  // The room delivers its actual arena bounds (Shared-ADR-007/009). The camera
  // frames THOSE, so a host-chosen shared shape fits every viewport (letterboxing
  // when the arena aspect differs from the window) and reflows on a resize.
  const engineConfig = useEngineConfig()
  // This client's local view rotation (ADR 009) — camera-only, never the world.
  const viewRotation = useUIStore((s) => s.viewRotation)

  useEffect(() => {
    if (!('fov' in camera)) return // Only for PerspectiveCamera
    const perspCamera = camera as THREE.PerspectiveCamera
    const halfFovV = ((perspCamera.fov * Math.PI) / 180) / 2

    // A 90°/270° view swaps which arena axis maps to the viewport height vs width,
    // so the fit uses swapped half-extents.
    const swap = swapsAxes(viewRotation)
    const cameraHeight = engineConfig
      ? arenaFitCameraHeight(
          swap ? engineConfig.arenaHalfZ : engineConfig.arenaHalfX,
          swap ? engineConfig.arenaHalfX : engineConfig.arenaHalfZ,
          size.width,
          size.height,
          perspCamera.fov,
        )
      // Pre-config fallback (before room_state arrives): legacy fixed-scale framing.
      : size.height / resolvePixelsPerUnit() / (2 * Math.tan(halfFovV))

    perspCamera.position.set(0, cameraHeight, 0)
    perspCamera.lookAt(0, 0, 0)
    // Client-only view rotation: spin the camera about the vertical (view) axis.
    // Pointer raycasts use this camera, so drag/throw stay correct for free; only
    // the sensor-derived motion impulse needs a matching rotation (ADR 009).
    if (viewRotation !== 0) {
      perspCamera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), (viewRotation * Math.PI) / 180)
    }
    perspCamera.updateProjectionMatrix()
  }, [camera, size.width, size.height, engineConfig, viewRotation])

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
interface SceneProps {
  onReady?: () => void
}

/**
 * Fires `onReady` on the first frame the renderer actually draws — the signal
 * that lets the startup splash uncover the table (`StartupGate`).
 *
 * MUST stay outside the scene-content `Suspense` boundary below. `<Canvas>`
 * renders its children inside ONE boundary of its own, so a sibling that
 * suspends on an asset also unmounts this subscriber and the splash waits on
 * that asset instead of on the renderer (issue #210). Keeping the signal above
 * a boundary that owns everything else makes the handoff depend only on the
 * frame loop, which starts as soon as the WebGL context exists.
 */
function SceneReadySignal({ onReady }: SceneProps) {
  const didSignalRef = useRef(false)

  useFrame(() => {
    if (!onReady || didSignalRef.current) return
    didSignalRef.current = true
    onReady()
  })

  return null
}

function SceneContent({ onReady }: SceneProps) {
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
  const [isShopOpen, setIsShopOpen] = useState(false)
  const [isPlayerPanelOpen, setIsPlayerPanelOpen] = useState(false)
  const [inspectedInventoryDieId, setInspectedInventoryDieId] = useState<string | null>(null)
  const [renderDeviceTier, setRenderDeviceTier] = useState<RenderDeviceTier>('high')
  const [showRenderLodDebug, setShowRenderLodDebug] = useState(false)
  const detectedRenderDeviceTierRef = useRef<RenderDeviceTier | null>(null)
  const railBeforeOverlayRef = useRef(false)

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


  // No inventory seeding on first load: an empty collection is the default, and
  // basic dice (`lib/basicDice.ts`) are the playable floor.

  // Get the active backend — always provided by SoloRoom / MultiplayerRoom
  const activeBackend = useDiceBackend()
  const isMultiplayer = activeBackend.mode === 'multiplayer'
  const showShop = isPaymentsEnabled() || STANDARD_ROLL_CONVERSION_AVAILABLE

  // Delegate add/remove/clear through the active room backend
  const handleAddDice = useCallback(
    (type: string, specificInventoryDieId?: string) => {
      activeBackend.addDie(type as DiceShape, specificInventoryDieId)
    },
    [activeBackend]
  )

  const savedRollWavesPending = useDiceStore((s) => s.savedRollWavesPending)

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

  // Hiding the HUD is a structural state, not an animation preference. Closing
  // transient chrome prevents reduced-motion users from retaining controls
  // that are visually supposed to collapse to the permanent eye button.
  useEffect(() => {
    if (isUIVisible) return
    setIsDiceManagerOpen(false)
    setIsHistoryOpen(false)
    setIsSavedRollsOpen(false)
    setIsInventoryOpen(false)
    setIsSettingsOpen(false)
    setIsShopOpen(false)
    setIsPlayerPanelOpen(false)
    setInspectedInventoryDieId(null)
    railBeforeOverlayRef.current = false
  }, [isUIVisible])

  // Any overlay that owns the screen (full-screen shop, bottom sheets, the
  // settings flyout, the hero inspector). While one is open the HUD must not
  // paint over it or steal its taps.
  const isOverlayOpen =
    isShopOpen ||
    isSettingsOpen ||
    isInventoryOpen ||
    isHistoryOpen ||
    isSavedRollsOpen ||
    inspectedInventoryDieId !== null

  // Auto-close the dice toolbar rail while an overlay owns the screen, and
  // restore it afterwards so the player's rail state survives the round trip.
  useEffect(() => {
    if (isOverlayOpen) {
      setIsDiceManagerOpen(open => {
        railBeforeOverlayRef.current = open
        return false
      })
      return
    }
    if (railBeforeOverlayRef.current) {
      railBeforeOverlayRef.current = false
      setIsDiceManagerOpen(true)
    }
  }, [isOverlayOpen])

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
        {/* Outside the boundary below on purpose — see SceneReadySignal. */}
        <SceneReadySignal onReady={onReady} />
        {/* Camera already configured via Canvas props */}

        {/* Backstop boundary for the scene's assets. Each loader already owns a
            nearer `Suspense` + `SceneAssetErrorBoundary` pair (the dice GLBs in
            `MultiplayerDie`, the HDR map in `ThemedEnvironmentMap`), so this one
            should never actually catch a suspend. It exists so that if a future
            child DOES load an asset unguarded, it stalls only the scene content
            — never the ready signal above it, and never the whole app through
            `<Canvas>`'s own boundary, which re-throws into the DOM tree. */}
        <Suspense fallback={null}>
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
        </Suspense>
      </Canvas>

      <TableHud
        isUIVisible={isUIVisible}
        isOverlayOpen={isOverlayOpen}
        isMobile={isMobile}
        motionMode={motionMode}
        showShop={showShop}
        isDiceManagerOpen={isDiceManagerOpen}
        // A saved roll's follow-up waves are still spawning: `roll` impulses
        // every die the player owns, so it would re-roll the dice that already
        // landed and invalidate the plan mid-sequence.
        canRoll={tableDice.length > 0 && !savedRollWavesPending}
        onToggleUIVisibility={toggleUIVisibility}
        onOpenDiceManager={() => setIsDiceManagerOpen(!isDiceManagerOpen)}
        onOpenSavedRolls={() => setIsSavedRollsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenPlayerPanel={() => setIsPlayerPanelOpen(!isPlayerPanelOpen)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenShop={() => setIsShopOpen(true)}
        onRotateView={() => useUIStore.getState().rotateViewCW()}
        onToggleMotion={handleToggleMotion}
        // Called, not passed by reference: the HUD button ends up as a DOM
        // `onClick`, which would otherwise hand the click event in as the
        // saved-roll name (#244). A HUD roll is anonymous by definition.
        onRoll={() => activeBackend.roll()}
        onAddDice={handleAddDice}
        onClearAllDice={activeBackend.clearAll}
        onOpenInventory={() => {
          setIsInventoryOpen(true)
          setIsDiceManagerOpen(false)
        }}
      />

      {isUIVisible && (
        <>
          {/* Result Display - subscribes to store */}
          <ResultDisplay />

          <RenderLodDebugOverlay
            isVisible={showRenderLodDebug}
            deviceTier={renderDeviceTier}
            tableDiceCount={useMultiplayerStore.getState().dice.size}
            isMultiplayer={isMultiplayer}
          />

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
            onClose={() => setIsInventoryOpen(false)}
            onSpawnDie={handleAddDice}
          />

          <SettingsPanel
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />

          <ShopPanel
            isOpen={isShopOpen}
            onClose={() => setIsShopOpen(false)}
            initialTab="banners"
            onAddDie={(type, inventoryDieId) => activeBackend.addDie(type, inventoryDieId)}
            tableDiceCount={multiplayerDice.size}
            deviceTier={renderDeviceTier}
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

          {/* Players / room controls are also available from the solo table. */}
          <PlayerPanel isOpen={isPlayerPanelOpen} />
          {isMultiplayer && (
            <>
              <RoomNotices />
              <RoomMotionHint />
            </>
          )}
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
function Scene({ onReady }: SceneProps) {
  return <SceneContent onReady={onReady} />
}

/**
 * Shared chip container styles for dice result display
 */
const CHIP_STYLES = {
  solid: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(249, 135, 151, 0.3)',
  },
  muted: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(249, 135, 151, 0.2)',
  },
} as const

/**
 * Reusable chip component for displaying individual die results, rolling state, or bonuses
 */
function DiceChip({ label, children, variant = 'solid', className = '', testId, dropped }: {
  label: string
  children: React.ReactNode
  variant?: 'solid' | 'muted'
  className?: string
  testId?: string
  /** Marks a die excluded by keep/drop, so a browser test can read the split. */
  dropped?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1 ${className}`}
      data-testid={testId}
      data-dropped={dropped === undefined ? undefined : String(dropped)}
    >
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
  const rollNotice = useDiceStore((s) => s.rollNotice)
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

  // A percentile pair reads as ONE d100 result, so it renders as one chip.
  const resultGroups = groupPercentileResults(settledArray)

  // Advanced mechanics (keep/drop, exploding, reroll, clamps, successes) are
  // scored from the saved roll's plan; without one this is the plain sum.
  const plan = activeSavedRoll?.plan
  const aggregate = useMemo(
    () => (plan ? aggregateSavedRollPlan(plan, facesFromSettled(filteredSettledDice)) : null),
    [plan, filteredSettledDice],
  )

  const flatBonus = activeSavedRoll?.flatBonus ?? 0
  let grandTotal: number
  if (aggregate) {
    // Dice outside the plan — another player's, or ones dropped on the table by
    // hand — keep contributing their face, as the HUD has always done. The plan
    // combines its OWN percentile pairs, so the correction applies only to
    // these; correcting a planned pair again would double-count it.
    const unplanned = settledArray.filter((d) => !aggregate.dice.has(d.diceId))
    grandTotal = aggregate.total
      + unplanned.reduce((acc, d) => acc + d.value, 0)
      + percentileSumCorrection(unplanned)
  } else {
    // Percentile (d100) pairs read `tens + ones`, except `00 + 0` which is 100.
    // The room total stays a plain face sum by design, so the correction is
    // applied here, client-side. Both are read off the dice's own presentation
    // blocks, so a table edit, a remote player's roll or a post-refresh view all
    // stay correct (see src/lib/percentileRolls.ts).
    const perDieBonusTotal = activeSavedRoll
      ? settledArray.reduce((acc, d) => acc + (activeSavedRoll.perDieBonuses.get(d.diceId) ?? 0), 0)
      : 0
    grandTotal = rawSum + percentileSumCorrection(settledArray) + perDieBonusTotal + flatBonus
  }

  const droppedCount = aggregate?.droppedCount ?? 0
  const isSuccessCounting = aggregate?.isSuccessCounting ?? false

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

  const rollingDiceOnTable = Array.from(multiplayerDice.values())
    .filter((die) => filteredRollingDice.has(die.id))

  return (
    <div
      className="absolute top-8 left-0 right-0 text-white z-20 flex items-start justify-center gap-4 overflow-x-auto pointer-events-none px-4"
      style={{
        maxHeight: '40vh',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(249, 135, 151, 0.5) transparent'
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
          <div data-testid="roll-grand-total" className="text-5xl font-bold" style={{
            color: 'var(--color-accent)',
            textShadow: '0 0 15px rgba(249, 135, 151, 0.5)'
          }}>
            {isAnyRolling ? '?' : grandTotal}
          </div>
        </div>

        {/* What the big number means, when it is not a plain sum */}
        {isSuccessCounting && !isAnyRolling && (
          <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted, rgba(255,255,255,0.5))' }}>
            {Math.abs(grandTotal) === 1 ? 'success' : 'successes'}
          </div>
        )}
        {droppedCount > 0 && !isAnyRolling && (
          <div data-testid="roll-dropped-hint" className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted, rgba(255,255,255,0.5))' }}>
            {droppedCount} dropped
          </div>
        )}

        {/* Individual dice chips + flat bonus */}
        <div className="flex gap-2 justify-center flex-wrap">
          {/* Settled dice. A percentile pair shows as ONE combined d100 chip.
              A die dropped by keep/drop is dimmed and struck through rather
              than hidden — the player rolled it and needs to see what it was,
              but it must not read as part of the total. */}
          {resultGroups.map((group) => {
            if (group.kind === 'percentile') {
              const { tens, ones, value } = group
              // Both halves belong to one plan group, so either reports the
              // pair's kept state; the bonus rides on the ones die (the tens
              // half is anonymous scaffolding — see `bonusMemberId`).
              const scoredPair = aggregate?.dice.get(ones.diceId)
              const isPairDropped = scoredPair !== undefined && !scoredPair.kept
              const bonusStr = formatBonus(
                scoredPair
                  ? scoredPair.bonus
                  : (activeSavedRoll?.perDieBonuses.get(tens.diceId) ?? 0)
                    + (activeSavedRoll?.perDieBonuses.get(ones.diceId) ?? 0),
              )
              return (
                <DiceChip
                  key={`d100-${tens.diceId}`}
                  label={isPairDropped ? 'D100 (dropped)' : 'D100'}
                  variant={isPairDropped ? 'muted' : 'solid'}
                  className={isPairDropped ? 'opacity-60' : ''}
                  testId="result-die-chip"
                  dropped={scoredPair ? isPairDropped : undefined}
                >
                  <span className={`text-lg font-bold ${isPairDropped ? 'line-through' : ''}`}>
                    {value}
                  </span>
                  {bonusStr && !isPairDropped && (
                    <span className="text-sm font-semibold ml-0.5" style={{ color: 'var(--color-accent)' }}>
                      {bonusStr}
                    </span>
                  )}
                </DiceChip>
              )
            }

            const die = group.die
            const scored = aggregate?.dice.get(die.diceId)
            const isDropped = scored !== undefined && !scored.kept
            const bonusStr = formatBonus(
              scored ? scored.bonus : activeSavedRoll?.perDieBonuses.get(die.diceId) ?? 0,
            )
            return (
              <DiceChip
                key={die.diceId}
                label={isDropped ? `${getResultDieLabel(die)} (dropped)` : getResultDieLabel(die)}
                variant={isDropped ? 'muted' : 'solid'}
                className={isDropped ? 'opacity-60' : ''}
                testId="result-die-chip"
                dropped={scored ? isDropped : undefined}
              >
                <span className={`text-lg font-bold ${isDropped ? 'line-through' : ''}`}>{die.value}</span>
                {bonusStr && !isDropped && (
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
          {/* Flat bonus chip. Success counting ignores the flat bonus
              (see SavedRoll.flatBonus), so showing it would be a lie. */}
          {activeSavedRoll && flatBonus !== 0 && !isSuccessCounting && !isAnyRolling && (
            <DiceChip label="Bonus">
              <span className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
                {formatBonus(flatBonus)}
              </span>
            </DiceChip>
          )}
        </div>

        {/* Follow-up waves run after the saved-rolls panel closed, so this is
            the only place they can report a budget or failure. */}
        {rollNotice && (
          <div
            role="status"
            data-testid="roll-notice"
            className="max-w-xs text-center text-[11px] px-3 py-1.5 rounded-lg pointer-events-auto"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              border: '1px solid rgba(249, 135, 151, 0.3)',
              color: 'var(--color-text-secondary, rgba(255,255,255,0.75))',
            }}
          >
            {rollNotice}
          </div>
        )}
      </div>
    </div>
  )
}

function getResultDieLabel(die: DieSettledState) {
  // `dieChipLabel` reads a basic die as its bare shape (`D6`, not `Basic D6`) and
  // keeps a stray, unpaired tens die from surfacing as the raw engine shape
  // `d10tens`.
  return dieChipLabel(die.type, die.presentation)
}

function getRollingDieLabel(die: MultiplayerDieState, inventoryDiceById: Map<string, InventoryDie>) {
  if (isBasicDiePresentation(die.presentation)) return formatDiceShapeLabel(die.diceType)
  const inventoryDieId = die.presentation?.inventoryDieId
  return die.presentation?.displayName
    ?? (inventoryDieId ? inventoryDiceById.get(inventoryDieId)?.name : undefined)
    ?? formatDiceShapeLabel(die.diceType)
}

export default Scene
