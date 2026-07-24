import { useEffect, useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import * as THREE from 'three'

import { createDiceGeometry } from '../../lib/geometries'
import { createFaceMaterialsArray } from '../../lib/faceMaterialMapping'
import { resolveDiceMaterial, buildDiceFaceMaterial } from '../../lib/diceMaterial'
import { prepareGeometryForTexturing } from '../../lib/geometryTexturing'
import type { DiceShape } from '../../types/diceShape'
import type { InventoryDie } from '../../types/inventory'
import type {
  DiceGeometryDetail,
  DiceRenderLodPolicy,
} from '../../lib/renderLod'

interface SharedInventoryDicePreviewCanvasProps {
  dice: InventoryDie[]
  hostRef: RefObject<HTMLElement | null>
  slotRefs: MutableRefObject<Map<string, HTMLElement>>
  lodPolicy?: DiceRenderLodPolicy
}

interface PreviewEntry {
  group: THREE.Group
  geometryKey: string
  materialKey: string
  spinSeed: number
}

interface GeometryCacheEntry {
  geometry: THREE.BufferGeometry
  refCount: number
}

interface MaterialCacheEntry {
  materials: THREE.Material[]
  refCount: number
}

interface IdleScheduler {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const PREVIEW_TEXTURE_SIZE = 128
const PREVIEW_LOAD_BATCH_SIZE = 6

export function SharedInventoryDicePreviewCanvas({
  dice,
  hostRef,
  slotRefs,
  lodPolicy,
}: SharedInventoryDicePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const entriesRef = useRef<Map<string, PreviewEntry>>(new Map())
  const geometryCacheRef = useRef<Map<string, GeometryCacheEntry>>(new Map())
  const materialCacheRef = useRef<Map<string, MaterialCacheEntry>>(new Map())

  useEffect(() => {
    if (
      lodPolicy?.geometryDetail === 'billboard' ||
      lodPolicy?.materialMode === 'hidden'
    ) {
      entriesRef.current.forEach(entry => disposePreviewEntry(
        entry,
        geometryCacheRef.current,
        materialCacheRef.current,
      ))
      entriesRef.current.clear()
      return
    }
    let isCancelled = false
    let scheduleHandle: ReturnType<typeof globalThis.setTimeout> | number | null = null
    let scheduleKind: 'idle' | 'timeout' | null = null
    const requestedDice = new Map(dice.map(die => [die.id, die]))
    const entries = entriesRef.current

    for (const [dieId, entry] of entries) {
      const die = requestedDice.get(dieId)
      const expectedGeometryKey = die
        ? getGeometryCacheKey(die.type, lodPolicy?.geometryDetail ?? 'full')
        : null
      if (
        !die ||
        getMaterialCacheKey(die, lodPolicy?.textureSize) !== entry.materialKey ||
        expectedGeometryKey !== entry.geometryKey
      ) {
        disposePreviewEntry(entry, geometryCacheRef.current, materialCacheRef.current)
        entries.delete(dieId)
      }
    }

    const loadQueue = dice.filter(die => !entries.has(die.id))

    const scheduleNextBatch = () => {
      if (isCancelled || loadQueue.length === 0) return
      const idleScheduler = globalThis as typeof globalThis & IdleScheduler
      if (typeof idleScheduler.requestIdleCallback === 'function') {
        scheduleKind = 'idle'
        scheduleHandle = idleScheduler.requestIdleCallback(loadNextBatch, { timeout: 120 })
      } else {
        scheduleKind = 'timeout'
        scheduleHandle = globalThis.setTimeout(loadNextBatch, 24)
      }
    }

    const loadNextBatch = () => {
      if (isCancelled) return

      for (let count = 0; count < PREVIEW_LOAD_BATCH_SIZE && loadQueue.length > 0; count += 1) {
        const die = loadQueue.shift()
        if (!die || !requestedDice.has(die.id) || entries.has(die.id)) continue
        entries.set(die.id, createPreviewEntry(
          die,
          geometryCacheRef.current,
          materialCacheRef.current,
          lodPolicy,
        ))
      }

      scheduleNextBatch()
    }

    loadNextBatch()

    return () => {
      isCancelled = true
      const idleScheduler = globalThis as typeof globalThis & IdleScheduler
      if (scheduleKind === 'idle' && typeof scheduleHandle === 'number') {
        idleScheduler.cancelIdleCallback?.(scheduleHandle)
      } else if (scheduleKind === 'timeout' && scheduleHandle !== null) {
        globalThis.clearTimeout(scheduleHandle)
      }
    }
  }, [dice, lodPolicy])

  useEffect(() => {
    const entries = entriesRef.current
    const geometryCache = geometryCacheRef.current
    const materialCache = materialCacheRef.current

    return () => {
      entries.forEach(entry => disposePreviewEntry(entry, geometryCache, materialCache))
      entries.clear()
      geometryCache.forEach(entry => entry.geometry.dispose())
      geometryCache.clear()
      materialCache.forEach(entry => disposePreviewMaterials(entry.materials))
      materialCache.clear()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      })
    } catch {
      return
    }

    renderer.setClearColor(0x000000, 0)
    renderer.setScissorTest(true)
    const pixelRatioCap = (lodPolicy?.textureSize ?? PREVIEW_TEXTURE_SIZE) <= 128 ? 1 : 1.5
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap))

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0, 0.18, 5)
    camera.lookAt(0, 0, 0)

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.45)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    const rimLight = new THREE.DirectionalLight(0x9cc9ff, 0.85)
    keyLight.position.set(2.8, 3.2, 4)
    rimLight.position.set(-3, 1.8, -2.5)
    scene.add(ambientLight, keyLight, rimLight)

    let frameId = 0
    let width = 0
    let height = 0
    const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

    const animate = (time: number) => {
      const host = hostRef.current
      if (!host) {
        frameId = window.requestAnimationFrame(animate)
        return
      }

      const hostRect = host.getBoundingClientRect()
      const nextWidth = Math.max(1, hostRect.width)
      const nextHeight = Math.max(1, hostRect.height)
      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth
        height = nextHeight
        renderer.setSize(width, height, false)
      }
      renderer.clear()

      const elapsed = time / 1000
      const entries = entriesRef.current

      for (const [dieId, entry] of entries) {
        const slot = slotRefs.current.get(dieId)
        if (!slot) continue

        const slotRect = slot.getBoundingClientRect()
        if (slotRect.width <= 0 || slotRect.height <= 0) continue

        const x = slotRect.left - hostRect.left
        const y = slotRect.top - hostRect.top
        const slotWidth = slotRect.width
        const slotHeight = slotRect.height
        const viewportY = height - y - slotHeight

        if (x + slotWidth < 0 || y + slotHeight < 0 || x > width || y > height) {
          continue
        }

        entry.group.visible = true
        const animationScale = reducedMotion || lodPolicy?.animationQuality === 'none'
          ? 0
          : lodPolicy?.animationQuality === 'reduced'
            ? 0.5
            : 1
        entry.group.rotation.set(
          -0.58 + Math.sin(entry.spinSeed) * 0.2 + elapsed * 0.28 * animationScale,
          entry.spinSeed + elapsed * 0.72 * animationScale,
          0.18 + Math.cos(entry.spinSeed) * 0.18 + elapsed * 0.12 * animationScale,
        )
        scene.add(entry.group)

        camera.aspect = slotWidth / slotHeight
        camera.updateProjectionMatrix()
        renderer.setViewport(x, viewportY, slotWidth, slotHeight)
        renderer.setScissor(x, viewportY, slotWidth, slotHeight)
        renderer.render(scene, camera)

        scene.remove(entry.group)
      }

      frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(frameId)
      renderer.dispose()
    }
  }, [hostRef, lodPolicy, slotRefs])

  if (
    lodPolicy?.geometryDetail === 'billboard' ||
    lodPolicy?.materialMode === 'hidden'
  ) return null

  return (
    <canvas
      ref={canvasRef}
      data-testid="inventory-preview-canvas"
      data-preview-batch-size={PREVIEW_LOAD_BATCH_SIZE}
      data-preview-mode="engine-textured-batched"
      data-texture-size={lodPolicy?.textureSize ?? PREVIEW_TEXTURE_SIZE}
      data-geometry-detail={lodPolicy?.geometryDetail ?? 'full'}
      data-animation-quality={lodPolicy?.animationQuality ?? 'full'}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      aria-hidden="true"
    />
  )
}

