export const WALLET_HUD_LAYOUT_CONTRACT = {
  rightInsetUnits: 4,
  widthUnits: 34,
  centerClearanceUnits: 6,
  bottomClearanceUnits: 36,
  resultTopUnits: 8,
  resultMaxViewportRatio: 0.4,
  resultGapUnits: 2,
  zIndex: 10,
} as const

export interface WalletHudLayoutBounds {
  left: number
  right: number
  top: number
  bottom: number
  maxHeight: number
  bottomClearance: number
  zIndex: number
}

/**
 * Numeric counterpart of WalletHud's token/vh CSS layout. It keeps portrait
 * contract tests deterministic without requiring a browser layout engine.
 */
export function getWalletHudLayoutBounds(
  viewportWidth: number,
  viewportHeight: number,
  spacingUnitPx: number,
): WalletHudLayoutBounds {
  const contract = WALLET_HUD_LAYOUT_CONTRACT
  const rightInset = contract.rightInsetUnits * spacingUnitPx
  const maximumWidth = Math.max(
    0,
    viewportWidth / 2 - contract.centerClearanceUnits * spacingUnitPx,
  )
  const width = Math.min(contract.widthUnits * spacingUnitPx, maximumWidth)
  const right = viewportWidth - rightInset
  const bottomClearance = contract.bottomClearanceUnits * spacingUnitPx
  const bottom = Math.max(0, viewportHeight - bottomClearance)
  const resultRegionBottom =
    viewportHeight * contract.resultMaxViewportRatio +
    contract.resultTopUnits * spacingUnitPx
  const desiredTop = resultRegionBottom + contract.resultGapUnits * spacingUnitPx
  const maxHeight = Math.max(0, bottom - desiredTop)

  return {
    left: right - width,
    right,
    top: bottom - maxHeight,
    bottom,
    maxHeight,
    bottomClearance,
    zIndex: contract.zIndex,
  }
}
