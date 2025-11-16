import { memo } from 'react'

export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'

interface DiceIconProps {
  type: DiceType
  className?: string
  size?: number
}

const DiceIconImpl = ({ type, className = '', size = 24 }: DiceIconProps) => {
  // Unique gradient IDs for each instance to avoid conflicts
  const gradientId = `dice-gradient-${type}-${Math.random().toString(36).substr(2, 9)}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Radial gradient for smooth 3D sphere-like shading */}
        <radialGradient id={gradientId}>
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </radialGradient>
      </defs>

      {type === 'd4' && (
        // Tetrahedron - equilateral triangle pointing up
        <g>
          <defs>
            <linearGradient id={`${gradientId}-d4`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cbd5e0" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
          </defs>
          <path
            d="M 50 18 L 82 75 L 18 75 Z"
            fill={`url(#${gradientId}-d4)`}
          />
        </g>
      )}

      {type === 'd6' && (
        // Cube - rounded square for number display
        <g>
          <rect
            x="22"
            y="22"
            width="56"
            height="56"
            rx="8"
            ry="8"
            fill={`url(#${gradientId})`}
          />
        </g>
      )}

      {type === 'd8' && (
        // Octahedron - diamond with smooth gradient
        <g>
          <defs>
            <linearGradient id={`${gradientId}-d8`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cbd5e0" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
          </defs>
          <path
            d="M 50 15 L 78 50 L 50 85 L 22 50 Z"
            fill={`url(#${gradientId}-d8)`}
          />
        </g>
      )}

      {type === 'd10' && (
        // D10 - elongated gem shape
        <g>
          <defs>
            <linearGradient id={`${gradientId}-d10`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cbd5e0" />
              <stop offset="30%" stopColor="#94a3b8" />
              <stop offset="70%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
          </defs>
          <path
            d="M 50 12 L 72 38 L 70 62 L 50 88 L 30 62 L 28 38 Z"
            fill={`url(#${gradientId}-d10)`}
          />
        </g>
      )}

      {type === 'd12' && (
        // Dodecahedron - rounded pentagon
        <g>
          <defs>
            <linearGradient id={`${gradientId}-d12`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cbd5e0" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
          </defs>
          <path
            d="M 50 18 L 75 35 L 68 68 L 32 68 L 25 35 Z"
            fill={`url(#${gradientId}-d12)`}
          />
        </g>
      )}

      {type === 'd20' && (
        // Icosahedron - rounded shape
        <g>
          <circle
            cx="50"
            cy="50"
            r="38"
            fill={`url(#${gradientId})`}
          />
        </g>
      )}
    </svg>
  )
}

export const DiceIcon = memo(DiceIconImpl)
