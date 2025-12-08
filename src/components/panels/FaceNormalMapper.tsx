/**
 * Face Normal Mapper Component
 *
 * Provides a visual UI for artists to map face numbers to their custom dice model's
 * face orientations. Shows a 3D preview that can be rotated, with controls to assign
 * numbers to each visible face direction.
 */

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { Suspense, useState, useCallback, useRef, useMemo } from 'react'
import * as THREE from 'three'
import { ThreeEvent } from '@react-three/fiber'
import { FaceNormal, EXPECTED_FACE_COUNTS } from '../../types/customDice'
import { DiceShape } from '../../lib/geometries'

interface FaceNormalMapperProps {
  /** URL to the GLB model (blob URL from upload) */
  modelUrl: string
  /** Type of dice for face count */
  diceType: DiceShape
  /** Scale factor for the model */
  scale: number
  /** Current face normal mappings */
  faceNormals: FaceNormal[]
  /** Callback when mappings are updated */
  onFaceNormalsChange: (normals: FaceNormal[]) => void
}

/**
 * Direction presets for common face orientations
 */
const DIRECTION_PRESETS = [
  { name: 'Top', normal: [0, 1, 0] as [number, number, number], icon: '⬆️' },
  { name: 'Bottom', normal: [0, -1, 0] as [number, number, number], icon: '⬇️' },
  { name: 'Front', normal: [0, 0, 1] as [number, number, number], icon: '🔵' },
  { name: 'Back', normal: [0, 0, -1] as [number, number, number], icon: '🔴' },
  { name: 'Right', normal: [1, 0, 0] as [number, number, number], icon: '➡️' },
  { name: 'Left', normal: [-1, 0, 0] as [number, number, number], icon: '⬅️' },
]

/**
 * Preview model component that renders inside the Canvas
 */
function PreviewModel({
  modelUrl,
  scale,
  onFaceClick,
}: {
  modelUrl: string
  scale: number
  onFaceClick?: (normal: THREE.Vector3) => void
}) {
  const gltf = useGLTF(modelUrl)
  const modelRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  // Clone the scene to avoid mutations
  const clonedScene = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return cloned
  }, [gltf.scene])

  // Gentle rotation animation
  useFrame((state) => {
    if (modelRef.current && !hovered) {
      modelRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.2
    }
  })

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()

      // Get the face normal from the intersection
      if (event.face && onFaceClick) {
        const normal = event.face.normal.clone()

        // Transform normal to world space if model has rotation
        if (modelRef.current) {
          normal.applyQuaternion(modelRef.current.quaternion)
        }

        onFaceClick(normal.normalize())
      }
    },
    [onFaceClick]
  )

  return (
    <group ref={modelRef}>
      <primitive
        object={clonedScene}
        scale={scale}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      />
    </group>
  )
}

/**
 * Main Face Normal Mapper component
 */
