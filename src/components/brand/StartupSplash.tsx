import { useCallback, useEffect, useState, type ReactNode } from 'react'

export type StartupPhase =
  | 'boot'
  | 'device'
  | 'engine'
  | 'room'
  | 'multiplayer'
  | 'rendering'
  | 'ready'

const PHASE_DETAILS: Record<StartupPhase, { label: string; progress: number }> = {
  boot: { label: 'Loading Dicesuki…', progress: 12 },
  device: { label: 'Checking this device…', progress: 28 },
  engine: { label: 'Starting the dice engine…', progress: 58 },
  multiplayer: { label: 'Joining the room…', progress: 72 },
  room: { label: 'Preparing your table…', progress: 84 },
  rendering: { label: 'Rendering your dice table…', progress: 94 },
  ready: { label: 'Ready to roll', progress: 100 },
}

interface StartupSplashProps {
  phase?: StartupPhase
  overlay?: boolean
}

export function StartupSplash({ phase = 'boot', overlay = false }: StartupSplashProps) {
  const { label, progress } = PHASE_DETAILS[phase]

  return (
    <div
      className={`startup-splash${overlay ? ' startup-splash--overlay' : ''}`}
      data-testid="startup-splash"
      data-phase={phase}
    >
      <div className="startup-splash__content">
        <img
          className="startup-splash__icon"
          src="/brand/dicesuki-icon.svg"
          alt=""
          aria-hidden="true"
        />
        <img
          className="startup-splash__wordmark"
          src="/brand/dicesuki-wordmark.svg"
          alt="Dicesuki"
        />
        <div
          className="startup-splash__progress"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="startup-splash__status" aria-live="polite">
          {label}
        </p>
      </div>
    </div>
  )
}

interface StartupGateProps {
  ready: boolean
  phase: StartupPhase
  children: (onContentReady: () => void) => ReactNode
  revealDelayMs?: number
  /**
   * Fires whenever the gate hands the screen to `children` (`true`) or takes it
   * back because `ready` dropped (`false`).
   *
   * The handover is the only moment that matters to anything watching the boot,
   * and it is otherwise observable only as the *absence* of the splash — which
   * forces watchers to poll and guess a budget. Hosts surface this as a DOM
   * attribute so the handover is a positive edge to await (issue #210).
   */
  onRevealChange?: (revealed: boolean) => void
}

/**
 * Keeps the brand splash mounted until both the data source and the rendered
 * scene are ready. The short completion beat lets the progress bar reach 100%
 * instead of disappearing at an arbitrary intermediate value.
 */
export function StartupGate({
  ready,
  phase,
  children,
  revealDelayMs = 220,
  onRevealChange,
}: StartupGateProps) {
  const [contentReady, setContentReady] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!ready) {
      setContentReady(false)
      setRevealed(false)
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !contentReady) return
    const timeout = window.setTimeout(() => setRevealed(true), revealDelayMs)
    return () => window.clearTimeout(timeout)
  }, [contentReady, ready, revealDelayMs])

  useEffect(() => {
    onRevealChange?.(revealed)
  }, [revealed, onRevealChange])

  const markContentReady = useCallback(() => setContentReady(true), [])

  if (!ready) {
    return <StartupSplash phase={phase} />
  }

  return (
    <>
      {children(markContentReady)}
      {!revealed && (
        <StartupSplash phase={contentReady ? 'ready' : 'rendering'} overlay />
      )}
    </>
  )
}