function createPreviewEntry(
  die: InventoryDie,
  geometryCache: Map<string, GeometryCacheEntry>,
  materialCache: Map<string, MaterialCacheEntry>,
  lodPolicy?: DiceRenderLodPolicy,
): PreviewEntry {
  const geometryDetail = lodPolicy?.geometryDetail ?? 'full'
  const geometryEntry = acquirePreviewGeometry(die.type, geometryDetail, geometryCache)
  const textureSize = lodPolicy?.textureSize || PREVIEW_TEXTURE_SIZE
  const materialKey = getMaterialCacheKey(die, textureSize)
  const materialEntry = acquirePreviewMaterials(die, materialKey, materialCache, textureSize)
  const mesh = new THREE.Mesh(geometryEntry.geometry, materialEntry.materials)
  const group = new THREE.Group()
  const radius = geometryEntry.geometry.boundingSphere?.radius ?? 1
  const scale = 1.18 / Math.max(radius, 0.001)

  mesh.castShadow = lodPolicy?.castShadow ?? false
  mesh.receiveShadow = lodPolicy?.receiveShadow ?? false
  group.scale.setScalar(scale)
  group.add(mesh)

  return {
    group,
    geometryKey: getGeometryCacheKey(die.type, geometryDetail),
    materialKey,
    spinSeed: hashStringToUnit(die.id) * Math.PI * 2,
  }
}