export function FaceNormalMapper({
  modelUrl,
  diceType,
  scale,
  faceNormals,
  onFaceNormalsChange,
}: FaceNormalMapperProps) {
  const [selectedValue, setSelectedValue] = useState<number | null>(null)
  const [mappingMode, setMappingMode] = useState<'click' | 'preset'>('preset')
  const expectedFaceCount = EXPECTED_FACE_COUNTS[diceType]

  // Get all possible face values for this dice type
  const faceValues = useMemo(() => {
    if (diceType === 'd10') {
      return Array.from({ length: expectedFaceCount }, (_, i) => i) // 0-9
    }
    return Array.from({ length: expectedFaceCount }, (_, i) => i + 1) // 1-N
  }, [diceType, expectedFaceCount])

  // Get current mapping for a value
  const getMappingForValue = useCallback(
    (value: number) => {
      return faceNormals.find((fn) => fn.value === value)
    },
    [faceNormals]
  )

  // Format normal vector for display
  const formatNormal = (normal: [number, number, number]) => {
    return `(${normal[0].toFixed(2)}, ${normal[1].toFixed(2)}, ${normal[2].toFixed(2)})`
  }

  // Get direction name from normal
  const getDirectionName = (normal: [number, number, number]) => {
    const preset = DIRECTION_PRESETS.find(
      (p) =>
        Math.abs(p.normal[0] - normal[0]) < 0.1 &&
        Math.abs(p.normal[1] - normal[1]) < 0.1 &&
        Math.abs(p.normal[2] - normal[2]) < 0.1
    )
    return preset?.name || 'Custom'
  }

  // Handle assigning a normal to the selected face value
  const handleAssignNormal = useCallback(
    (normal: [number, number, number]) => {
      if (selectedValue === null) return

      const newNormals = faceNormals.filter((fn) => fn.value !== selectedValue)
      newNormals.push({ value: selectedValue, normal })

      // Sort by value
      newNormals.sort((a, b) => a.value - b.value)

      onFaceNormalsChange(newNormals)

      // Auto-advance to next unmapped value
      const nextUnmapped = faceValues.find(
        (v) => v !== selectedValue && !newNormals.find((fn) => fn.value === v)
      )
      if (nextUnmapped !== undefined) {
        setSelectedValue(nextUnmapped)
      } else {
        setSelectedValue(null)
      }
    },
    [selectedValue, faceNormals, faceValues, onFaceNormalsChange]
  )

  // Handle clicking on the 3D model
  const handleModelFaceClick = useCallback(
    (normal: THREE.Vector3) => {
      if (selectedValue === null || mappingMode !== 'click') return
      handleAssignNormal([normal.x, normal.y, normal.z])
    },
    [selectedValue, mappingMode, handleAssignNormal]
  )

  // Clear a specific mapping
  const handleClearMapping = useCallback(
    (value: number) => {
      const newNormals = faceNormals.filter((fn) => fn.value !== value)
      onFaceNormalsChange(newNormals)
    },
    [faceNormals, onFaceNormalsChange]
  )

  // Reset all mappings
  const handleResetAll = useCallback(() => {
    onFaceNormalsChange([])
    setSelectedValue(faceValues[0])
  }, [faceValues, onFaceNormalsChange])

  // Check if all faces are mapped
  const allMapped = faceNormals.length === expectedFaceCount

  return (
    <div className="face-normal-mapper bg-gray-800 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-md font-semibold text-white">Face Number Mapping</h4>
        <button
          onClick={handleResetAll}
          className="text-xs text-red-400 hover:text-red-300 underline"
        >
          Reset All
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 3D Preview */}
        <div className="bg-gray-900 rounded-lg overflow-hidden" style={{ height: '250px' }}>
          <Canvas camera={{ position: [2, 2, 2], fov: 45 }}>
            <Suspense fallback={null}>
              <ambientLight intensity={0.6} />
              <directionalLight position={[5, 5, 5]} intensity={0.8} />
              <PreviewModel
                modelUrl={modelUrl}
                scale={scale}
                onFaceClick={mappingMode === 'click' ? handleModelFaceClick : undefined}
              />
              <OrbitControls enablePan={false} enableZoom={true} />
              <Environment preset="studio" />
            </Suspense>
          </Canvas>

          {mappingMode === 'click' && selectedValue !== null && (
            <div className="absolute bottom-2 left-2 right-2 text-center text-xs text-yellow-400 bg-black/50 py-1 px-2 rounded">
              Click on the face that shows "{selectedValue}" on your model
            </div>
          )}
        </div>

        {/* Mapping Controls */}
        <div className="space-y-3">
          {/* Mode Toggle */}
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setMappingMode('preset')}
              className={`flex-1 py-1.5 px-2 rounded transition-colors ${
                mappingMode === 'preset'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Use Presets
            </button>
            <button
              onClick={() => setMappingMode('click')}
              className={`flex-1 py-1.5 px-2 rounded transition-colors ${
                mappingMode === 'click'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Click Model
            </button>
          </div>

          {/* Face Value Selector */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Select face value to map:
            </label>
            <div className="flex flex-wrap gap-1">
              {faceValues.map((value) => {
                const mapping = getMappingForValue(value)
                const isMapped = !!mapping
                const isSelected = selectedValue === value

                return (
                  <button
                    key={value}
                    onClick={() => setSelectedValue(isSelected ? null : value)}
                    className={`w-8 h-8 rounded font-bold text-sm transition-all ${
                      isSelected
                        ? 'bg-yellow-500 text-black ring-2 ring-yellow-300'
                        : isMapped
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title={
                      isMapped
                        ? `${value}: ${getDirectionName(mapping.normal)}`
                        : `${value}: Not mapped`
                    }
                  >
                    {value}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Preset Direction Buttons (when in preset mode) */}
          {mappingMode === 'preset' && selectedValue !== null && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Assign direction for "{selectedValue}":
              </label>
              <div className="grid grid-cols-3 gap-1">
                {DIRECTION_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleAssignNormal(preset.normal)}
                    className="py-2 px-2 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                  >
                    <span className="block text-lg">{preset.icon}</span>
                    <span className="text-gray-300">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current Mappings List */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Current mappings ({faceNormals.length}/{expectedFaceCount}):
            </label>
            <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
              {faceNormals.length === 0 ? (
                <p className="text-gray-500 italic">No mappings yet</p>
              ) : (
                faceNormals.map((fn) => (
                  <div
                    key={fn.value}
                    className="flex items-center justify-between bg-gray-700 px-2 py-1 rounded"
                  >
                    <span className="font-bold text-white">{fn.value}</span>
                    <span className="text-gray-400">
                      {getDirectionName(fn.normal)} {formatNormal(fn.normal)}
                    </span>
                    <button
                      onClick={() => handleClearMapping(fn.value)}
                      className="text-red-400 hover:text-red-300 ml-2"
                      title="Remove mapping"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Status */}
          {allMapped && (
            <div className="text-center py-2 bg-green-900/30 border border-green-500 rounded text-green-400 text-sm">
              ✓ All faces mapped!
            </div>
          )}
        </div>
      </div>

      {/* Help Text */}
      <div className="mt-3 text-xs text-gray-500">
        <p>
          <strong>Tip:</strong> Use "Presets" for standard orientations, or "Click Model" to click
          directly on faces. Rotate the 3D preview to see all sides.
        </p>
      </div>
    </div>
  )
}
