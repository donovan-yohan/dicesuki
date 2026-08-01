#!/usr/bin/env node

/**
 * Step 6 of the themed dice pipeline: render a 720x720 proof of every baked die
 * with its proof face square to the camera.
 *
 * The archived flow (`capture-theme-workshop.mjs` at commit 7393d112…) drove a
 * `/test/production-dice-preview` React harness that does not exist on `main`.
 * Rather than reintroducing a route into the runtime bundle, this renders the
 * baked GLB directly in headless Chromium with the repo's own copy of Three.js,
 * which keeps the whole pipeline outside `src/`.
 *
 * Output size and framing match what `scripts/runtime-dice-assets/capture-thumbnails.mjs`
 * expects: a 720px square whose subject sits inside the 104,104..616,616 crop
 * box that becomes the 320px runtime thumbnail.
 *
 * Usage:
 *   node scripts/imagegen-uv/capture-theme-proofs.mjs [--theme fantasy-earth] [--out DIR]
 */

import { access, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { faceNumeralBaselinesFromManifest } from './themed-polyhedral-glb.mjs'
import {
  getProofFace,
  getTemplatePaths,
  getThemeBakePaths,
  selectThemes,
  THEME_WORKSHOP_ROOT,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const THREE_BUILD = path.join(REPO_ROOT, 'node_modules', 'three', 'build', 'three.module.js')
const THREE_JSM_ROOT = path.join(REPO_ROOT, 'node_modules', 'three', 'examples', 'jsm')
const PROOF_SIZE = 720
const ORIGIN = 'https://dicesuki-proof.local'

export async function captureThemeProofs(options = {}) {
  const root = options.root ?? THEME_WORKSHOP_ROOT
  const themes = selectThemes(options.themes)
  const jobs = []
  const skipped = []

  for (const theme of themes) {
    for (const shape of THEME_WORKSHOP_SHAPES) {
      const bake = getThemeBakePaths(theme.id, shape, root)
      try {
        await access(bake.model)
        await access(bake.metadata)
      } catch {
        skipped.push(`${theme.id}/${shape}`)
        continue
      }
      const metadata = JSON.parse(await readFile(bake.metadata, 'utf8'))
      const faceValue = getProofFace(shape)
      const face = metadata.faceNormals?.find((entry) => entry.value === faceValue)
      if (!face) throw new Error(`${theme.id}/${shape} metadata has no face normal for value ${faceValue}`)
      const manifest = JSON.parse(await readFile(getTemplatePaths(shape, root).manifest, 'utf8'))
      const baseline = faceNumeralBaselinesFromManifest(manifest).find((entry) => entry.value === faceValue)
      if (!baseline) throw new Error(`${shape} manifest has no island for face value ${faceValue}`)
      jobs.push({
        label: `${theme.id}/${shape}`,
        modelPath: bake.model,
        outputPath: bake.proof,
        normal: face.normal,
        baseline: baseline.baseline,
        faceValue,
      })
    }
  }

  if (jobs.length === 0) return { captured: [], skipped, root }

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const captured = []

  try {
    const threeSource = await readFile(THREE_BUILD, 'utf8')
    const page = await browser.newPage({
      viewport: { width: PROOF_SIZE, height: PROOF_SIZE },
      deviceScaleFactor: 1,
    })

    let currentModel = Buffer.alloc(0)
    await page.route(`${ORIGIN}/**`, async (route) => {
      const requested = new URL(route.request().url()).pathname
      if (requested === '/' || requested === '/index.html') {
        return route.fulfill({ contentType: 'text/html', body: renderHostPage() })
      }
      if (requested === '/three.module.js') {
        return route.fulfill({ contentType: 'text/javascript', body: threeSource })
      }
      if (requested === '/model.glb') {
        return route.fulfill({ contentType: 'model/gltf-binary', body: currentModel })
      }
      if (requested.startsWith('/jsm/')) {
        const resolved = path.join(THREE_JSM_ROOT, requested.slice('/jsm/'.length))
        if (!resolved.startsWith(`${THREE_JSM_ROOT}${path.sep}`)) return route.abort()
        return route.fulfill({ contentType: 'text/javascript', body: await readFile(resolved, 'utf8') })
      }
      return route.abort()
    })

    for (const job of jobs) {
      currentModel = await readFile(job.modelPath)
      await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__proofReady === true, undefined, { timeout: 60_000 })
      const error = await page.evaluate(
        ({ normal, baseline }) => window.__renderProof(normal, baseline),
        { normal: job.normal, baseline: job.baseline },
      )
      if (error) throw new Error(`${job.label}: ${error}`)
      await mkdir(path.dirname(job.outputPath), { recursive: true })
      await page.screenshot({ path: job.outputPath, type: 'png', omitBackground: true })
      captured.push(job.label)
    }
    await page.close()
  } finally {
    await browser.close()
  }

  return { captured, skipped, root }
}

function renderHostPage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>html,body{margin:0;width:${PROOF_SIZE}px;height:${PROOF_SIZE}px;overflow:hidden;background:transparent}canvas{display:block}</style>
    <script type="importmap">{"imports":{"three":"/three.module.js","three/addons/":"/jsm/"}}</script>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three'
      import { GLTFLoader } from '/jsm/loaders/GLTFLoader.js'

      const SIZE = ${PROOF_SIZE}
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(1)
      renderer.setSize(SIZE, SIZE)
      renderer.setClearAlpha(0)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
      document.body.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
      camera.position.set(0, 0, 6)
      camera.lookAt(0, 0, 0)

      scene.add(new THREE.AmbientLight(0xffffff, 1.35))
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1))
      const key = new THREE.DirectionalLight(0xffffff, 2.1)
      key.position.set(2.2, 3.1, 4.4)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xcfd8ff, 0.85)
      fill.position.set(-3.2, -1.4, 2.6)
      scene.add(fill)
      const rim = new THREE.DirectionalLight(0xffffff, 0.7)
      rim.position.set(-1.1, 2.4, -3.6)
      scene.add(rim)

      const pivot = new THREE.Group()
      scene.add(pivot)

      let die = null
      const loader = new GLTFLoader()
      loader.load('/model.glb', (gltf) => {
        die = gltf.scene
        pivot.add(die)
        window.__proofReady = true
      }, undefined, (error) => {
        window.__proofError = String(error?.message ?? error)
        window.__proofReady = true
      })

      window.__renderProof = (normal, baseline) => {
        if (window.__proofError) return window.__proofError
        if (!die) return 'model did not load'
        // Aim the requested face at the camera, then frame the mesh so it lands
        // inside the 104..616 crop box capture-thumbnails.mjs extracts.
        const source = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize()
        const aim = new THREE.Quaternion().setFromUnitVectors(source, new THREE.Vector3(0, 0, 1))

        // Roll about the view axis so the numeral's baseline reads horizontally
        // left-to-right; without this, faces whose canonical baseline angle is
        // near +/-90 degrees photograph upside-down.
        const rolled = new THREE.Vector3(baseline[0], baseline[1], baseline[2])
          .normalize()
          .applyQuaternion(aim)
        const roll = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -Math.atan2(rolled.y, rolled.x),
        )
        pivot.quaternion.copy(roll.multiply(aim))
        pivot.updateMatrixWorld(true)

        const box = new THREE.Box3().setFromObject(pivot)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        pivot.position.sub(sphere.center)
        pivot.updateMatrixWorld(true)

        // Collect world-space vertices once so framing can use the real
        // silhouette. A bounding sphere badly under-fills pointy solids (d4)
        // and over-shrinks flat-on faces (d20), which would leave the subject
        // rattling around inside the 104..616 thumbnail crop.
        const points = []
        pivot.traverse((child) => {
          const position = child.isMesh && child.geometry?.getAttribute('position')
          if (!position) return
          for (let index = 0; index < position.count; index += 1) {
            points.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld))
          }
        })
        if (points.length === 0) return 'model has no renderable vertices'

        // Solve for the camera distance whose projected silhouette fills
        // TARGET_NDC of the frame. Perspective extent scales ~1/distance, so
        // two fixed-point steps converge well inside a pixel.
        const TARGET_NDC = 0.52
        let distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.5
        for (let iteration = 0; iteration < 3; iteration += 1) {
          camera.position.set(0, 0, distance)
          camera.lookAt(0, 0, 0)
          camera.updateMatrixWorld(true)
          camera.updateProjectionMatrix()
          let extent = 0
          for (const point of points) {
            const projected = point.clone().project(camera)
            extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y))
          }
          if (!Number.isFinite(extent) || extent <= 0) return 'unable to measure projected extent'
          distance *= extent / TARGET_NDC
        }
        camera.position.set(0, 0, distance)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld(true)
        camera.updateProjectionMatrix()

        renderer.render(scene, camera)
        return null
      }
    </script>
  </body>
</html>
`
}

function parseArgs(argv) {
  const options = { themes: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--theme') options.themes.push(argv[++index])
    else if (argument === '--out') options.root = argv[++index]
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/imagegen-uv/capture-theme-proofs.mjs [--theme ID] [--out DIR]')
    return
  }
  const result = await captureThemeProofs(options)
  if (result.captured.length === 0) {
    throw new Error(
      `No baked GLBs found under ${result.root}. Run \`npm run bake:theme-dice-sets\` first.`,
    )
  }
  console.log(`Captured ${result.captured.length} proof render(s): ${result.captured.join(', ')}`)
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} unbaked die/dice: ${result.skipped.join(', ')}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