function acquirePreviewGeometry(
  shape: DiceShape,
  detail: DiceGeometryDetail,
  cache: Map<string, GeometryCacheEntry>,
): GeometryCacheEntry {
  const key = getGeometryCacheKey(shape, detail)
  const cached = cache.get(key)
  if (cached) {
    cached.refCount += 1
    return cached
  }

  const geometry = prepareGeometryForTexturing(createDiceGeometry(shape, 1), shape)
  if (detail === 'reduced') {
    // Retain only attributes consumed by the preview shader. Catalog assets may
    // carry tangents/colors/morph data that a small pooled cell cannot display.
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attribute)) {
        geometry.deleteAttribute(attribute)
      }
    }
  }
  geometry.center()
  geometry.computeBoundingSphere()
  const entry = { geometry, refCount: 1 }
  cache.set(key, entry)
  return entry
}

function acquirePreviewMaterials(
  die: InventoryDie,
  materialKey: string,
  cache: Map<string, MaterialCacheEntry>,
  textureSize: number,
): MaterialCacheEntry {
  const cached = cache.get(materialKey)
  if (cached) {
    cached.refCount += 1
    return cached
  }

  const color = normalizeHexColor(die.appearance.baseColor, '#f8fafc')
  const emissiveColor = normalizeHexColor(die.appearance.emissive, '#000000')
  const emissiveIntensity = die.appearance.emissiveIntensity ?? (die.appearance.material === 'celestial' ? 0.18 : 0)
  const transparent = die.appearance.material === 'glass' || die.appearance.material === 'crystal'
  const opacity = die.appearance.material === 'glass' ? 0.66 : 1

  // Face renderer / mask / PBR come from the SHARED resolver (identical to the
  // tray's MultiplayerDie), and construction goes through the SHARED builder, so a
  // preview cannot drift from the die actually rendered on the table.
  const resolution = resolveDiceMaterial(die.type, die.appearance.material)
  const extras = {
    emissive: emissiveIntensity > 0 ? emissiveColor : undefined,
    emissiveIntensity,
    transparent,
    opacity,
  }
  const materials = createFaceMaterialsArray(die.type, (faceValue) =>
    buildDiceFaceMaterial({
      shape: die.type,
      faceValue,
      color,
      resolution,
      textureSize,
      extras,
    }),
  )
  const entry = { materials, refCount: 1 }
  cache.set(materialKey, entry)
  return entry
}

function disposePreviewEntry(
  entry: PreviewEntry,
  geometryCache: Map<string, GeometryCacheEntry>,
  materialCache: Map<string, MaterialCacheEntry>,
) {
  const geometryEntry = geometryCache.get(entry.geometryKey)
  if (geometryEntry) {
    geometryEntry.refCount -= 1
    if (geometryEntry.refCount <= 0) {
      geometryEntry.geometry.dispose()
      geometryCache.delete(entry.geometryKey)
    }
  }

  const materialEntry = materialCache.get(entry.materialKey)
  if (materialEntry) {
    materialEntry.refCount -= 1
    if (materialEntry.refCount <= 0) {
      disposePreviewMaterials(materialEntry.materials)
      materialCache.delete(entry.materialKey)
    }
  }

  entry.group.clear()
}

function disposePreviewMaterials(materials: THREE.Material[]) {
  materials.forEach((material) => {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.map?.dispose()
      // matte-metal numbers assign one mask texture to both slots — dispose once.
      material.metalnessMap?.dispose()
    }
    material.dispose()
  })
}

function getMaterialCacheKey(die: InventoryDie, textureSize = PREVIEW_TEXTURE_SIZE) {
  // PBR + face renderer + mask are derived from `die.appearance.material` by the
  // shared resolver, so the material string (already keyed) covers them.
  return [
    die.type,
    normalizeHexColor(die.appearance.baseColor, '#f8fafc'),
    normalizeHexColor(die.appearance.emissive, '#000000'),
    die.appearance.emissiveIntensity ?? (die.appearance.material === 'celestial' ? 0.18 : 0),
    die.appearance.material,
    die.appearance.material === 'glass' ? 0.66 : 1,
    textureSize,
  ].join('|')
}

function getGeometryCacheKey(shape: DiceShape, detail: DiceGeometryDetail) {
  return `${shape}:${detail}`
}

function normalizeHexColor(value: string | undefined, fallback: string) {
  if (!value) return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return fallback
}

function hashStringToUnit(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash % 1000) / 1000
}
