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
 * DOM tree, and nothing above `<Scene>` catches it — so an asset request that
 * fails (offline, firewalled, ad-blocked, 404) blanks the entire app unless it
 * is caught next to the loader that made it. Every asset loaded inside the
 * Canvas therefore sits behind one of these with a usable fallback: bundled
 * dice GLBs fall back to their procedural mesh, and the HDR environment map
 * falls back to the scene's own lights (issue #210).
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
