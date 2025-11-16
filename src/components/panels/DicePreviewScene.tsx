/**
 * Dice Preview Scene
 *
 * A complete testing environment for previewing custom dice models.
 * Provides physics simulation, interactive controls, and face value display.
 */

import { useRef, useState, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { CustomDice } from '../dice/CustomDice'
import { CustomDiceAsset } from '../../types/customDice'
import { DiceHandle } from '../dice/Dice'

interface DicePreviewSceneProps {
  /** Custom dice asset to preview */
  asset: CustomDiceAsset

  /** Callback when preview is closed */
  onClose?: () => void
}

/**
 * Dice preview scene with full physics simulation
 */
export function DicePreviewScene({ asset, onClose }: DicePreviewSceneProps) {
  const diceRef = useRef<DiceHandle>(null)
  const [faceValue, setFaceValue] = useState<number | null>(null)
  const [rollCount, setRollCount] = useState(0)

  // Handle dice rest
  const handleDiceRest = (_id: string, value: number) => {
    setFaceValue(value)
  }

  // Roll the dice
  const handleRoll = () => {
    if (!diceRef.current) return

    // Generate random impulse
    const impulse = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 6 + 3,
      (Math.random() - 0.5) * 4
    )

    diceRef.current.applyImpulse(impulse)
    setFaceValue(null)
    setRollCount((prev) => prev + 1)
  }

  // Reset dice to initial position
  const handleReset = () => {
    if (!diceRef.current) return
    diceRef.current.reset()
    setFaceValue(null)
  }

  return (
    <div className="dice-preview-scene fixed inset-0 z-50 bg-black/90">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gray-900/95 p-4 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-white">
            Preview: {asset.metadata.name}
          </h2>
          <p className="text-sm text-gray-400">
            {asset.metadata.diceType.toUpperCase()} by {asset.metadata.artist}
          </p>
        </div>

        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-2xl px-4"
          aria-label="Close preview"
        >
          ✕
        </button>
      </div>

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [5, 5, 5], fov: 50 }}
        gl={{ alpha: false }}
        shadows
      >
        <Suspense fallback={null}>
          <color attach="background" args={['#1a1a1a']} />

          {/* Lighting */}
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[5, 10, 5]}
            intensity={0.8}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />

          {/* Environment */}
          <Environment preset="city" />

          {/* Physics World */}
          <Physics gravity={[0, -9.81, 0]}>
            {/* Table/Floor */}
            <RigidBody type="fixed" position={[0, -0.5, 0]}>
              <mesh
                receiveShadow
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <planeGeometry args={[20, 20]} />
                <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
              </mesh>
              <CuboidCollider args={[10, 0.1, 10]} />
            </RigidBody>

            {/* Walls (invisible boundaries with physics) */}
            {/* Front wall */}
            <RigidBody type="fixed" position={[0, 2, -5]}>
              <CuboidCollider args={[10, 5, 0.05]} />
            </RigidBody>
            {/* Back wall */}
            <RigidBody type="fixed" position={[0, 2, 5]}>
              <CuboidCollider args={[10, 5, 0.05]} />
            </RigidBody>
            {/* Left wall */}
            <RigidBody type="fixed" position={[-5, 2, 0]}>
              <CuboidCollider args={[0.05, 5, 10]} />
            </RigidBody>
            {/* Right wall */}
            <RigidBody type="fixed" position={[5, 2, 0]}>
              <CuboidCollider args={[0.05, 5, 10]} />
            </RigidBody>

            {/* Custom Dice */}
            <CustomDice
              ref={diceRef}
              asset={asset}
              id="preview-dice"
              position={[0, 3, 0]}
              onRest={handleDiceRest}
            />
          </Physics>

          {/* Camera Controls */}
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            minDistance={3}
            maxDistance={15}
            maxPolarAngle={Math.PI / 2 - 0.1}
          />
        </Suspense>
      </Canvas>

      {/* Controls Panel */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gray-900/95 p-4">
        <div className="max-w-4xl mx-auto">
          {/* Face Value Display */}
          <div className="mb-4 text-center">
            {faceValue !== null ? (
              <div>
                <p className="text-gray-400 text-sm mb-1">Face Value:</p>
                <p className="text-6xl font-bold text-white">{faceValue}</p>
              </div>
            ) : (
              <div>
                <p className="text-gray-400 text-sm mb-1">Status:</p>
                <p className="text-2xl font-medium text-blue-400">Rolling...</p>
              </div>
            )}
          </div>

          {/* Control Buttons */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleRoll}
              className="bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-lg font-bold text-white transition-colors"
            >
              🎲 Roll Dice
            </button>

            <button
              onClick={handleReset}
              className="bg-gray-700 hover:bg-gray-600 px-8 py-3 rounded-lg font-medium text-white transition-colors"
            >
              Reset Position
            </button>
          </div>

          {/* Stats */}
          <div className="mt-4 flex justify-center gap-6 text-sm text-gray-400">
            <div>
              <span className="font-medium">Rolls:</span> {rollCount}
            </div>
            <div>
              <span className="font-medium">Type:</span> {asset.metadata.diceType.toUpperCase()}
            </div>
            <div>
              <span className="font-medium">Friction:</span> {asset.metadata.physics.friction}
            </div>
            <div>
              <span className="font-medium">Restitution:</span> {asset.metadata.physics.restitution}
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-4 text-center text-xs text-gray-500">
            <p>Click and drag to rotate view • Scroll to zoom • Click "Roll Dice" to test physics</p>
          </div>
        </div>
      </div>
    </div>
  )
}
