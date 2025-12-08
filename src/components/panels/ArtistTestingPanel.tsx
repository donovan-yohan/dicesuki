/**
 * Artist Testing Panel
 *
 * This component provides the UI for artists to upload, test, and preview
 * custom dice models before they are added to production.
 *
 * Features:
 * - Drag & drop GLB file upload
 * - Optional metadata JSON upload
 * - Auto-generate metadata from dice type
 * - Real-time validation
 * - Interactive preview with full physics
 *
 * @example
 * <ArtistTestingPanel onDiceLoaded={(asset) => console.log('Loaded:', asset)} />
 */

import { useState, useCallback, useRef } from 'react'
import { useInventoryStore } from '../../store/useInventoryStore'
import { saveCustomDiceModel } from '../../lib/customDiceDB'
import { DiceShape } from '../../lib/geometries'
import {
  CustomDiceAsset,
  FaceNormal,
  UploadState,
} from '../../types/customDice'
import {
  validateGLBFile,
  parseMetadataJSON,
  formatValidationResults,
  analyzeGLBScale,
  ScaleAnalysisResult,
} from '../../lib/diceMetadataSchema'
import {
  generateDefaultMetadata,
  downloadMetadata,
} from '../../lib/diceMetadataGenerator'
import { FaceNormalMapper } from './FaceNormalMapper'

interface ArtistTestingPanelProps {
  /** Callback when a dice asset is successfully loaded and ready for preview */
  onDiceLoaded?: (asset: CustomDiceAsset) => void

  /** Callback when panel is closed */
  onClose?: () => void
}

