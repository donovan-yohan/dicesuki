import type { ReactNode } from 'react'
import { DiceBackendContext, type DiceBackendState } from './DiceBackendContext'

interface DiceBackendProviderProps {
  value: DiceBackendState
  children: ReactNode
}

export function DiceBackendProvider({ value, children }: DiceBackendProviderProps) {
  return (
    <DiceBackendContext.Provider value={value}>
      {children}
    </DiceBackendContext.Provider>
  )
}
