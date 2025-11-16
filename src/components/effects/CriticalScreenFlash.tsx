import { useEffect, useState } from 'react'
import type { CriticalScreenFlash as CriticalScreenFlashConfig } from '../../themes/tokens'

interface CriticalScreenFlashProps {
  config: CriticalScreenFlashConfig
  trigger: boolean // Set to true to trigger flash
  onComplete?: () => void // Callback when flash completes
}

/**
 * Screen flash overlay for critical hits/failures
 * Renders a fullscreen colored div with fade animation
 */
export function CriticalScreenFlash({ config, trigger, onComplete }: CriticalScreenFlashProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    if (!trigger || !config.enabled) return

    // Show flash
    setIsVisible(true)
    setOpacity(config.intensity)

    const fadeOut = config.fadeOut ?? true

    if (fadeOut) {
      // Fade out over duration
      const startTime = performance.now()
      const animate = () => {
        const elapsed = performance.now() - startTime
        const progress = elapsed / config.duration

        if (progress >= 1.0) {
          setIsVisible(false)
          setOpacity(0)
          onComplete?.()
          return
        }

        // Ease out quad
        const ease = 1 - Math.pow(1 - progress, 2)
        setOpacity(config.intensity * (1 - ease))

        requestAnimationFrame(animate)
      }

      requestAnimationFrame(animate)
    } else {
      // Instant disappear after duration
      setTimeout(() => {
        setIsVisible(false)
        setOpacity(0)
        onComplete?.()
      }, config.duration)
    }
  }, [trigger, config, onComplete])

  if (!isVisible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: config.color,
        opacity,
        pointerEvents: 'none',
        zIndex: 9999,
        transition: config.fadeOut ? 'none' : undefined,
      }}
    />
  )
}