export function ArtistTestingPanel({ onDiceLoaded, onClose }: ArtistTestingPanelProps) {
  const [uploadState, setUploadState] = useState<UploadState>({
    file: null,
    metadata: null,
    fileValidation: null,
    metadataValidation: null,
    isLoading: false,
    step: 'idle',
  })

  const [selectedDiceType, setSelectedDiceType] = useState<DiceShape>('d6')
  const [customName, setCustomName] = useState('')
  const [customArtist, setCustomArtist] = useState('')
  const [addedToInventory, setAddedToInventory] = useState(false)
  const [scaleAnalysis, setScaleAnalysis] = useState<ScaleAnalysisResult | null>(null)
  const [userScale, setUserScale] = useState<number>(1.0)
  const [userDensity, setUserDensity] = useState<number>(0.3) // Default density (matches standard dice)
  const [customFaceNormals, setCustomFaceNormals] = useState<FaceNormal[]>([])
  const [showFaceMapper, setShowFaceMapper] = useState(false)
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null)

  const addDie = useInventoryStore(state => state.addDie)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const metadataInputRef = useRef<HTMLInputElement>(null)

  /**
   * Handle GLB file selection
   */
  const handleFileSelect = useCallback(async (file: File) => {
    setUploadState((prev) => ({
      ...prev,
      isLoading: true,
      step: 'uploading',
    }))

    // Reset scale state and face normals
    setScaleAnalysis(null)
    setUserScale(1.0)
    setCustomFaceNormals([])
    setShowFaceMapper(false)

    // Validate the GLB file
    const validation = await validateGLBFile(file)

    if (validation.isValid) {
      // Create blob URL for preview
      const blobUrl = URL.createObjectURL(file)
      setPreviewBlobUrl(blobUrl)

      // Analyze scale after successful validation
      const scaleResult = await analyzeGLBScale(file)
      setScaleAnalysis(scaleResult)
      if (scaleResult.success) {
        setUserScale(scaleResult.recommendedScale)
      }
    } else {
      setPreviewBlobUrl(null)
    }

    setUploadState((prev) => ({
      ...prev,
      file: validation.isValid ? file : null,
      fileValidation: validation,
      isLoading: false,
      step: validation.isValid ? 'validating' : 'error',
    }))
  }, [])

  /**
   * Handle metadata JSON file selection
   */
  const handleMetadataSelect = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const { metadata, validation } = parseMetadataJSON(text)

      setUploadState((prev) => ({
        ...prev,
        metadata: metadata,
        metadataValidation: validation,
        step: validation.isValid ? 'ready' : 'error',
      }))
    } catch (error) {
      setUploadState((prev) => ({
        ...prev,
        metadata: null,
        metadataValidation: {
          isValid: false,
          errors: [`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`],
          warnings: [],
        },
        step: 'error',
      }))
    }
  }, [])

  /**
   * Auto-generate metadata from dice type and custom fields
   */
  const handleAutoGenerateMetadata = useCallback(() => {
    const metadata = generateDefaultMetadata(
      selectedDiceType,
      customName || undefined,
      customArtist || undefined,
      userScale,
      userDensity
    )

    // Override face normals if custom mappings were created
    if (customFaceNormals.length > 0) {
      metadata.faceNormals = [...customFaceNormals]
    }

    setUploadState((prev) => ({
      ...prev,
      metadata,
      metadataValidation: { isValid: true, errors: [], warnings: [] },
      step: 'ready',
    }))
  }, [selectedDiceType, customName, customArtist, userScale, userDensity, customFaceNormals])

  /**
   * Download auto-generated metadata as JSON file
   */
  const handleDownloadMetadata = useCallback(() => {
    if (uploadState.metadata) {
      downloadMetadata(uploadState.metadata)
    }
  }, [uploadState.metadata])

  /**
   * Add dice to inventory with validated file and metadata
   */
  const handleAddToInventory = useCallback(async () => {
    if (!uploadState.file || !uploadState.metadata) {
      return
    }

    // Create blob URL for the uploaded GLB file
    // Note: We don't revoke previous blob URLs here because they're stored in
    // inventory dice and revoking them would break previously uploaded dice.
    // Blob URLs will be regenerated from IndexedDB on page reload anyway.
    const blobUrl = URL.createObjectURL(uploadState.file)

    // Create custom dice asset
    const asset: CustomDiceAsset = {
      id: `custom-${Date.now()}`,
      metadata: uploadState.metadata,
      modelUrl: blobUrl,
      previewBlobUrl: blobUrl,
    }

    // Extract appearance from metadata (simplified - uses base colors)
    const appearance = {
      baseColor: '#8b5cf6', // Purple for custom dice
      accentColor: '#ffffff',
      material: 'plastic' as const,
      roughness: 0.7,
      metalness: 0.0,
    }

    // Add to inventory as dev/test custom dice
    const newDie = addDie({
      type: uploadState.metadata.diceType,
      setId: 'custom-artist',
      rarity: 'rare',
      appearance,
      vfx: {},
      name: uploadState.metadata.name,
      description: `Created by ${uploadState.metadata.artist}`,
      isFavorite: false,
      isLocked: false,
      isDev: true, // Mark as dev/test dice
      devNotes: `Test upload from artist panel - ${new Date().toLocaleString()}`,
      source: 'event', // Artist submissions are special events
      customAsset: {
        modelUrl: blobUrl,
        metadata: uploadState.metadata,
      },
    })

    console.log('[ArtistTestingPanel] Added custom die to inventory:', newDie.id)

    // Save GLB file to IndexedDB for persistence across page reloads
    try {
      console.log('[ArtistTestingPanel] Saving GLB file to IndexedDB...', {
        diceId: newDie.id,
        fileSize: uploadState.file.size,
        fileType: uploadState.file.type
      })
      await saveCustomDiceModel(newDie.id, uploadState.file)
      console.log('[ArtistTestingPanel] ✓ Successfully saved GLB file to IndexedDB for die:', newDie.id)
    } catch (error) {
      console.error('[ArtistTestingPanel] ✗ Failed to save GLB file to IndexedDB:', error)
      alert('Warning: Custom die added to inventory but file could not be saved for persistence. It will not survive page reloads.')
    }

    // Show success feedback
    setAddedToInventory(true)

    // Notify parent component
    onDiceLoaded?.(asset)
  }, [uploadState.file, uploadState.metadata, onDiceLoaded, addDie])

  /**
   * Reset the upload state
   */
  const handleReset = useCallback(() => {
    // Note: We don't revoke blob URLs here because they're stored in inventory
    // and will be used to spawn dice. They'll be regenerated from IndexedDB on reload.

    setUploadState({
      file: null,
      metadata: null,
      fileValidation: null,
      metadataValidation: null,
      isLoading: false,
      step: 'idle',
    })

    setCustomName('')
    setCustomArtist('')
    setAddedToInventory(false)
    setScaleAnalysis(null)
    setUserScale(1.0)
    setUserDensity(0.3)
    setCustomFaceNormals([])
    setShowFaceMapper(false)
    setPreviewBlobUrl(null)
  }, [])

  // Check if ready to preview
  const canPreview =
    uploadState.file &&
    uploadState.metadata &&
    uploadState.fileValidation?.isValid &&
    uploadState.metadataValidation?.isValid

  return (
    <div className="artist-testing-panel bg-gray-900/95 text-white p-6 rounded-lg max-w-2xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Artist Testing Platform</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close panel"
          >
            ✕
          </button>
        )}
      </div>

      {/* Step 1: Upload GLB File */}
      <section className="mb-6">
        <h3 className="text-lg font-semibold mb-3">1. Upload Dice Model (.glb)</h3>

        <div
          className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center hover:border-gray-400 transition-colors"
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const file = e.dataTransfer.files[0]
            if (file && file.name.toLowerCase().endsWith('.glb')) {
              handleFileSelect(file)
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileSelect(file)
            }}
            className="hidden"
          />

          {!uploadState.file ? (
            <div>
              <p className="text-gray-400 mb-4">Drag & drop your .glb file here, or</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-md font-medium"
              >
                Choose File
              </button>
              <p className="text-sm text-gray-500 mt-4">
                Maximum file size: 20 MB (10 MB recommended)
              </p>
            </div>
          ) : (
            <div className="text-left">
              <p className="font-medium mb-2">✓ File uploaded</p>
              <p className="text-sm text-gray-400">{uploadState.file.name}</p>
              <p className="text-sm text-gray-400">
                Size: {(uploadState.file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <button
                onClick={() => {
                  setUploadState((prev) => ({
                    ...prev,
                    file: null,
                    fileValidation: null,
                  }))
                }}
                className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
              >
                Remove file
              </button>
            </div>
          )}
        </div>

        {/* File validation results */}
        {uploadState.fileValidation && (
          <div className="mt-3 p-3 bg-gray-800 rounded text-sm">
            <pre className="whitespace-pre-wrap font-mono text-xs">
              {formatValidationResults(uploadState.fileValidation)}
            </pre>
          </div>
        )}
      </section>

      {/* Step 2: Dice Type Selection */}
      <section className="mb-6">
        <h3 className="text-lg font-semibold mb-3">2. Select Dice Type</h3>

        <div className="grid grid-cols-6 gap-2">
          {(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as DiceShape[]).map((type) => (
            <button
              key={type}
              onClick={() => setSelectedDiceType(type)}
              className={`py-3 px-4 rounded font-bold transition-colors ${
                selectedDiceType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {type.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      {/* Step 3: Scale Adjustment */}
      {scaleAnalysis && uploadState.file && (
        <section className="mb-6">
          <h3 className="text-lg font-semibold mb-3">3. Adjust Scale</h3>

          <div className="bg-gray-800 rounded-lg p-4 space-y-4">
            {/* Scale analysis info */}
            <div className="text-sm text-gray-400 space-y-1">
              <p>
                Original size: {scaleAnalysis.originalSize[0].toFixed(2)} × {scaleAnalysis.originalSize[1].toFixed(2)} × {scaleAnalysis.originalSize[2].toFixed(2)} units
              </p>
              <p>
                Recommended scale: <span className="text-green-400 font-medium">{scaleAnalysis.recommendedScale.toFixed(3)}</span>
                {' '}(to fit 1 unit)
              </p>
            </div>

            {/* Scale slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="scale-slider" className="text-sm font-medium">
                  Scale Factor
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={userScale.toFixed(3)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      if (!isNaN(val) && val > 0 && val <= 10) {
                        setUserScale(val)
                      }
                    }}
                    step="0.01"
                    min="0.01"
                    max="10"
                    className="w-20 px-2 py-1 bg-gray-700 rounded border border-gray-600 text-sm text-right"
                  />
                  <button
                    onClick={() => setUserScale(scaleAnalysis.recommendedScale)}
                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                    title="Reset to recommended scale"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <input
                id="scale-slider"
                type="range"
                value={userScale}
                onChange={(e) => setUserScale(parseFloat(e.target.value))}
                min="0.01"
                max={Math.max(scaleAnalysis.recommendedScale * 3, 2)}
                step="0.01"
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />

              {/* Preview of final size */}
              <div className="text-sm text-gray-400">
                Final size: {' '}
                <span className="text-white font-medium">
                  {(scaleAnalysis.originalSize[0] * userScale).toFixed(2)} × {(scaleAnalysis.originalSize[1] * userScale).toFixed(2)} × {(scaleAnalysis.originalSize[2] * userScale).toFixed(2)}
                </span>
                {' '}units
              </div>

              {/* Size comparison hint */}
              {Math.abs(userScale - scaleAnalysis.recommendedScale) > 0.01 && (
                <p className="text-xs text-yellow-400">
                  ⚠ Custom scale differs from recommended ({scaleAnalysis.recommendedScale.toFixed(3)})
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Step 4: Physics Properties */}
      {uploadState.file && (
        <section className="mb-6">
          <h3 className="text-lg font-semibold mb-3">{scaleAnalysis ? '4' : '3'}. Physics Properties</h3>

          <div className="bg-gray-800 rounded-lg p-4 space-y-4">
            {/* Density slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="density-slider" className="text-sm font-medium">
                  Density
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={userDensity.toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      if (!isNaN(val) && val > 0 && val <= 5) {
                        setUserDensity(val)
                      }
                    }}
                    step="0.01"
                    min="0.01"
                    max="5"
                    className="w-20 px-2 py-1 bg-gray-700 rounded border border-gray-600 text-sm text-right"
                  />
                  <button
                    onClick={() => setUserDensity(0.3)}
                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                    title="Reset to default density"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <input
                id="density-slider"
                type="range"
                value={userDensity}
                onChange={(e) => setUserDensity(parseFloat(e.target.value))}
                min="0.01"
                max="1"
                step="0.01"
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />

              {/* Density behavior hints */}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Light (spins easily)</span>
                <span>Heavy (stable)</span>
              </div>

              {/* Density explanation */}
              <p className="text-xs text-gray-400">
                Lower density = more spin/tumble when dragging. Default: <span className="text-green-400">0.3</span> (matches standard dice)
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Step 5: Face Mapping (Optional) */}
      {uploadState.file && previewBlobUrl && (
        <section className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold">
              {scaleAnalysis ? '5' : '4'}. Face Number Mapping
              <span className="text-sm font-normal text-gray-400 ml-2">(Optional)</span>
            </h3>
            <button
              onClick={() => setShowFaceMapper(!showFaceMapper)}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {showFaceMapper ? 'Hide' : 'Customize Faces'}
            </button>
          </div>

          {!showFaceMapper ? (
            <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
              <p>
                By default, face normals use standard orientations for {selectedDiceType.toUpperCase()}.
                Click "Customize Faces" if your model has non-standard face positions.
              </p>
              {customFaceNormals.length > 0 && (
                <p className="mt-2 text-green-400">
                  ✓ {customFaceNormals.length} custom face mappings configured
                </p>
              )}
            </div>
          ) : (
            <FaceNormalMapper
              modelUrl={previewBlobUrl}
              diceType={selectedDiceType}
              scale={userScale}
              faceNormals={customFaceNormals}
              onFaceNormalsChange={setCustomFaceNormals}
            />
          )}
        </section>
      )}

      {/* Step 6: Metadata */}
      <section className="mb-6">
        <h3 className="text-lg font-semibold mb-3">{scaleAnalysis ? '6' : uploadState.file ? '5' : '3'}. Provide Metadata</h3>

        <div className="space-y-4">
          {/* Option A: Upload metadata JSON */}
          <div>
            <p className="text-sm text-gray-400 mb-2">Option A: Upload metadata.json file</p>
            <input
              ref={metadataInputRef}
              type="file"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleMetadataSelect(file)
              }}
              className="block w-full text-sm text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded file:border-0
                file:bg-gray-700 file:text-white
                hover:file:bg-gray-600"
            />
          </div>

          {/* Option B: Auto-generate */}
          <div>
            <p className="text-sm text-gray-400 mb-2">Option B: Auto-generate metadata</p>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Dice name (optional)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              />

              <input
                type="text"
                placeholder="Artist name (optional)"
                value={customArtist}
                onChange={(e) => setCustomArtist(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              />

              <button
                onClick={handleAutoGenerateMetadata}
                disabled={!uploadState.file}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded font-medium transition-colors"
              >
                Generate Metadata
              </button>
            </div>
          </div>
        </div>

        {/* Metadata validation results */}
        {uploadState.metadataValidation && (
          <div className="mt-3 p-3 bg-gray-800 rounded text-sm">
            <pre className="whitespace-pre-wrap font-mono text-xs">
              {formatValidationResults(uploadState.metadataValidation)}
            </pre>
          </div>
        )}

        {/* Download generated metadata */}
        {uploadState.metadata && uploadState.metadataValidation?.isValid && (
          <button
            onClick={handleDownloadMetadata}
            className="mt-3 text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Download generated metadata.json
          </button>
        )}
      </section>

      {/* Step 4: Add to Inventory */}
      <section>
        {addedToInventory ? (
          <div className="p-6 bg-green-900/30 border border-green-500 rounded-lg text-center">
            <p className="text-xl font-bold text-green-400 mb-2">✓ Added to Inventory!</p>
            <p className="text-sm text-gray-300 mb-4">
              Your custom dice has been added to your inventory.
              Check the Inventory panel to see it!
            </p>
            <button
              onClick={handleReset}
              className="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Add Another Die
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={handleAddToInventory}
              disabled={!canPreview}
              className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-bold text-lg transition-colors"
            >
              {canPreview ? '✨ Add to Inventory' : 'Complete steps above to add'}
            </button>

            <button
              onClick={handleReset}
              className="bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Reset
            </button>
          </div>
        )}
      </section>

      {/* Help Text */}
      <div className="mt-6 p-4 bg-gray-800/50 rounded text-sm text-gray-400">
        <p className="font-semibold text-white mb-2">Need help?</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>See the Blender Export Guide for detailed instructions</li>
          <li>Download example dice models and metadata templates</li>
          <li>Join our Discord for artist support</li>
        </ul>
      </div>
    </div>
  )
}
