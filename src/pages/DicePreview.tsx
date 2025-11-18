import { useState, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import * as THREE from 'three'
import { DiceShape, getDiceFaceValue, createD6Geometry } from '../lib/geometries'
import { useDiceMaterials } from '../hooks/useDiceMaterials'
import {
  renderSimpleNumber,
  renderStyledNumber,
  renderBorderedNumber,
  FaceRenderer,
} from '../lib/textureRendering'

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
  const [selectedShape] = useState<DiceShape>('d6')
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0])
  const [rendererType, setRendererType] = useState<RendererType>('simple')
  const [diceColor, setDiceColor] = useState('#ff6b35')

  // Calculate detected face value based on rotation
  const detectedValue = useMemo(() => {
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2])
    )
    return getDiceFaceValue(quaternion, selectedShape)
  }, [rotation, selectedShape])

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
}: {
  shape: DiceShape
  rotation: [number, number, number]
  rendererType: RendererType
  color: string
}) {
  // Select face renderer based on type
  const faceRenderer: FaceRenderer | undefined = useMemo(() => {
    switch (rendererType) {
      case 'simple':
        return renderSimpleNumber
      case 'styled':
        return renderStyledNumber
      case 'bordered':
        return renderBorderedNumber
      case 'debug':
        return undefined // Will use debug materials
    }
  }, [rendererType])

  // Create materials using the hook
  const materials = useDiceMaterials({
    shape,
    color,
    faceRenderer,
    debugMode: rendererType === 'debug',
    roughness: 0.7,
    metalness: 0.1,
  })

  // Create geometry (only D6 supported for now)
  const geometry = useMemo(() => {
    return createD6Geometry(2)
  }, [])

  return (
    <mesh
      position={[0, 2, 0]}
      rotation={rotation}
      geometry={geometry}
      material={materials}
      castShadow
      receiveShadow
    />
  )
}
