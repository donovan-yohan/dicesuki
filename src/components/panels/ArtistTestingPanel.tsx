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
import { DiceShape } from '../../lib/geometries'
import {
  CustomDiceAsset,
  UploadState,
} from '../../types/customDice'
import {
  validateGLBFile,
  parseMetadataJSON,
  formatValidationResults,
} from '../../lib/diceMetadataSchema'
import {
  generateDefaultMetadata,
  downloadMetadata,
} from '../../lib/diceMetadataGenerator'
import { DicePreviewScene } from './DicePreviewScene'

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
  const [previewAsset, setPreviewAsset] = useState<CustomDiceAsset | null>(null)
  const blobUrlRef = useRef<string | null>(null)

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

    // Validate the GLB file
    const validation = await validateGLBFile(file)

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
      customArtist || undefined
    )

    setUploadState((prev) => ({
      ...prev,
      metadata,
      metadataValidation: { isValid: true, errors: [], warnings: [] },
      step: 'ready',
    }))
  }, [selectedDiceType, customName, customArtist])

  /**
   * Download auto-generated metadata as JSON file
   */
  const handleDownloadMetadata = useCallback(() => {
    if (uploadState.metadata) {
      downloadMetadata(uploadState.metadata)
    }
  }, [uploadState.metadata])

  /**
   * Load preview with validated file and metadata
   */
  const handleLoadPreview = useCallback(() => {
    if (!uploadState.file || !uploadState.metadata) {
      return
    }

    // Revoke previous blob URL if it exists
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
    }

    // Create blob URL for the uploaded GLB file
    const blobUrl = URL.createObjectURL(uploadState.file)
    blobUrlRef.current = blobUrl

    // Create custom dice asset
    const asset: CustomDiceAsset = {
      id: `preview-${Date.now()}`,
      metadata: uploadState.metadata,
      modelUrl: blobUrl,
      previewBlobUrl: blobUrl,
    }

    // Set preview asset to show the preview scene
    setPreviewAsset(asset)

    // Notify parent component
    onDiceLoaded?.(asset)
  }, [uploadState.file, uploadState.metadata, onDiceLoaded])

  /**
   * Close preview and cleanup blob URL
   */
  const handleClosePreview = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setPreviewAsset(null)
  }, [])

  /**
   * Reset the upload state
   */
  const handleReset = useCallback(() => {
    // Revoke blob URL if it exists
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }

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
                Maximum file size: 10 MB (5 MB recommended)
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

      {/* Step 3: Metadata */}
      <section className="mb-6">
        <h3 className="text-lg font-semibold mb-3">3. Provide Metadata</h3>

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

      {/* Step 4: Preview */}
      <section>
        <div className="flex gap-3">
          <button
            onClick={handleLoadPreview}
            disabled={!canPreview}
            className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-bold text-lg transition-colors"
          >
            {canPreview ? '🎲 Load Preview' : 'Complete steps above to preview'}
          </button>

          <button
            onClick={handleReset}
            className="bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Reset
          </button>
        </div>
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

      {/* Preview Scene (fullscreen overlay) */}
      {previewAsset && (
        <DicePreviewScene
          asset={previewAsset}
          onClose={handleClosePreview}
        />
      )}
    </div>
  )
}
