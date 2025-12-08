/**
 * Animation Mixer Hook
 *
 * Manages Three.js AnimationMixer for playing GLTF animations on custom dice.
 * Supports automatic looping, speed control, and state-based animation triggers.
 */

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { AnimationConfig, AnimationLoopMode } from '../types/customDice'

/**
 * State of the dice for animation triggering
 */
export interface DiceAnimationState {
  /** Whether the dice is currently at rest */
  isAtRest: boolean
  /** Whether the dice is being dragged */
  isDragging: boolean
  /** Whether a collision just occurred */
  hasImpact: boolean
}

/**
 * Return type for useAnimationMixer hook
 */
export interface AnimationMixerResult {
  /** Trigger an impact animation (one-shot) */
  triggerImpact: () => void
}

/**
 * Map AnimationLoopMode to Three.js loop constants
 */
function getLoopMode(mode: AnimationLoopMode): THREE.AnimationActionLoopStyles {
  switch (mode) {
    case 'once':
      return THREE.LoopOnce
    case 'pingpong':
      return THREE.LoopPingPong
    case 'repeat':
    default:
      return THREE.LoopRepeat
  }
}

/**
 * Hook to manage GLTF animations on a Three.js scene
 *
 * @param scene - The cloned GLTF scene to animate
 * @param animations - Array of AnimationClip from GLTF
 * @param configs - Animation configurations from metadata (optional)
 * @param state - Current dice animation state for triggers
 * @returns Animation control methods
 *
 * @example
 * const { triggerImpact } = useAnimationMixer(
 *   scene,
 *   animations,
 *   metadata?.animations,
 *   { isAtRest, isDragging, hasImpact: false }
 * )
 */
export function useAnimationMixer(
  scene: THREE.Group | null,
  animations: THREE.AnimationClip[],
  configs?: AnimationConfig[],
  state: DiceAnimationState = { isAtRest: false, isDragging: false, hasImpact: false }
): AnimationMixerResult {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map())
  const impactActionsRef = useRef<THREE.AnimationAction[]>([])

  // Create mixer and actions when scene/animations change
  useEffect(() => {
    if (!scene || animations.length === 0) {
      mixerRef.current = null
      actionsRef.current.clear()
      impactActionsRef.current = []
      return
    }

    // Create new mixer for this scene
    const mixer = new THREE.AnimationMixer(scene)
    mixerRef.current = mixer
    actionsRef.current.clear()
    impactActionsRef.current = []

    // Create actions for all animation clips
    animations.forEach((clip) => {
      const action = mixer.clipAction(clip)
      actionsRef.current.set(clip.name, action)

      // Find config for this animation (if any)
      const config = configs?.find((c) => c.name === clip.name)

      if (config) {
        // Apply config settings
        action.setLoop(getLoopMode(config.loop || 'repeat'), Infinity)
        action.timeScale = config.speed || 1.0

        // Track impact animations separately
        if (config.triggerOn === 'impact') {
          action.clampWhenFinished = true
          action.setLoop(THREE.LoopOnce, 1)
          impactActionsRef.current.push(action)
        }

        // Auto-play 'always' animations
        if (config.triggerOn === 'always' || (config.autoPlay && !config.triggerOn)) {
          if (config.fadeInDuration) {
            action.fadeIn(config.fadeInDuration)
          }
          action.play()
        }
      } else {
        // Default: play all animations on loop (backwards compatible)
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.play()
      }
    })

    // Cleanup - capture refs before cleanup runs
    const currentActions = actionsRef.current
    const currentImpactActions = impactActionsRef.current

    return () => {
      mixer.stopAllAction()
      currentActions.clear()
      currentImpactActions.length = 0
    }
  }, [scene, animations, configs])

  // Handle state-based animation triggers
  const prevStateRef = useRef(state)

  useEffect(() => {
    if (!mixerRef.current || !configs) return

    const prevState = prevStateRef.current

    configs.forEach((config) => {
      const action = actionsRef.current.get(config.name)
      if (!action) return

      switch (config.triggerOn) {
        case 'rolling':
          // Play when moving, stop when at rest
          if (!state.isAtRest && prevState.isAtRest) {
            action.reset()
            if (config.fadeInDuration) {
              action.fadeIn(config.fadeInDuration)
            }
            action.play()
          } else if (state.isAtRest && !prevState.isAtRest) {
            if (config.fadeOutDuration) {
              action.fadeOut(config.fadeOutDuration)
            } else {
              action.stop()
            }
          }
          break

        case 'idle':
          // Play when at rest, stop when moving
          if (state.isAtRest && !prevState.isAtRest) {
            action.reset()
            if (config.fadeInDuration) {
              action.fadeIn(config.fadeInDuration)
            }
            action.play()
          } else if (!state.isAtRest && prevState.isAtRest) {
            if (config.fadeOutDuration) {
              action.fadeOut(config.fadeOutDuration)
            } else {
              action.stop()
            }
          }
          break

        // 'always' and 'impact' are handled elsewhere
        default:
          break
      }
    })

    prevStateRef.current = { ...state }
  }, [state, configs])

  // Update mixer every frame
  useFrame((_, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta)
    }
  })

  // Method to trigger impact animations
  const triggerImpact = useMemo(() => {
    return () => {
      impactActionsRef.current.forEach((action) => {
        action.reset()
        action.play()
      })
    }
  }, [])

  return { triggerImpact }
}
