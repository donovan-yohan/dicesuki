import { readFileSync } from 'node:fs'
import * as React from 'react'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('src/components/Scene.tsx', 'utf8')
const parsed = ts.createSourceFile('Scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const lighting = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ThemedLighting')!
// Execute the production lighting body; this fixture deliberately does not load
// the room/auth/physics graph. Native acceptance covers the complete Canvas.
const compiled = ts.transpileModule(lighting.getText(parsed), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText
function elements(tree: React.ReactNode): React.ReactElement[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return []
  return [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)]
}
function MapMarker() { return null }
function renderLighting(kind?: string) {
  const currentTheme = {
    id: 'fixture', environment: { scene: kind ? { kind } : undefined, lighting: {
      ambient: { color: '#fff', intensity: 1 }, directional: { color: '#fff', intensity: 1, position: [0, 1, 0] },
    } },
  }
  return new Function('React', 'useEnvironmentTheme', 'useThree', 'useRef', 'useMemo', 'useEffect', 'useLayoutEffect', 'useEngineConfig', 'getCameraFrustumDimensions', 'setDirectionalShadowMapSize', 'ThemedEnvironmentMap',
    `${compiled}; return ThemedLighting({})`)(React, () => currentTheme,
    () => ({ size: { width: 800, height: 600 }, invalidate: vi.fn() }),
    () => ({ current: null }), (fn: () => unknown) => fn(), vi.fn(), vi.fn(), () => undefined,
    () => ({ width: 10, height: 10 }), vi.fn(), MapMarker) as React.ReactNode
}

describe('gameplay Canvas atmosphere integration', () => {
  it.each([undefined, 'woodland'])('retains the original guarded HDR map for %s', kind => {
    expect(elements(renderLighting(kind)).filter(element => element.type === MapMarker)).toHaveLength(1)
    expect(source).toContain('<SceneAssetErrorBoundary resetKey={TABLE_ENVIRONMENT_MAP_URL} fallback={null}>')
    expect(source).toContain('<Environment files={TABLE_ENVIRONMENT_MAP_URL} />')
  })

  it.each(['cyberpunk-alley', 'monster-dungeon'])('does not mount inherited HDR fill for %s', kind => {
    expect(elements(renderLighting(kind)).filter(element => element.type === MapMarker)).toHaveLength(0)
  })

  it('binds bloom to the resolved gameplay environment rather than the DOM HUD or selected personal theme', () => {
    const canvasStart = source.indexOf('<Canvas\n')
    const canvasEnd = source.indexOf('</Canvas>', canvasStart)
    const binding = '<WorldBloom environmentRecipe={environmentRecipe} environmentQuality={environmentQuality} />'
    expect(source.slice(canvasStart, canvasEnd)).toContain(binding)
    expect(source.slice(canvasEnd)).not.toContain('<WorldBloom')
  })
})
