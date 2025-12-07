import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { useCallback, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { saveCustomDiceModel } from '../lib/customDiceDB'
import { getDiceColliderConfig, getDiceFaceNormalsForMetadata } from '../lib/diceColliders'
import {
  renderD20Bordered,
  renderD20Simple,
  renderD20Styled,
} from '../lib/faceRenderers/d20Renderer'
import {
  DiceShape,
  getDiceFaceValue,
} from '../lib/geometries'
import { extractGeometryFaceNormals, invertMapping, logMapping } from '../lib/geometryFaceMapper'
import { analyzeGeometry, getPreviewGeometry } from '../lib/previewGeometries'
import {
  FaceRenderer,
  renderBorderedNumber,
  renderDiceFaceToTexture,
  renderSimpleNumber,
  renderStyledNumber,
} from '../lib/textureRendering'
import { useInventoryStore } from '../store/useInventoryStore'

/**
 * Dice Preview Utility Page
 *
 * Development tool for testing dice materials and face rendering.
 * Features:
 * - Live preview of dice with custom materials
 * - Hot reload support for rapid iteration
 * - Visual validation of face-to-normal mapping
 * - No physics simulation (static preview)
 */
type RendererType = 'simple' | 'styled' | 'bordered' | 'debug'

export default function DicePreview() {
  const [selectedShape, setSelectedShape] = useState<DiceShape>('d6')
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0])
  const [rendererType, setRendererType] = useState<RendererType>('simple')
  const [diceColor, setDiceColor] = useState('#ff6b35')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle')

  const addDie = useInventoryStore(state => state.addDie)
  const previewMeshRef = useRef<THREE.Mesh | null>(null)

  // Calculate detected face value based on rotation
  const detectedValue = useMemo(() => {
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2])
    )
    return getDiceFaceValue(quaternion, selectedShape)
  }, [rotation, selectedShape])

  const handleSaveToInventory = useCallback(async () => {
    if (!previewMeshRef.current) {
      console.error('[DicePreview] No mesh to export')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      return
    }

    setSaveStatus('saving')

    try {
      console.log('[DicePreview] Starting GLB export...')

      // Export the mesh to GLB format
      const exporter = new GLTFExporter()

      // Store current rotation to restore after export
      const currentRotation = previewMeshRef.current.rotation.clone()

      // Reset rotation to identity (0,0,0) for export
      // This ensures the model is exported in its canonical orientation,
      // matching the face normals defined in geometries.ts
      previewMeshRef.current.rotation.set(0, 0, 0)
      previewMeshRef.current.updateMatrixWorld()

      const glbData = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          previewMeshRef.current!,
          (result: unknown) => {
            console.log('[DicePreview] GLB export successful')
            // Restore rotation
            if (previewMeshRef.current) {
              previewMeshRef.current.rotation.copy(currentRotation)
              previewMeshRef.current.updateMatrixWorld()
            }
            resolve(result as ArrayBuffer)
          },
          (error: unknown) => {
            console.error('[DicePreview] GLB export error:', error)
            // Restore rotation
            if (previewMeshRef.current) {
              previewMeshRef.current.rotation.copy(currentRotation)
              previewMeshRef.current.updateMatrixWorld()
            }
            reject(error)
          },
          {
            binary: true,        // Export as GLB (binary GLTF)
            embedImages: true,   // Include all textures in the GLB
            maxTextureSize: 2048 // Limit texture size
          }
        )
      })

      // Generate unique asset ID
      const assetId = `dev_preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Save GLB to IndexedDB
      console.log('[DicePreview] Saving GLB to IndexedDB:', assetId)
      await saveCustomDiceModel(assetId, glbData)

      // Create blob URL for immediate use
      const blob = new Blob([glbData], { type: 'model/gltf-binary' })
      const blobUrl = URL.createObjectURL(blob)
      console.log('[DicePreview] Created blob URL:', blobUrl)

      // Get collider configuration for selected dice shape
      const colliderConfig = getDiceColliderConfig(selectedShape, 1.0)
      const faceNormals = getDiceFaceNormalsForMetadata(selectedShape)

      // Add die to inventory with reference to custom asset
      const newDie = addDie({
        type: selectedShape,
        setId: 'dev-preview',
        rarity: 'common',
        appearance: {
          baseColor: diceColor,
          accentColor: '#ffffff',
          material: 'plastic',
          roughness: 0.7,
          metalness: 0.1,
        },
        vfx: {},
        customAsset: {
          modelUrl: blobUrl, // Blob URL for current session
          assetId: assetId, // IndexedDB key for persistence
          metadata: {
            type: 'dev-export',
            rendererType,
            exportedAt: new Date().toISOString(),
            exportSource: 'DicePreview',
            // Physics metadata for CustomDice component
            diceType: selectedShape,
            colliderType: colliderConfig.type,
            colliderArgs: colliderConfig.args,
            physics: {
              mass: 1.0,
              restitution: 0.3,
              friction: 0.6
            },
            scale: 1.0,
            // Face normals for detection (shape-specific)
            faceNormals: faceNormals
          }
        },
        name: `Dev ${selectedShape.toUpperCase()} (${rendererType})`,
        description: `Exported from Dice Preview utility with ${rendererType} renderer`,
        isFavorite: false,
        isLocked: false,
        isDev: true,
        source: 'starter',
      })

      console.log('[DicePreview] ✓ Die saved to inventory:', newDie.id)
      setSaveStatus('success')

      // Reset status after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('[DicePreview] Failed to export die:', error)
      setSaveStatus('error')

      // Reset status after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [selectedShape, diceColor, rendererType, addDie])

  const handleDownloadGLTF = useCallback(async () => {
    if (!previewMeshRef.current) {
      console.error('[DicePreview] No mesh to export')
      setDownloadStatus('error')
      setTimeout(() => setDownloadStatus('idle'), 3000)
      return
    }

    setDownloadStatus('downloading')

    try {
      console.log('[DicePreview] Starting GLTF download export...')

      // Export the mesh to GLB format
      const exporter = new GLTFExporter()

      // Store current rotation to restore after export
      const currentRotation = previewMeshRef.current.rotation.clone()

      // Reset rotation to identity (0,0,0) for export
      previewMeshRef.current.rotation.set(0, 0, 0)
      previewMeshRef.current.updateMatrixWorld()

      const glbData = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          previewMeshRef.current!,
          (result: unknown) => {
            console.log('[DicePreview] GLTF export successful')
            // Restore rotation
            if (previewMeshRef.current) {
              previewMeshRef.current.rotation.copy(currentRotation)
              previewMeshRef.current.updateMatrixWorld()
            }
            resolve(result as ArrayBuffer)
          },
          (error: unknown) => {
            console.error('[DicePreview] GLTF export error:', error)
            // Restore rotation
            if (previewMeshRef.current) {
              previewMeshRef.current.rotation.copy(currentRotation)
              previewMeshRef.current.updateMatrixWorld()
            }
            reject(error)
          },
          {
            binary: true,        // Export as GLB (binary GLTF)
            embedImages: true,   // Include all textures in the GLB
            maxTextureSize: 2048 // Limit texture size
          }
        )
      })

      // Create download link
      const blob = new Blob([glbData], { type: 'model/gltf-binary' })
      const url = URL.createObjectURL(blob)

      // Generate filename based on dice type and renderer
      const filename = `dice_${selectedShape}_${rendererType}_${Date.now()}.glb`

      // Trigger browser download
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Clean up blob URL after short delay
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      console.log('[DicePreview] ✓ Downloaded:', filename)
      setDownloadStatus('success')

      // Reset status after 2 seconds
      setTimeout(() => setDownloadStatus('idle'), 2000)
    } catch (error) {
      console.error('[DicePreview] Failed to download GLTF:', error)
      setDownloadStatus('error')

      // Reset status after 3 seconds
      setTimeout(() => setDownloadStatus('idle'), 3000)
    }
  }, [selectedShape, rendererType])

  return (
    <div className="w-screen h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gray-800/90 backdrop-blur-sm p-4 border-b border-gray-700">
        <h1 className="text-2xl font-bold mb-2">Dice Preview Utility</h1>
        <p className="text-sm text-gray-400">
          Development tool for testing dice materials and face mapping
        </p>
      </div>

      {/* Controls Panel */}
      <div className="absolute top-24 left-4 z-10 bg-gray-800/90 backdrop-blur-sm p-4 rounded-lg border border-gray-700 max-w-xs">
        <h2 className="text-lg font-semibold mb-4">Controls</h2>

        {/* Dice Shape Selector */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Dice Shape</label>
          <select
            value={selectedShape}
            onChange={(e) => setSelectedShape(e.target.value as DiceShape)}
            className="w-full px-3 py-2 bg-gray-700 rounded text-sm"
          >
            <option value="d4">D4 (Tetrahedron)</option>
            <option value="d6">D6 (Cube)</option>
            <option value="d8">D8 (Octahedron)</option>
            <option value="d10">D10 (Pentagonal Trapezohedron)</option>
            <option value="d12">D12 (Dodecahedron)</option>
            <option value="d20">D20 (Icosahedron)</option>
          </select>
        </div>

        {/* Renderer Type */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Renderer Type</label>
          <select
            value={rendererType}
            onChange={(e) => setRendererType(e.target.value as RendererType)}
            className="w-full px-3 py-2 bg-gray-700 rounded text-sm"
          >
            <option value="simple">Simple Number</option>
            <option value="styled">Styled Number</option>
            <option value="bordered">Bordered Number</option>
            <option value="debug">Debug Colors</option>
          </select>
        </div>

        {/* Color Picker */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Dice Color</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={diceColor}
              onChange={(e) => setDiceColor(e.target.value)}
              className="w-12 h-10 rounded cursor-pointer"
            />
            <input
              type="text"
              value={diceColor}
              onChange={(e) => setDiceColor(e.target.value)}
              className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
            />
          </div>
        </div>

        {/* Rotation Controls */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Rotation Presets</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setRotation([0, 0, 0])}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            >
              Reset
            </button>
            <button
              onClick={() => setRotation([0, Math.PI / 4, 0])}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            >
              45° Y
            </button>
            <button
              onClick={() => setRotation([Math.PI / 4, 0, 0])}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            >
              45° X
            </button>
            <button
              onClick={() => setRotation([0, 0, Math.PI / 4])}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            >
              45° Z
            </button>
          </div>
        </div>

        {/* Face Value Display */}
        <div className="mb-4 p-3 bg-gray-900 rounded border-2 border-green-500">
          <h3 className="text-sm font-medium mb-2">Face Detection</h3>
          <p className="text-xs text-gray-400 mb-2">
            Rotate to test face detection accuracy
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Detected Value:</span>
            <div className="text-3xl font-bold text-green-400">
              {detectedValue}
            </div>
          </div>
        </div>

        {/* Save to Inventory */}
        <div className="mt-4">
          <button
            onClick={handleSaveToInventory}
            disabled={saveStatus === 'saving'}
            className={`w-full px-4 py-3 rounded-lg font-semibold transition-all ${saveStatus === 'success'
              ? 'bg-green-600 text-white'
              : saveStatus === 'error'
                ? 'bg-red-600 text-white'
                : saveStatus === 'saving'
                  ? 'bg-gray-600 text-gray-300 cursor-wait'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
          >
            {saveStatus === 'saving' && '⏳ Saving...'}
            {saveStatus === 'success' && '✅ Saved to Inventory!'}
            {saveStatus === 'error' && '❌ Failed to Save'}
            {saveStatus === 'idle' && '💾 Save to Inventory'}
          </button>
        </div>

        {/* Download GLTF */}
        <div className="mt-3">
          <button
            onClick={handleDownloadGLTF}
            disabled={downloadStatus === 'downloading'}
            className={`w-full px-4 py-3 rounded-lg font-semibold transition-all ${downloadStatus === 'success'
              ? 'bg-green-600 text-white'
              : downloadStatus === 'error'
                ? 'bg-red-600 text-white'
                : downloadStatus === 'downloading'
                  ? 'bg-gray-600 text-gray-300 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
          >
            {downloadStatus === 'downloading' && '⏳ Exporting...'}
            {downloadStatus === 'success' && '✅ Downloaded!'}
            {downloadStatus === 'error' && '❌ Export Failed'}
            {downloadStatus === 'idle' && '⬇️ Download GLTF'}
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Download for use in Blender, Unity, or other 3D software
          </p>
        </div>

        {/* Info */}
        <div className="mt-4 p-3 bg-blue-900/30 rounded border border-blue-700">
          <p className="text-xs text-blue-200">
            💡 <strong>Tip:</strong> Use mouse to orbit and inspect all faces. Verify the top face matches the detected value!
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-24 right-4 z-10 bg-gray-800/90 backdrop-blur-sm p-4 rounded-lg border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">Face Mapping</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span>Face 1 (Bottom)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span>Face 2 (Front)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span>Face 3 (Right)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500 rounded"></div>
            <span>Face 4 (Left)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-500 rounded"></div>
            <span>Face 5 (Back)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-cyan-500 rounded"></div>
            <span>Face 6 (Top)</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-700">
          <p className="text-xs text-gray-400">
            <strong>Standard Dice Rule:</strong><br />
            Opposite faces sum to 7<br />
            (1+6, 2+5, 3+4)
          </p>
        </div>
      </div>

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [5, 5, 5], fov: 50 }}
        shadows
      >
        <color attach="background" args={['#1a1a2e']} />

        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <pointLight position={[-10, 10, -10]} intensity={0.5} />

        {/* Physics World (disabled for static preview) */}
        <Physics paused>
          {/* Dice Preview */}
          <PreviewDice
            shape={selectedShape}
            rotation={rotation}
            rendererType={rendererType}
            color={diceColor}
            meshRef={previewMeshRef}
          />
        </Physics>

        {/* Camera Controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={3}
          maxDistance={20}
        />

        {/* Grid Helper */}
        <gridHelper args={[10, 10, '#444', '#222']} />
      </Canvas>

      {/* Back to Main App Link */}
      <div className="absolute bottom-4 left-4 z-10">
        <a
          href="/"
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium inline-flex items-center gap-2"
        >
          ← Back to Main App
        </a>
      </div>
    </div>
  )
}

/**
 * Preview Dice Component
 * Static dice with custom materials showing face mapping
 */
function PreviewDice({
  shape,
  rotation,
  rendererType,
  color,
  meshRef,
}: {
  shape: DiceShape
  rotation: [number, number, number]
  rendererType: RendererType
  color: string
  meshRef: React.MutableRefObject<THREE.Mesh | null>
}) {
  // Select face renderer based on type and shape
  const faceRenderer: FaceRenderer | undefined = useMemo(() => {
    if (rendererType === 'debug') {
      return undefined // Will use debug materials
    }

    // Use shape-specific renderers for triangular faces
    if (shape === 'd20' || shape === 'd8' || shape === 'd4') {
      switch (rendererType) {
        case 'simple':
          return renderD20Simple
        case 'styled':
          return renderD20Styled
        case 'bordered':
          return renderD20Bordered
      }
    }

    // Use generic renderers for other shapes (D6, D10, D12)
    switch (rendererType) {
      case 'simple':
        return renderSimpleNumber
      case 'styled':
        return renderStyledNumber
      case 'bordered':
        return renderBorderedNumber
    }
  }, [rendererType, shape])

  // Store triangle→face mapping for material creation
  // This is extracted from geometry analysis and ensures correct face numbering
  const triangleToFaceMapping = useRef<number[]>([])

  // Create geometry based on selected shape
  const geometry = useMemo(() => {
    const geo = getPreviewGeometry(shape, 1)

    // Log geometry analysis for debugging material mappings
    const analysis = analyzeGeometry(geo)
    console.log(`[PreviewDice] ${shape} geometry:`, analysis)

    // Ensure geometry has proper attributes
    if (!geo.attributes.position) {
      console.error(`[PreviewDice] Geometry missing position attribute!`)
    }

    // For non-indexed geometries, we need to compute normals
    if (!geo.index && !geo.attributes.normal) {
      console.log(`[PreviewDice] Computing normals for non-indexed geometry`)
      geo.computeVertexNormals()
    }

    // Compute bounding sphere for proper rendering
    geo.computeBoundingSphere()

    // **AUTOMATIC MATERIAL MAPPING GENERATION**
    // Extract actual triangle normals from geometry for perfect 1:1 mapping
    console.log(`\n[geometryFaceMapper] ==================== ${shape.toUpperCase()} ANALYSIS ====================`)

    const geometryFaceNormals = extractGeometryFaceNormals(geo, shape)
    console.log(`[geometryFaceMapper] Extracted ${geometryFaceNormals.length} face normals from geometry`)

    // Log the extracted normals in a format ready to copy to geometries.ts
    console.log(`\n[geometryFaceMapper] Copy this to geometries.ts for ${shape.toUpperCase()}_FACE_NORMALS:`)
    console.log(`export const ${shape.toUpperCase()}_FACE_NORMALS: DiceFace[] = [`)
    geometryFaceNormals.forEach(face => {
      const n = face.normal
      console.log(`  { value: ${face.value}, normal: new THREE.Vector3(${n.x.toFixed(4)}, ${n.y.toFixed(4)}, ${n.z.toFixed(4)}) },`)
    })
    console.log(`]\n`)

    // This creates a 1:1 mapping where each triangle maps to itself
    const mapping = geometryFaceNormals.map(face => face.value)

    // **STORE MAPPING FOR MATERIAL CREATION**
    // This is the critical fix: we'll use this mapping in the materials loop
    triangleToFaceMapping.current = mapping

    // Log the triangle→face mapping
    logMapping(mapping, shape)

    // Debug: Count occurrences of each face value
    const faceCounts = new Map<number, number>()
    mapping.forEach(faceValue => {
      faceCounts.set(faceValue, (faceCounts.get(faceValue) || 0) + 1)
    })
    console.log(`[geometryFaceMapper] Face value occurrences:`)
    Array.from(faceCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([faceValue, count]) => {
        console.log(`  Face ${faceValue}: ${count} triangle(s)`)
      })

    // Invert to get FACE_MATERIAL_MAPS format (face value → material index)
    const maxFaceValue = parseInt(shape.substring(1)) // d20 → 20
    const faceMaterialMap = invertMapping(mapping, maxFaceValue)

    console.log(`\n[geometryFaceMapper] FACE_MATERIAL_MAPS for ${shape}:`)
    console.log(`  ${shape}: [`)
    console.log(`    -1, // Placeholder (no face value 0)`)
    for (let faceValue = 1; faceValue <= maxFaceValue; faceValue++) {
      const materialIndex = faceMaterialMap[faceValue]
      if (materialIndex !== undefined && materialIndex !== -1) {
        console.log(`    ${materialIndex}, // Face ${faceValue} → materials[${materialIndex}]`)
      } else {
        console.log(`    -1, // Face ${faceValue} → NOT FOUND (check face normals)`)
      }
    }
    console.log(`  ],`)
    console.log(`[geometryFaceMapper] ========================================\n`)

    // **CRITICAL DEBUG: Verify groups exist**
    console.log(`[PreviewDice] Final geometry groups:`, geo.groups)
    console.log(`[PreviewDice] Groups count: ${geo.groups.length}`)
    if (geo.groups.length > 0) {
      console.log(`[PreviewDice] First 3 groups:`, geo.groups.slice(0, 3))
    } else {
      console.error(`[PreviewDice] ❌ NO GROUPS FOUND! Materials won't be applied correctly!`)
    }

    return geo
  }, [shape])

  // Create materials array using simple 1:1 mapping
  const materials = useMemo(() => {
    console.log(`[PreviewDice] Creating materials with renderer:`, rendererType, 'color:', color)
    if (rendererType === 'debug') {
      // Debug mode: create colored materials
      const debugColors = [
        '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
        '#FF8800', '#88FF00', '#0088FF', '#FF0088', '#8800FF', '#00FF88',
        '#FF8888', '#88FF88', '#8888FF', '#FFFF88', '#FF88FF', '#88FFFF',
        '#888888', '#FFFFFF'
      ]

      const triangleCount = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3
      return Array.from({ length: triangleCount }, (_, i) =>
        new THREE.MeshStandardMaterial({
          color: debugColors[i % debugColors.length],
          roughness: 0.7,
          metalness: 0.1,
          flatShading: shape !== 'd6'
        })
      )
    }

    // Production mode: create materials with face textures
    // Use the extracted triangle→face mapping for correct face numbering
    const triangleCount = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3
    const materialsArray: THREE.Material[] = []

    // Get the mapping extracted from geometry analysis
    const mapping = triangleToFaceMapping.current

    if (mapping.length === 0) {
      console.error(`[PreviewDice] ❌ No triangle→face mapping available! Materials may be incorrect.`)
    }

    console.log(`[PreviewDice] Creating materials using mapping:`, mapping.slice(0, 5), '...')

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      // ✅ CORRECT: Use the extracted mapping to get the correct face value for this triangle
      const faceValue = mapping[triangleIndex] || (shape === 'd10' ? triangleIndex : triangleIndex + 1)

      // Use the utility function to render texture
      const texture = faceRenderer
        ? renderDiceFaceToTexture(faceValue, color, faceRenderer, 512)
        : null

      // Create material
      const material = new THREE.MeshStandardMaterial({
        ...(texture ? { map: texture } : { color }),
        roughness: 0.7,
        metalness: 0.1,
        flatShading: shape !== 'd6'
      })

      materialsArray.push(material)
    }

    console.log(`[PreviewDice] ✅ Created ${materialsArray.length} materials for ${shape} using extracted mapping`)
    return materialsArray
  }, [shape, geometry, rendererType, color, faceRenderer])

  // **CRITICAL DEBUG: Verify materials match groups**
  console.log(`[PreviewDice] Rendering ${shape}:`, {
    geometryType: geometry.type,
    groupsCount: geometry.groups.length,
    materialsCount: Array.isArray(materials) ? materials.length : 1,
    match: geometry.groups.length === (Array.isArray(materials) ? materials.length : 1),
    position: [0, 0, 0],
    rotation
  })

  if (geometry.groups.length !== materials.length) {
    console.error(`[PreviewDice] ❌ MISMATCH! Groups: ${geometry.groups.length}, Materials: ${materials.length}`)
  }

  return (
    <mesh
      ref={meshRef}
      position={[0, 0, 0]}
      rotation={rotation}
      geometry={geometry}
      material={materials}
      castShadow
      receiveShadow
    />
  )
}
