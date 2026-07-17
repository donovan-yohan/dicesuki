import { Component, type ReactNode } from 'react'

interface DiceAssetErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  resetKey: string
}

interface DiceAssetErrorBoundaryState {
  hasError: boolean
}

/** Keeps a rejected lazy GLB request from taking down the R3F table. */
export class DiceAssetErrorBoundary extends Component<
  DiceAssetErrorBoundaryProps,
  DiceAssetErrorBoundaryState
> {
  state: DiceAssetErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): DiceAssetErrorBoundaryState {
    return { hasError: true }
  }

  componentDidUpdate(previous: DiceAssetErrorBoundaryProps) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
