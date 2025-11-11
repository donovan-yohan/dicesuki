import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'

interface PerformanceStats {
  fps: number
  frameTime: number
  averageFps: number
}

/**
 * Hook to monitor Three.js scene performance
 * Tracks FPS and frame time for performance optimization
 */
export function usePerformanceMonitor() {
  const [stats, setStats] = useState<PerformanceStats>({
    fps: 60,
    frameTime: 16.67,
    averageFps: 60
  })

  const lastTimeRef = useRef(performance.now())
  const framesRef = useRef<number[]>([])
  const frameCountRef = useRef(0)

  useFrame(() => {
    const currentTime = performance.now()
    const deltaTime = currentTime - lastTimeRef.current
    lastTimeRef.current = currentTime

    const currentFps = 1000 / deltaTime

    // Store last 60 frames for averaging
    framesRef.current.push(currentFps)
    if (framesRef.current.length > 60) {
      framesRef.current.shift()
    }

    frameCountRef.current++

    // Update stats every 30 frames (~0.5 seconds at 60fps)
    if (frameCountRef.current >= 30) {
      const averageFps = framesRef.current.reduce((a, b) => a + b, 0) / framesRef.current.length

      setStats({
        fps: Math.round(currentFps),
        frameTime: Math.round(deltaTime * 100) / 100,
        averageFps: Math.round(averageFps)
      })

      frameCountRef.current = 0
    }
  })

  return stats
}

/**
 * Component to display performance stats overlay
 */
export function PerformanceOverlay() {
  const stats = usePerformanceMonitor()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Toggle stats with Ctrl+Shift+P
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        setShow(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  if (!show) return null

  return (
    <div className="fixed top-4 left-4 bg-black bg-opacity-75 text-white p-3 rounded-lg font-mono text-sm z-50">
      <div className="space-y-1">
        <div>FPS: <span className={stats.averageFps < 30 ? 'text-red-500' : stats.averageFps < 50 ? 'text-yellow-500' : 'text-green-500'}>
          {stats.averageFps}
        </span></div>
        <div>Frame: {stats.frameTime}ms</div>
        <div className="text-xs text-gray-400 mt-2">Ctrl+Shift+P to toggle</div>
      </div>
    </div>
  )
}
