import { Environment } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useCustomDiceLoader } from '../../hooks/useCustomDiceLoader'
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { getFaceRendererForShape } from '../../lib/faceRenderers'
import { createDiceGeometry } from '../../lib/geometries'
import { prepareGeometryForTexturing } from '../../lib/geometryTexturing'
import {
  resolveDiceRenderLod,
  resolveRenderDeviceTier,
  type DiceRenderLodPolicy,
  type RenderDeviceTier,
} from '../../lib/renderLod'
import { useInventoryStore } from '../../store/useInventoryStore'
import type { InventoryDie } from '../../types/inventory'
import type { Theme } from '../../themes/tokens'

/** Static tilt applied to the previewed die so faces read clearly. */
const HERO_DIE_ROTATION: [number, number, number] = [0.45, 0.6, 0.2]

interface HeroDieInspectorProps {
  die: InventoryDie
  theme: Theme
  onClose: () => void
  onSpawn?: () => void
}

export function HeroDieInspector({ die, theme, onClose, onSpawn }: HeroDieInspectorProps) {
  const [name, setName] = useState(die.name)
  const [description, setDescription] = useState(die.description ?? '')
  const [tagsText, setTagsText] = useState((die.tags ?? []).join(', '))
  const [deviceTier, setDeviceTier] = useState<RenderDeviceTier>('high')
  const { renameDie, toggleFavorite, updateDie } = useInventoryStore()
  const rarityColor = getRarityColor(die.rarity, theme)

  useEffect(() => {
    setName(die.name)
    setDescription(die.description ?? '')
    setTagsText((die.tags ?? []).join(', '))
  }, [die.description, die.id, die.name, die.tags])

  useEffect(() => {
    setDeviceTier(resolveRenderDeviceTier({
      isMobile: window.innerWidth < 768,
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
    }))
  }, [])

  const heroLod = useMemo(() => resolveDiceRenderLod({
    context: 'hero',
    deviceTier,
    isFocused: true,
    isVisible: true,
  }), [deviceTier])

  const handleSave = () => {
    const nextName = name.trim()
    if (!nextName) return

    renameDie(die.id, nextName)
    updateDie(die.id, {
      description: description.trim() || undefined,
      tags: parseTags(tagsText),
    })
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-theme-bg/70 p-3"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${die.name} inspector`}
        className="grid max-h-[92vh] w-full max-w-5xl gap-4 overflow-y-auto rounded-lg p-4 md:grid-cols-[minmax(280px,0.9fr)_minmax(320px,1fr)] md:p-5"
        style={{
          backgroundColor: theme.tokens.colors.surface,
          color: theme.tokens.colors.text.primary,
          border: `1px solid ${rarityColor}`,
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <HeroDieStage die={die} theme={theme} heroLod={heroLod} />

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-2xl font-bold">{die.name}</h3>
                <span
                  className="rounded px-2 py-1 text-xs font-bold capitalize"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: rarityColor,
                  }}
                >
                  {die.rarity}
                </span>
              </div>
              <p className="mt-1 text-sm" style={{ color: theme.tokens.colors.text.secondary }}>
                {die.type.toUpperCase()} · {die.setId}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 shrink-0 rounded-full text-lg"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: theme.tokens.colors.text.secondary,
              }}
              aria-label="Close die inspector"
            >
              x
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailStat label="Rolls" value={die.stats.timesRolled.toString()} theme={theme} />
            <DetailStat label="Highest" value={die.stats.highestRoll?.toString() ?? '-'} theme={theme} />
            <DetailStat label="Source" value={die.source} theme={theme} />
            <DetailStat label="LOD" value={heroLod.fidelity} theme={theme} />
          </div>

          <div className="grid gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal">
              <span style={{ color: theme.tokens.colors.text.secondary }}>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-10 rounded-md px-3 text-sm outline-none"
                style={{
                  backgroundColor: theme.tokens.colors.background,
                  color: theme.tokens.colors.text.primary,
                  border: `1px solid ${theme.tokens.colors.text.muted}`,
                }}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal">
              <span style={{ color: theme.tokens.colors.text.secondary }}>Tags</span>
              <input
                type="text"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="combat, lucky, fire"
                className="h-10 rounded-md px-3 text-sm outline-none"
                style={{
                  backgroundColor: theme.tokens.colors.background,
                  color: theme.tokens.colors.text.primary,
                  border: `1px solid ${theme.tokens.colors.text.muted}`,
                }}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal">
              <span style={{ color: theme.tokens.colors.text.secondary }}>Notes</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="resize-none rounded-md px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: theme.tokens.colors.background,
                  color: theme.tokens.colors.text.primary,
                  border: `1px solid ${theme.tokens.colors.text.muted}`,
                }}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toggleFavorite(die.id)}
              className="h-10 rounded-md px-4 text-sm font-semibold"
              style={{
                backgroundColor: die.isFavorite ? 'rgba(251, 146, 60, 0.22)' : 'rgba(255, 255, 255, 0.08)',
                color: die.isFavorite ? theme.tokens.colors.accent : theme.tokens.colors.text.primary,
                border: `1px solid ${die.isFavorite ? theme.tokens.colors.accent : theme.tokens.colors.text.muted}`,
              }}
              aria-pressed={die.isFavorite}
            >
              {die.isFavorite ? 'Favorited' : 'Favorite'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="h-10 rounded-md px-4 text-sm font-semibold disabled:opacity-50"
              style={{
                backgroundColor: theme.tokens.colors.accent,
                color: theme.tokens.colors.text.primary,
              }}
            >
              Save Identity
            </button>
            {onSpawn && (
              <button
                type="button"
                onClick={onSpawn}
                className="h-10 rounded-md px-4 text-sm font-semibold"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: theme.tokens.colors.text.primary,
                  border: `1px solid ${theme.tokens.colors.text.muted}`,
                }}
              >
                Add to Table
              </button>
            )}
            <button
              type="button"
              disabled
              className="h-10 rounded-md px-4 text-sm font-semibold opacity-50"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: theme.tokens.colors.text.secondary,
                border: `1px solid ${theme.tokens.colors.text.muted}`,
              }}
              title="Texture and model customization will plug into this inspector."
            >
              Customize Skin
            </button>
          </div>

          <p className="break-all text-xs" style={{ color: theme.tokens.colors.text.muted }}>
            ID: {die.id}
          </p>
        </div>
      </div>
    </div>
  )
}

