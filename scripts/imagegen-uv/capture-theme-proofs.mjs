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
 * Output size, framing, and background match the released sets so the runtime
 * thumbnails stay consistent: a 720px square, opaque on `#0f172a`, whose subject
 * fills `PROOF_SUBJECT_FILL` of the frame and sits inside the 104,104..616,616
 * crop box `scripts/runtime-dice-assets/capture-thumbnails.mjs` extracts.
 *
 * It also writes an all-faces contact sheet per die. That sheet is the art-pass
 * correctness gate — missing, duplicated, or mis-rotated numerals are only
 * visible when every face is rendered.
 *
 * Usage:
 *   node scripts/imagegen-uv/capture-theme-proofs.mjs [--theme fantasy-earth] [--out DIR]
 *        [--skip-contact-sheets]
 */

import { access, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { faceNumeralBaselinesFromManifest } from './themed-polyhedral-glb.mjs'
import {
  getProofFace,
  getTemplatePaths,
  getThemeBakePaths,
  getThemeProofSheetPath,
  PROOF_BACKGROUND_RGB,
  PROOF_SUBJECT_FILL,
  resolveWorkshopRoot,
  selectThemes,
  THEME_WORKSHOP_ROOT,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const THREE_BUILD = path.join(REPO_ROOT, 'node_modules', 'three', 'build', 'three.module.js')
const THREE_JSM_ROOT = path.join(REPO_ROOT, 'node_modules', 'three', 'examples', 'jsm')
const PROOF_SIZE = 720
const CONTACT_TILE_SIZE = 180
const ORIGIN = 'https://dicesuki-proof.local'

export async function captureThemeProofs(options = {}) {
  const root = options.root ?? THEME_WORKSHOP_ROOT
  const themes = selectThemes(options.themes)
  const contactSheets = options.contactSheets !== false
  const dice = []
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
      const manifest = JSON.parse(await readFile(getTemplatePaths(shape, root).manifest, 'utf8'))
      const baselines = faceNumeralBaselinesFromManifest(manifest)
      const faces = manifest.faceValues.map((value) => {
        const normal = metadata.faceNormals?.find((entry) => entry.value === value)
        const baseline = baselines.find((entry) => entry.value === value)
        if (!normal) throw new Error(`${theme.id}/${shape} metadata has no face normal for value ${value}`)
        if (!baseline) throw new Error(`${shape} manifest has no island for face value ${value}`)
        return { value, normal: normal.normal, baseline: baseline.baseline }
      })
      dice.push({
        label: `${theme.id}/${shape}`,
        modelPath: bake.model,
        proofPath: bake.proof,
        sheetPath: getThemeProofSheetPath(theme.id, shape, root),
        proofFaceValue: getProofFace(shape),
        faces,
      })
    }
  }

  if (dice.length === 0) return { captured: [], sheets: [], skipped, root }

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const captured = []
  const sheets = []

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

    for (const die of dice) {
      currentModel = await readFile(die.modelPath)
      await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__proofReady === true, undefined, { timeout: 60_000 })

      // Every face is rendered: one becomes the runtime thumbnail source and
      // the full set becomes the contact sheet the art pass is reviewed against.
      const rendered = []
      for (const face of contactSheets ? die.faces : die.faces.filter((f) => f.value === die.proofFaceValue)) {
        const error = await page.evaluate(
          ({ normal, baseline, fill }) => window.__renderProof(normal, baseline, fill),
          { normal: face.normal, baseline: face.baseline, fill: PROOF_SUBJECT_FILL },
        )
        if (error) throw new Error(`${die.label} face ${face.value}: ${error}`)
        rendered.push({ value: face.value, buffer: await page.screenshot({ type: 'png', omitBackground: true }) })
      }

      const proof = rendered.find((entry) => entry.value === die.proofFaceValue)
      if (!proof) throw new Error(`${die.label} did not render its proof face ${die.proofFaceValue}`)
      await mkdir(path.dirname(die.proofPath), { recursive: true })
      await writeOpaquePng(proof.buffer, die.proofPath)
      captured.push(die.label)

      if (contactSheets) {
        await mkdir(path.dirname(die.sheetPath), { recursive: true })
        await writeContactSheet(rendered, die.sheetPath)
        sheets.push(die.label)
      }
    }
    await page.close()
  } finally {
    await browser.close()
  }

  return { captured, sheets, skipped, root }
}

/**
 * Flatten the transparent render onto the released opaque field and drop alpha.
 *
 * Compositing here rather than clearing to a colour in WebGL keeps the
 * background byte-exact: it sidesteps tone mapping and colour-space conversion,
 * which would shift a clear colour away from the sampled `#0f172a`.
 */
