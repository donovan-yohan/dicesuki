import * as THREE from 'three'

/**
 * Texture Rendering Utilities
 *
 * Provides functions for rendering dice face textures using HTML5 Canvas.
 * Supports custom rendering functions for maximum flexibility.
 *
 * ## Usage Patterns
 *
 * 1. **Simple Number Rendering**:
 *    ```typescript
 *    const texture = renderDiceFaceToTexture(6, '#ff6b35', renderSimpleNumber);
 *    ```
 *
 * 2. **Custom Rendering**:
 *    ```typescript
 *    const texture = renderDiceFaceToTexture(20, '#4ecdc4', (ctx, value, size) => {
 *      // Custom drawing code
 *      ctx.fillStyle = 'white';
 *      ctx.font = `bold ${size * 0.5}px Arial`;
 *      ctx.fillText(value.toString(), size / 2, size / 2);
 *    });
 *    ```
 *
 * 3. **Pre-rendered Textures**:
 *    ```typescript
 *    const textures = preRenderDiceFaces('d6', '#ff6b35', renderSimpleNumber);
 *    // Access by face value: textures[1], textures[2], etc.
 *    ```
 */

/**
 * Type for custom face rendering functions
 *
 * @param ctx - Canvas 2D rendering context
 * @param faceValue - The value to render (1-20 depending on dice type)
 * @param canvasSize - Size of the square canvas (width = height)
 * @param backgroundColor - Background color for the face
 */
export type FaceRenderer = (
  ctx: CanvasRenderingContext2D,
  faceValue: number,
  canvasSize: number,
  backgroundColor: string
) => void

/**
 * Default texture size for dice faces
 * Higher resolution = better quality but more memory
 * 512x512 is a good balance for most use cases
 */
export const DEFAULT_TEXTURE_SIZE = 512

/**
 * Renders a dice face value to a canvas texture
 *
 * This is the core function for creating face textures. It:
 * 1. Creates an offscreen canvas
 * 2. Calls the provided renderer to draw the face
 * 3. Converts the canvas to a Three.js CanvasTexture
 *
 * @param faceValue - The value to render on this face
 * @param backgroundColor - Background color for the face
 * @param renderer - Function that draws the face content
 * @param size - Canvas size (width and height)
 * @returns Three.js CanvasTexture ready for use in materials
 */
export function renderDiceFaceToTexture(
  faceValue: number,
  backgroundColor: string,
  renderer: FaceRenderer,
  size: number = DEFAULT_TEXTURE_SIZE
): THREE.CanvasTexture {
  // Create offscreen canvas
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D rendering context')
  }

  // Call custom renderer
  renderer(ctx, faceValue, size, backgroundColor)

  // Create and return texture
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  // Set texture properties for crisp rendering
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true

  return texture
}

/**
 * Simple number renderer - clean, readable numbers on solid background
 *
 * Renders a centered number with a solid background color.
 * Good default for basic dice visualization.
 */
export const renderSimpleNumber: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor
) => {
  // Fill background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Draw number
  ctx.fillStyle = 'white'
  ctx.font = `bold ${canvasSize * 0.6}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(faceValue.toString(), canvasSize / 2, canvasSize / 2)
}

/**
 * Styled number renderer - numbers with outline and shadow
 *
 * More visually appealing than simple numbers, with:
 * - Drop shadow for depth
 * - Black outline for contrast
 * - White fill for visibility
 */
export const renderStyledNumber: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor
) => {
  // Fill background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Setup text
  const fontSize = canvasSize * 0.6
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const centerX = canvasSize / 2
  const centerY = canvasSize / 2

  // Draw shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = fontSize * 0.1
  ctx.shadowOffsetX = fontSize * 0.05
  ctx.shadowOffsetY = fontSize * 0.05

  // Draw outline
  ctx.strokeStyle = 'black'
  ctx.lineWidth = fontSize * 0.08
  ctx.strokeText(faceValue.toString(), centerX, centerY)

  // Draw fill
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = 'white'
  ctx.fillText(faceValue.toString(), centerX, centerY)
}

/**
 * Bordered number renderer - numbers in a rounded rectangle
 *
 * Professional look with:
 * - Rounded rectangle border
 * - Inset background
 * - Clean typography
 */
export const renderBorderedNumber: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor
) => {
  // Fill outer background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Draw border rectangle
  const margin = canvasSize * 0.1
  const borderRadius = canvasSize * 0.05

  ctx.fillStyle = '#333'
  roundRect(ctx, margin, margin, canvasSize - margin * 2, canvasSize - margin * 2, borderRadius)
  ctx.fill()

  // Draw inner rectangle
  const innerMargin = margin + canvasSize * 0.03
  ctx.fillStyle = backgroundColor
  roundRect(
    ctx,
    innerMargin,
    innerMargin,
    canvasSize - innerMargin * 2,
    canvasSize - innerMargin * 2,
    borderRadius * 0.5
  )
  ctx.fill()

  // Draw number
  ctx.fillStyle = 'white'
  ctx.font = `bold ${canvasSize * 0.5}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(faceValue.toString(), canvasSize / 2, canvasSize / 2)
}

/**
 * Helper function to draw rounded rectangles
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * Pre-renders all face textures for a dice type
 *
 * Performance optimization: Create all textures once and reuse them.
 * Returns a map of face value → texture.
 *
 * @param diceType - Type of dice (determines number of faces)
 * @param backgroundColor - Background color for faces
 * @param renderer - Function to render each face
 * @param size - Canvas size
 * @returns Map of face values to textures (1-indexed)
 *
 * @example
 * ```typescript
 * const d20Textures = preRenderDiceFaces('d20', '#4ecdc4', renderSimpleNumber);
 * // Access face 1: d20Textures[1]
 * // Access face 20: d20Textures[20]
 * ```
 */
export function preRenderDiceFaces(
  diceType: 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20',
  backgroundColor: string,
  renderer: FaceRenderer = renderSimpleNumber,
  size: number = DEFAULT_TEXTURE_SIZE
): Record<number, THREE.CanvasTexture> {
  const faceCount = parseInt(diceType.substring(1)) // Extract number from 'd6' → 6

  const textures: Record<number, THREE.CanvasTexture> = {}

  // D10 uses 0-9, others use 1-N
  const startValue = diceType === 'd10' ? 0 : 1
  const endValue = diceType === 'd10' ? 9 : faceCount

  for (let faceValue = startValue; faceValue <= endValue; faceValue++) {
    textures[faceValue] = renderDiceFaceToTexture(faceValue, backgroundColor, renderer, size)
  }

  return textures
}

/**
 * Disposes of a texture to free memory
 *
 * Call this when removing dice or changing textures to prevent memory leaks.
 */
export function disposeTexture(texture: THREE.Texture): void {
  texture.dispose()
}

/**
 * Disposes of all textures in a map
 */
export function disposeAllTextures(textures: Record<number, THREE.Texture>): void {
  Object.values(textures).forEach((texture) => {
    texture.dispose()
  })
}
