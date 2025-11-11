import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Mock ResizeObserver for React Three Fiber tests
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as any

// Mock WebGL context for Three.js
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId) => {
  if (contextId === 'webgl' || contextId === 'webgl2') {
    return {
      canvas: document.createElement('canvas'),
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      getExtension: () => null,
      getParameter: () => null,
      getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 })
    }
  }
  return null
})

// Cleanup after each test
afterEach(() => {
  cleanup()
})