async function writeOpaquePng(buffer, outputPath) {
  const sharp = (await import('sharp')).default
  await sharp(buffer)
    .flatten({ background: PROOF_BACKGROUND_RGB })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath)
}

/**
 * Tile every face of one die into a labelled contact sheet.
 *
 * This is the art-correctness backpressure: a missing value, a duplicated
 * value, a numeral rotated the wrong way, or art that crossed an island gap is
 * obvious here and invisible in a single-face proof.
 */
async function writeContactSheet(rendered, outputPath) {
  const sharp = (await import('sharp')).default
  const columns = Math.min(5, rendered.length)
  const rows = Math.ceil(rendered.length / columns)
  const tiles = await Promise.all(rendered.map(async (entry) => (
    sharp(entry.buffer).resize(CONTACT_TILE_SIZE, CONTACT_TILE_SIZE).png().toBuffer()
  )))

  const composite = []
  rendered.forEach((entry, index) => {
    const left = (index % columns) * CONTACT_TILE_SIZE
    const top = Math.floor(index / columns) * CONTACT_TILE_SIZE
    composite.push({ input: tiles[index], left, top })
    composite.push({ input: Buffer.from(renderTileLabel(entry.value)), left, top })
  })

  await sharp({
    create: {
      width: columns * CONTACT_TILE_SIZE,
      height: rows * CONTACT_TILE_SIZE,
      channels: 3,
      background: PROOF_BACKGROUND_RGB,
    },
  })
    .composite(composite)
    .png({ compressionLevel: 9 })
    .toFile(outputPath)
}

function renderTileLabel(value) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTACT_TILE_SIZE}" height="${CONTACT_TILE_SIZE}">
  <text x="8" y="24" font-family="Arial, sans-serif" font-size="20" font-weight="700"
        fill="#fde68a" stroke="#0f172a" stroke-width="3" paint-order="stroke fill">${value}</text>
</svg>`
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

      window.__renderProof = (normal, baseline, targetFill) => {
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

        // Solve for the camera distance whose projected silhouette *spans*
        // targetFill of the frame, recentring each step.
        //
        // Measuring the true NDC bounding box rather than max|ndc| matters:
        // for an asymmetric silhouette (a d4 face-on is a triangle) the
        // farthest vertex sits well past the box centre, so max|ndc| reads high
        // and the die ends up rendered too small. Perspective extent scales
        // ~1/distance, so a few fixed-point steps converge inside a pixel.
        const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2
        // The cached points stay fixed; the pan is accumulated here and applied
        // to the pivot once at the end, so those positions never go stale.
        const offset = new THREE.Vector3()
        let distance = sphere.radius / Math.sin(halfFov) * 1.5
        for (let iteration = 0; iteration < 5; iteration += 1) {
          camera.position.set(0, 0, distance)
          camera.lookAt(0, 0, 0)
          camera.updateMatrixWorld(true)
          camera.updateProjectionMatrix()

          let minX = Infinity; let maxX = -Infinity
          let minY = Infinity; let maxY = -Infinity
          for (const point of points) {
            const projected = point.clone().add(offset).project(camera)
            minX = Math.min(minX, projected.x); maxX = Math.max(maxX, projected.x)
            minY = Math.min(minY, projected.y); maxY = Math.max(maxY, projected.y)
          }
          const span = Math.max(maxX - minX, maxY - minY)
          if (!Number.isFinite(span) || span <= 0) return 'unable to measure projected extent'

          // One NDC unit is this many world units at the subject's depth.
          const worldPerNdc = Math.tan(halfFov) * distance
          offset.x -= (minX + maxX) / 2 * worldPerNdc
          offset.y -= (minY + maxY) / 2 * worldPerNdc
          distance *= span / (2 * targetFill)
        }
        pivot.position.add(offset)
        pivot.updateMatrixWorld(true)
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
    else if (argument === '--out') options.root = resolveWorkshopRoot(argv[++index])
    else if (argument === '--skip-contact-sheets') options.contactSheets = false
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/imagegen-uv/capture-theme-proofs.mjs [--theme ID] [--out DIR] [--skip-contact-sheets]')
    return
  }
  const result = await captureThemeProofs(options)
  if (result.captured.length === 0) {
    throw new Error(
      `No baked GLBs found under ${result.root}. Run \`npm run bake:theme-dice-sets\` first.`,
    )
  }
  console.log(`Captured ${result.captured.length} proof render(s): ${result.captured.join(', ')}`)
  if (result.sheets.length > 0) {
    console.log(`Wrote ${result.sheets.length} all-faces contact sheet(s) for art review`)
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} unbaked die/dice: ${result.skipped.join(', ')}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
