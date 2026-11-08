/** Browser-evaluated sampler. Must remain closure-free for Playwright serialization. */
export function measureRenderedFrames({ durationMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const canvas = document.querySelector('canvas')
    const gl = canvas?.getContext('webgl2')
    let frameId = 0
    let settled = false
    const cleanup = () => {
      cancelAnimationFrame(frameId)
      clearTimeout(timeout)
      canvas?.removeEventListener('webglcontextlost', lost)
    }
    const fail = message => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }
    const lost = () => fail('WebGL context lost during render measurement')
    const healthy = () => {
      if (!gl || gl.isContextLost()) return false
      return Boolean(gl.getParameter(gl.RENDERER))
    }
    const timeout = setTimeout(() => fail('Render measurement stalled'), durationMs + 10000)
    canvas?.addEventListener('webglcontextlost', lost)
    if (!healthy()) return fail('WebGL context missing or lost before render measurement')
    const samples = []
    let previous = 0
    let start = 0
    window.__renderWork.calls = 0
    window.__renderWork.triangles = 0
    function frame(now) {
      if (settled) return
      if (!healthy()) return fail('WebGL context lost during render measurement')
      if (!start) start = now
      if (previous) samples.push(now - previous)
      previous = now
      if (now - start < durationMs) {
        frameId = requestAnimationFrame(frame)
        return
      }
      const sorted = [...samples].sort((a, b) => a - b)
      const elapsed = samples.reduce((sum, n) => sum + n, 0)
      const work = window.__renderWork
      if (!samples.length || work.calls <= 0 || work.triangles <= 0) return fail('No rendered WebGL work in measurement')
      settled = true
      cleanup()
      resolve({ frames: samples.length, fps: 1000 * samples.length / elapsed, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1), callsPerFrame: work.calls / samples.length, trianglesPerFrame: work.triangles / samples.length, contextLost: false })
    }
    frameId = requestAnimationFrame(frame)
  })
}
