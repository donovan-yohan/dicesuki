import { Component, type ReactNode } from 'react'

interface SceneAssetErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  resetKey: string
}

interface SceneAssetErrorBoundaryState {
  hasError: boolean
}

/**
 * Keeps a rejected lazy scene asset from taking down the R3F table.
 *
 * `<Canvas>` wraps its children in an error boundary that re-throws into the
 * DOM tree, and nothing above the R3F hosts catches it — so an asset request
 * that fails (offline, firewalled, ad-blocked, 404) blanks the entire app
 * unless it is caught next to the loader that made it. Every asset loaded
 * inside a Canvas therefore sits behind one of these, paired with its own
 * `Suspense` so a *slow* request cannot stall its siblings either:
 *
 * - `MultiplayerDie` — bundled dice GLBs fall back to the procedural mesh.
 * - `Scene`'s `ThemedEnvironmentMap` — the HDR map falls back to the scene's
 *   own lights.
 * - `HeroDieInspector` — the managed GLB preview falls back to the procedural
 *   die, and its HDR map to the stage's own lights.
 *
 * Adding a new in-Canvas loader without this pair reopens issue #210.
 */
export class SceneAssetErrorBoundary extends Component<
  SceneAssetErrorBoundaryProps,
  SceneAssetErrorBoundaryState
> {
  state: SceneAssetErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): SceneAssetErrorBoundaryState {
    return { hasError: true }
  }

  componentDidUpdate(previous: SceneAssetErrorBoundaryProps) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