function HeroDieStage({
  die,
  theme,
  heroLod,
}: {
  die: InventoryDie
  theme: Theme
  heroLod: DiceRenderLodPolicy
}) {
  return (
    <div
      className="relative aspect-square min-h-[260px] overflow-hidden rounded-lg"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.32)',
        border: `1px solid ${theme.tokens.colors.text.muted}`,
      }}
      data-testid="hero-die-stage"
      data-lod={heroLod.debugLabel}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 38 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 5, 4]} intensity={2.4} castShadow />
        <directionalLight position={[-4, 2, -3]} intensity={0.8} />
        {/* Static preview — no physics. The die is a positioned mesh, matching the
            room-authoritative rendering model (issue #115). */}
        {die.customAsset ? (
          <Suspense fallback={null}>
            <CustomHeroDie die={die} />
          </Suspense>
        ) : (
          <StandardHeroDie die={die} theme={theme} heroLod={heroLod} />
        )}
        <Environment preset="city" />
      </Canvas>
    </div>
  )
}

/**
 * Static standard-die preview: a positioned, textured mesh (no physics body).
 */
function StandardHeroDie({
  die,
  theme,
  heroLod,
}: {
  die: InventoryDie
  theme: Theme
  heroLod: DiceRenderLodPolicy
}) {
  const geometry = useMemo(
    () => prepareGeometryForTexturing(createDiceGeometry(die.type, 1.75), die.type),
    [die.type],
  )

  const diceMats = theme.dice.materials
  const materials = useDiceMaterials({
    shape: die.type,
    color: die.appearance.baseColor,
    roughness: diceMats.roughness,
    metalness: diceMats.metalness,
    emissiveIntensity: diceMats.emissiveIntensity,
    faceRenderer: getFaceRendererForShape(die.type),
    lodPolicy: heroLod,
  })

  return (
    <mesh
      geometry={geometry}
      material={materials}
      rotation={HERO_DIE_ROTATION}
      castShadow
      receiveShadow
    />
  )
}

/**
 * Static custom-model preview: the loaded GLB scene as a positioned mesh.
 */
function CustomHeroDie({ die }: { die: InventoryDie }) {
  const asset = useMemo(
    () => ({
      id: die.customAsset?.assetId ?? die.id,
      modelUrl: die.customAsset!.modelUrl,
      metadata: die.customAsset!.metadata,
    }),
    [die],
  )

  const { scene, metadata } = useCustomDiceLoader(asset)
  const scale = metadata?.scale ?? 1.0

  if (!scene) return null

  return <primitive object={scene} scale={scale} rotation={HERO_DIE_ROTATION} />
}

function DetailStat({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.18)',
        border: `1px solid ${theme.tokens.colors.text.muted}`,
      }}
    >
      <dt className="text-xs uppercase tracking-normal" style={{ color: theme.tokens.colors.text.muted }}>
        {label}
      </dt>
      <dd className="mt-1 truncate font-semibold capitalize">{value}</dd>
    </div>
  )
}

function parseTags(value: string) {
  return Array.from(new Set(value
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean)))
}

function getRarityColor(rarity: InventoryDie['rarity'], theme: Theme) {
  switch (rarity) {
    case 'mythic':
      return '#f0abfc'
    case 'legendary':
      return '#facc15'
    case 'epic':
      return '#c084fc'
    case 'rare':
      return '#60a5fa'
    case 'uncommon':
      return '#34d399'
    case 'common':
    default:
      return theme.tokens.colors.text.muted
  }
}
