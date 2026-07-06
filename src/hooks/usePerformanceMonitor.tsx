import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'

interface PerformanceStats {
  fps: number
  frameTime: number
  averageFps: number
}

/**
 * Hook to monitor Three.js scene performance.
 * Tracks FPS and frame time for performance optimization.
 */
export function usePerformanceMonitor() {
  const [stats, setStats] = useState<PerformanceStats>({
    fps: 60,
    frameTime: 16.67,
    averageFps: 60,
  })

  const lastTimeRef = useRef(performance.now())
  const framesRef = useRef<number[]>([])
  const frameCountRef = useRef(0)

  useFrame(() => {
    const currentTime = performance.now()
    const deltaTime = currentTime - lastTimeRef.current
    lastTimeRef.current = currentTime

    const currentFps = 1000 / deltaTime

    framesRef.current.push(currentFps)
    if (framesRef.current.length > 60) {
      framesRef.current.shift()
    }

    frameCountRef.current++

    if (frameCountRef.current >= 30) {
      const averageFps = framesRef.current.reduce((a, b) => a + b, 0) / framesRef.current.length

      setStats({
        fps: Math.round(currentFps),
        frameTime: Math.round(deltaTime * 100) / 100,
        averageFps: Math.round(averageFps),
      })

      frameCountRef.current = 0
    }
  })

  return stats
}
