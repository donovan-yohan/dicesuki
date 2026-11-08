import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const sampling = await import('./environment-performance-sampling.mjs').catch(() => ({}))

test('rejects context loss after real drawing has begun, rather than accepting surviving RAF cadence', { timeout: 30000 }, async () => {
  assert.equal(typeof sampling.measureRenderedFrames, 'function')
  const browser = await chromium.launch({ executablePath: process.env.PERF_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  try {
    const page = await browser.newPage()
    await page.setContent('<canvas width="64" height="64"></canvas>')
    await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2')
      const program = gl.createProgram()
      for (const [type, source] of [[gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'], [gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;out vec4 color;void main(){color=vec4(0.4,0.8,0.2,1.);}']]) {
        const shader = gl.createShader(type)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      gl.useProgram(program)
      window.__renderWork = { calls: 0, triangles: 0 }
      window.__totalDraws = 0
      function frame() {
        if (!gl.isContextLost()) {
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          window.__renderWork.calls++
          window.__renderWork.triangles++
          window.__totalDraws++
        }
        requestAnimationFrame(frame)
      }
      frame()
    })
    const healthy = await page.evaluate(sampling.measureRenderedFrames, { durationMs: 150 })
    assert.ok(healthy.callsPerFrame > 0)
    assert.equal(healthy.contextLost, false)
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      window.__drawsBeforeLoss = window.__totalDraws
      setTimeout(() => {
        window.__drawsAtLoss = window.__totalDraws
        canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
      }, 70)
    })
    await assert.rejects(page.evaluate(sampling.measureRenderedFrames, { durationMs: 250 }), /context.*lost/i)
    assert.ok(await page.evaluate(() => window.__drawsAtLoss > window.__drawsBeforeLoss), 'loss must occur after actual work, not before sampling')
  } finally { await browser.close() }
})
