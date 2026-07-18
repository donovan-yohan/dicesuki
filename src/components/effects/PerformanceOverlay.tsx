import { useEffect, useState } from 'react'
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor'

/**
 * Component to display performance stats overlay.
 */
export function PerformanceOverlay() {
  const stats = usePerformanceMonitor()
  const [show, setShow] = useState(false)

  useEffect(() => {
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
    <div className="fixed top-4 left-4 bg-theme-bg/80 text-theme-text p-3 rounded-lg font-mono text-sm z-50">
      <div className="space-y-1">
        <div>FPS: {stats.fps}</div>
        <div>Frame: {stats.frameTime}ms</div>
        <div>Avg: {stats.averageFps}</div>
      </div>
    </div>
  )
}
