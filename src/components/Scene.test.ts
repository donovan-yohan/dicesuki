import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/Scene.tsx'), 'utf8')

describe('Scene HUD Layout A contract', () => {
  it('removes the table WalletHud mount and preserves the gated Shop CornerIcon', () => {
    expect(source).not.toContain('<WalletHud')
    expect(source).toContain('const showShop = isPaymentsEnabled() || STANDARD_ROLL_CONVERSION_AVAILABLE')
    expect(source).toMatch(/\{showShop && \(\s*<CornerIcon[\s\S]*?position="top-right"[\s\S]*?label="Shop"/)
  })

  it('wires saved rolls and players into the nav while keeping PlayerPanel available to solo', () => {
    expect(source).toContain('onOpenSavedRolls={() => setIsSavedRollsOpen(true)}')
    expect(source).toContain('onOpenPlayerPanel={() => setIsPlayerPanelOpen(!isPlayerPanelOpen)}')

    const playerPanel = source.indexOf('<PlayerPanel isOpen={isPlayerPanelOpen} />')
    const multiplayerOnlyNotices = source.indexOf('{isMultiplayer && (', playerPanel)
    expect(playerPanel).toBeGreaterThan(-1)
    expect(playerPanel).toBeLessThan(multiplayerOnlyNotices)
  })

  it('structurally suppresses chrome under hidden UI so reduced motion cannot retain it', () => {
    const visibleHud = source.indexOf('{isUIVisible && (')
    const permanentEye = source.indexOf('<UIToggleMini')

    expect(visibleHud).toBeGreaterThan(-1)
    expect(permanentEye).toBeGreaterThan(visibleHud)
    for (const control of [
      '<BottomNav',
      '<CenterRollButton',
      '<ResultDisplay',
      '<RenderLodDebugOverlay',
      'label="Settings"',
      'label="Shop"',
      'aria-label="Rotate view 90 degrees"',
      'aria-label="Motion Mode"',
      '<DiceToolbar',
      '<PlayerPanel',
    ]) {
      const index = source.indexOf(control, visibleHud)
      expect(index).toBeGreaterThan(visibleHud)
      expect(index).toBeLessThan(permanentEye)
    }
    expect(source).toContain('setIsDiceManagerOpen(false)')
    expect(source).toContain('setIsPlayerPanelOpen(false)')
  })
})
