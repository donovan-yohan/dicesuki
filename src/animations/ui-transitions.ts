/**
 * UI Animation Presets
 *
 * Framer Motion animation configurations for UI transitions.
 * Used across layout components for consistent, smooth animations.
 */

import { Transition, Variants } from 'framer-motion'

// ============================================================================
// Timing Constants
// ============================================================================

export const TIMING = {
  fast: 0.2,
  normal: 0.3,
  slow: 0.5,
} as const

export const STAGGER = {
  fast: 0.05,
  normal: 0.1,
  slow: 0.15,
} as const

// ============================================================================
// Easing Curves
// ============================================================================

export const EASING = {
  smooth: [0.4, 0.0, 0.2, 1], // ease-in-out
  enter: [0.0, 0.0, 0.2, 1], // ease-out
  exit: [0.4, 0.0, 1, 1], // ease-in
} as const

// ============================================================================
// Bottom Navigation Animations
// ============================================================================

export const navBarVariants: Variants = {
  show: {
    y: 0,
    opacity: 1,
    transition: {
      duration: TIMING.normal,
      ease: EASING.smooth,
    },
  },
  hide: {
    y: '100%',
    opacity: 0,
    transition: {
      duration: TIMING.normal,
      ease: EASING.smooth,
    },
  },
}

// ============================================================================
// Corner Icon Animations
// ============================================================================

export const topLeftIconVariants: Variants = {
  show: {
    x: 0,
    opacity: 1,
    transition: {
      duration: TIMING.normal,
      ease: EASING.smooth,
      delay: STAGGER.normal,
    },
  },
  hide: {
    x: -100,
    opacity: 0,
    transition: {
      duration: TIMING.normal,
      ease: EASING.smooth,
    },
  },
}

export const topRightIconVariants: Variants = {
  show: {
    x: 0,
    opacity: 1,
    transition: {
      duration: TIMING.normal,
      ease: EASING.smooth,
      delay: STAGGER.normal,
    },
  },
  hide: {
    x: 100,
    opacity: 0,
    transition: {
      duration: TIMING.normal,
      ease: EASING.smooth,
    },
  },
}

// ============================================================================
// Mini Toggle Animations
// ============================================================================

export const miniToggleVariants: Variants = {
  show: {
    opacity: 0.7,
    scale: 1,
    transition: {
      duration: TIMING.fast,
      delay: TIMING.normal + STAGGER.normal * 2, // After nav and corners
      ease: EASING.enter,
    },
  },
  hide: {
    opacity: 0,
    scale: 0.8,
    transition: {
      duration: TIMING.fast,
      ease: EASING.exit,
    },
  },
}

// ============================================================================
// Roll Button States
// ============================================================================

export const rollButtonReadyVariants: Variants = {
  idle: {
    scale: 1,
  },
  pulse: {
    scale: [1, 1.05, 1],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: EASING.smooth,
    },
  },
}

export const rollButtonRollingVariants: Variants = {
  spinning: {
    rotate: 360,
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'linear',
    },
  },
}

export const rollButtonDisabledVariants: Variants = {
  disabled: {
    scale: 0.95,
    opacity: 0.5,
    transition: {
      duration: TIMING.fast,
    },
  },
}

// ============================================================================
// Panel/Modal Animations
// ============================================================================

export const panelVariants: Variants = {
  closed: {
    x: '100%',
    transition: {
      duration: TIMING.normal,
      ease: EASING.exit,
    },
  },
  open: {
    x: 0,
    transition: {
      duration: TIMING.normal,
      ease: EASING.enter,
    },
  },
}

export const backdropVariants: Variants = {
  closed: {
    opacity: 0,
    transition: {
      duration: TIMING.fast,
    },
  },
  open: {
    opacity: 1,
    transition: {
      duration: TIMING.fast,
    },
  },
}

// ============================================================================
// Hover/Press Interactions
// ============================================================================

export const buttonHoverScale = {
  scale: 1.05,
  transition: {
    duration: TIMING.fast,
  },
}

export const buttonPressScale = {
  scale: 0.95,
  transition: {
    duration: TIMING.fast,
  },
}

// ============================================================================
// Spring Presets
// ============================================================================

export const springConfig: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 25,
}

export const bouncySpringConfig: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 15,
}

export const softSpringConfig: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 30,
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if user prefers reduced motion
 */
export function shouldReduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Get appropriate transition based on motion preference
 */
export function getTransition(normal: Transition): Transition {
  return shouldReduceMotion() ? { duration: 0 } : normal
}
