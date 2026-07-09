import { useEffect, useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import * as THREE from 'three'

import { createDiceGeometry } from '../../lib/geometries'
import type { InventoryDie } from '../../types/inventory'

interface SharedInventoryDicePreviewCanvasProps {
  dice: InventoryDie[]
  hostRef: RefObject<HTMLElement | null>
  slotRefs: MutableRefObject<Map<string, HTMLElement>>
}

interface PreviewEntry {
  group: THREE.Group
  geometry: THREE.BufferGeometry
  edgesGeometry: THREE.EdgesGeometry
  material: THREE.MeshStandardMaterial
  edgeMaterial: THREE.LineBasicMaterial
  spinSeed: number
}

const MATERIAL_DEFAULTS = {
  plastic: { roughness: 0.68, metalness: 0.06 },
  resin: { roughness: 0.42, metalness: 0.08 },
  metal: { roughness: 0.28, metalness: 0.72 },
  stone: { roughness: 0.86, metalness: 0.02 },
  glass: { roughness: 0.14, metalness: 0.02 },
  crystal: { roughness: 0.2, metalness: 0.08 },
  wood: { roughness: 0.78, metalness: 0.02 },
  bone: { roughness: 0.7, metalness: 0.02 },
  obsidian: { roughness: 0.24, metalness: 0.18 },
  celestial: { roughness: 0.34, metalness: 0.2 },
} as const

export function SharedInventoryDicePreviewCanvas({
  dice,
  hostRef,
  slotRefs,
}: SharedInventoryDicePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const entriesRef = useRef<Map<string, PreviewEntry>>(new Map())

  useEffect(() => {
    const nextEntries = new Map<string, PreviewEntry>()

    for (const die of dice) {
      const geometry = createDiceGeometry(die.type, 1)
      geometry.center()
      geometry.computeBoundingSphere()

      const materialDefaults = MATERIAL_DEFAULTS[die.appearance.material]
      const material = new THREE.MeshStandardMaterial({
        color: normalizeHexColor(die.appearance.baseColor, '#f8fafc'),
        roughness: die.appearance.roughness ?? materialDefaults.roughness,
        metalness: die.appearance.metalness ?? materialDefaults.metalness,
        emissive: new THREE.Color(normalizeHexColor(die.appearance.emissive, '#000000')),
        emissiveIntensity: die.appearance.emissiveIntensity ?? (die.appearance.material === 'celestial' ? 0.18 : 0),
        transparent: die.appearance.material === 'glass' || die.appearance.material === 'crystal',
        opacity: die.appearance.material === 'glass' ? 0.66 : 1,
      })
      const edgesGeometry = new THREE.EdgesGeometry(geometry, 18)
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: normalizeHexColor(die.appearance.accentColor, '#ffffff'),
        transparent: true,
        opacity: 0.64,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const edges = new THREE.LineSegments(edgesGeometry, edgeMaterial)
      const group = new THREE.Group()
      const radius = geometry.boundingSphere?.radius ?? 1
      const scale = 1.18 / Math.max(radius, 0.001)

      mesh.castShadow = false
      mesh.receiveShadow = false
      group.scale.setScalar(scale)
      group.add(mesh)
      group.add(edges)

      nextEntries.set(die.id, {
        group,
        geometry,
        edgesGeometry,
        material,
        edgeMaterial,
        spinSeed: hashStringToUnit(die.id) * Math.PI * 2,
      })
    }

    const previousEntries = entriesRef.current
    entriesRef.current = nextEntries
    previousEntries.forEach(disposePreviewEntry)

    return () => {
      nextEntries.forEach(disposePreviewEntry)
    }
  }, [dice])

  useEffect(() => {
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

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
    const reducedMotion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

    const animate = (time: number) => {
      const host = hostRef.current
      if (!host) {
        frameId = window.requestAnimationFrame(animate)
        return
      }

      const hostRect = host.getBoundingClientRect()
      width = Math.max(1, hostRect.width)
      height = Math.max(1, hostRect.height)
      renderer.setSize(width, height, false)
      renderer.clear()

      const elapsed = time / 1000
      const entries = entriesRef.current

      for (const die of dice) {
        const entry = entries.get(die.id)
        const slot = slotRefs.current.get(die.id)
        if (!entry || !slot) continue

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
        entry.group.rotation.set(
          -0.58 + Math.sin(entry.spinSeed) * 0.2 + (reducedMotion ? 0 : elapsed * 0.28),
          entry.spinSeed + (reducedMotion ? 0 : elapsed * 0.72),
          0.18 + Math.cos(entry.spinSeed) * 0.18 + (reducedMotion ? 0 : elapsed * 0.12),
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
  }, [dice, hostRef, slotRefs])

  return (
    <canvas
      ref={canvasRef}
      data-testid="inventory-preview-canvas"
      data-preview-mode="shared-three"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      aria-hidden="true"
    />
  )
}

function disposePreviewEntry(entry: PreviewEntry) {
  entry.geometry.dispose()
  entry.edgesGeometry.dispose()
  entry.material.dispose()
  entry.edgeMaterial.dispose()
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
