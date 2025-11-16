import { memo } from 'react'
import { DiceIcon, type DiceType } from './DiceIcon'

interface DiceIconWithNumberProps {
  type: DiceType
  number?: number
  className?: string
  size?: number
}

const DiceIconWithNumberImpl = ({
  type,
  number,
  className = '',
  size = 24
}: DiceIconWithNumberProps) => {
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <DiceIcon type={type} size={size} className="text-gray-700" />
      {number !== undefined && (
        <span
          className="absolute inset-0 flex items-center justify-center font-bold text-white pointer-events-none"
          style={{
            fontSize: `${size * 0.4}px`,
            textShadow: '0 1px 2px rgba(0,0,0,0.3)'
          }}
        >
          {number}
        </span>
      )}
    </div>
  )
}

export const DiceIconWithNumber = memo(DiceIconWithNumberImpl)
