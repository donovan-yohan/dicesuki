import { surfaceKinds, surfacePixels, type SurfaceSet, type SurfaceSize } from './cyberpunkSurfaces'

// Pure pixel work only. No Three, DOM, renderer, scene or GPU resources.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SurfaceSize>) => void) | null
  postMessage: (value: SurfaceSet, transfer: ArrayBuffer[]) => void
}
scope.onmessage = ({ data: size }) => {
  if (size !== 256 && size !== 512) throw new Error('Unsupported Cyberpunk surface tier')
  const pixels = Object.fromEntries(surfaceKinds.map(kind => [kind, surfacePixels(size, kind)])) as SurfaceSet
  scope.postMessage(pixels, surfaceKinds.flatMap(kind => [pixels[kind].albedo.buffer as ArrayBuffer, pixels[kind].normal.buffer as ArrayBuffer]))
}
