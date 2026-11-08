#!/usr/bin/env node
/** Offline procedural experiment, not ImageGen and not a catalog promotion. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import * as THREE from 'three'
import { chromium } from 'playwright'
import { generateAuthoringKit, validateAuthoringKit } from '../imagegen-uv/generate-authoring-kit.mjs'
import { validateCanonicalManifest } from '../imagegen-uv/canonical-validation.mjs'
import { faceNormalsFromManifest, faceNumeralBaselinesFromManifest } from '../imagegen-uv/themed-polyhedral-glb.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const EXPERIMENT_ROOT = '.artifacts/theme-workshop/experiments/woodland'
const DEFAULT_OUT = EXPERIMENT_ROOT
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEFAULT_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'

export function assertWoodManifest(manifest) {
  if (manifest.shape !== 'd6') throw new Error('Wood proof requires a canonical D6')
  const result = validateCanonicalManifest(manifest)
  if (!result.valid) throw new Error(`Invalid canonical D6: ${result.errors.join('; ')}`)
}

export function assertProofOutput(outputDir, repoRoot = REPO) {
  const root = path.resolve(repoRoot, EXPERIMENT_ROOT)
  const resolved = path.resolve(repoRoot, outputDir)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Wood D6 outputs must stay inside the woodland experiment')
  }
  return resolved
}

async function ensureOutput(outputDir) {
  const out = assertProofOutput(outputDir)
  await mkdir(out, { recursive: true })
  // Symlinks must not bypass the lexical write fence.
  if (await realpath(out) !== out) throw new Error('Symlink output outside woodland experiment is not supported')
  return out
}

async function rasterizeKit(kit, chrome) {
  // The canonical generator's --rasterize assumes downloaded Playwright Chromium.
  // Generate its exact SVGs, then rasterize with the installed Chrome instead.
  await generateAuthoringKit({ repoRoot: REPO, outputDir: kit, shapes: ['d6'] })
  const browser = await chromium.launch({ executablePath: chrome, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 2048, height: 2048 }, deviceScaleFactor: 1 })
    for (const name of ['numbered-guide', 'imagegen-input', 'mask']) {
      const svg = await readFile(path.join(kit, 'd6', `${name}.svg`), 'utf8')
      await page.setContent(`<style>html,body{margin:0;overflow:hidden}svg{display:block}</style>${svg}`)
      await page.screenshot({ path: path.join(kit, 'd6', `${name}.png`) })
    }
  } finally { await browser.close() }
  const validation = await validateAuthoringKit({ outputDir: kit, shapes: ['d6'], rasterize: true })
  if (!validation.valid) throw new Error(validation.errors.join('; '))
}

async function generateWoodMaps(manifest, out) {
  const size = manifest.canvasSize
  const glyphs = manifest.islands.map(island => {
    const { x, y } = island.center
    return `<text data-face-value="${island.faceValue}" x="${x}" y="${y + 7}" transform="rotate(${island.baselineAngleDegrees} ${x} ${y})" text-anchor="middle" dominant-baseline="middle" font-family="Georgia,serif" font-weight="bold" font-size="212" fill="white">${island.faceValue}</text>`
  }).join('\n')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="black"/>${glyphs}</svg>`
  await writeFile(path.join(out, 'canonical-numeral-mask.svg'), svg)
  const mask = await sharp(Buffer.from(svg)).flatten({ background: '#000' }).greyscale().blur(1.1).raw().toBuffer()
  const albedo = Buffer.alloc(size * size * 3)
  const roughness = Buffer.alloc(size * size)
  const height = new Float32Array(size * size)
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
  const endgrainFace = manifest.islands.find(island => island.faceValue === 6)
  const endgrainBounds = { minX: Math.min(...endgrainFace.points.map(p => p.x)) - 16, maxX: Math.max(...endgrainFace.points.map(p => p.x)) + 16, minY: Math.min(...endgrainFace.points.map(p => p.y)) - 16, maxY: Math.max(...endgrainFace.points.map(p => p.y)) + 16 }
  // Seedless analytic grain: deterministic, lighting-free and no API.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const bend = Math.sin(y * 0.010) * 21 + Math.sin(y * 0.0034 + x * 0.001) * 33
      const endgrain = x > endgrainBounds.minX && x < endgrainBounds.maxX && y > endgrainBounds.minY && y < endgrainBounds.maxY
      const radial = Math.hypot((x - endgrainFace.center.x + 290) * 1.02, (y - endgrainFace.center.y + 120) * 0.78)
      const phase = endgrain ? radial * 0.13 + Math.sin(x * 0.016 + y * 0.007) * 1.8 : (x + bend) * 0.095
      const ring = Math.sin(phase) * 0.5 + Math.sin(phase * 2.07 + Math.sin(y * 0.008)) * 0.19
      const pore = Math.pow(Math.max(0, Math.sin(phase * 6.5 + Math.sin(y * 0.032))), 16)
      const micro = Math.sin(x * 2.14 + y * 0.47) * Math.sin(x * 0.7 - y * 0.36)
      const broad = Math.sin(x * 0.014 + Math.sin(y * 0.004) * 1.8) * 6 + Math.sin(y * 0.013) * 2
      const tone = ring * 16 - pore * 22 + micro * 2.4 + broad
      const cut = mask[i] / 255
      const base = [185 + tone, 126 + tone * 0.78, 62 + tone * 0.49]
      const dark = [43 + tone * 0.12, 25 + tone * 0.08, 12 + tone * 0.05]
      for (let c = 0; c < 3; c++) albedo[i * 3 + c] = clamp(base[c] * (1 - cut) + dark[c] * cut, 0, 255)
      roughness[i] = clamp(161 + pore * 32 - ring * 8 + cut * 37, 0, 255)
      height[i] = ring * 0.027 - pore * 0.043 + micro * 0.003 - cut * 0.72
    }
  }
  const normal = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const dx = height[y * size + Math.min(size - 1, x + 1)] - height[y * size + Math.max(0, x - 1)]
      const dy = height[Math.min(size - 1, y + 1) * size + x] - height[Math.max(0, y - 1) * size + x]
      // Image +Y is down, tangent +V is up: OpenGL +Y normal needs +dh/dy.
      const n = new THREE.Vector3(-dx * 2.5, dy * 2.5, 1).normalize()
      normal[i * 3] = Math.round((n.x * 0.5 + 0.5) * 255)
      normal[i * 3 + 1] = Math.round((n.y * 0.5 + 0.5) * 255)
      normal[i * 3 + 2] = Math.round((n.z * 0.5 + 0.5) * 255)
    }
  }
  await Promise.all([
    sharp(albedo, { raw: { width: size, height: size, channels: 3 } }).png().toFile(path.join(out, 'wood-albedo.png')),
    sharp(roughness, { raw: { width: size, height: size, channels: 1 } }).png().toFile(path.join(out, 'wood-roughness.png')),
    sharp(normal, { raw: { width: size, height: size, channels: 3 } }).png().toFile(path.join(out, 'wood-normal.png')),
  ])
}

function runBlender(blender, args, logPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(blender, ['--background', '--factory-startup', '--python', path.join(REPO, 'scripts/environment-assets/blender_wood_d6.py'), '--', ...args], { cwd: REPO })
    let log = ''
    child.stdout.on('data', data => { log += data })
    child.stderr.on('data', data => { log += data })
    child.on('error', reject)
    child.on('close', async code => {
      await writeFile(logPath, log)
      if (code) reject(new Error(`Blender failed (${code}), see ${logPath}\n${log.slice(-4000)}`))
      else resolve()
    })
  })
}

/** Validate actual GLB scene-space positions, per-triangle UV/value mapping and embedded PBR maps. */
export function validateGlbContract(buffer, manifest) {
  assertWoodManifest(manifest)
  if (buffer.length < 28 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('Invalid GLB header')
  const jsonLength = buffer.readUInt32LE(12)
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
  const binary = buffer.subarray(28 + jsonLength)
  const expected = manifest.islands.flatMap(island => island.meshTriangles.map(triangle => ({ ...triangle, value: island.faceValue })))
  const close = (a, b, eps = 2e-5) => Math.abs(a - b) < eps
  const accessor = index => {
    const a = gltf.accessors[index]
    const view = gltf.bufferViews[a.bufferView]
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]
    const bytes = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType]
    if (!width || !bytes) throw new Error('Unsupported canonical GLB accessor')
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, c) => {
      const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * bytes) + c * bytes
      return a.componentType === 5126 ? binary.readFloatLE(offset) : bytes === 4 ? binary.readUInt32LE(offset) : bytes === 2 ? binary.readUInt16LE(offset) : binary[offset]
    }))
  }
  const bounds = new THREE.Box3()
  const matched = new Set()
  let triangles = 0
  const visit = (index, parent) => {
    const node = gltf.nodes[index]
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])), new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])))
    const world = parent.clone().multiply(local)
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const positions = accessor(primitive.attributes.POSITION).map(p => new THREE.Vector3(...p).applyMatrix4(world).toArray())
        positions.forEach(p => bounds.expandByPoint(new THREE.Vector3(...p)))
        const uvs = accessor(primitive.attributes.TEXCOORD_0)
        const ids = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices).flat()
        for (let i = 0; i < ids.length; i += 3) {
          const verts = ids.slice(i, i + 3)
          const match = expected.find(e => !matched.has(e.triangleIndex) && verts.every(v => e.positions.some((p, k) => p.every((n, c) => close(n, positions[v][c])) && e.uvs[k].every((n, c) => close(n, uvs[v][c])))))
          if (!match) throw new Error('Exported triangle does not match canonical scene-space position/UV/value mapping')
          const [a, b, c] = verts.map(v => new THREE.Vector3(...positions[v]))
          const normal = b.sub(a).cross(c.sub(a)).normalize()
          const expectedNormal = faceNormalsFromManifest(manifest).find(f => f.value === match.value).normal
          if (normal.dot(new THREE.Vector3(...expectedNormal)) < 0.9999) throw new Error('Exported canonical face winding/axes changed')
          matched.add(match.triangleIndex)
          triangles++
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, new THREE.Matrix4())
  const size = bounds.getSize(new THREE.Vector3()).toArray()
  if (triangles !== 12 || !size.every(v => close(v, 1)) || !bounds.min.toArray().every(v => close(v, -0.5)) || !bounds.max.toArray().every(v => close(v, 0.5))) throw new Error('Exported canonical bounds/triangle count changed')
  const material = gltf.materials[0]
  if (material.normalTexture === undefined || material.pbrMetallicRoughness?.baseColorTexture === undefined || material.pbrMetallicRoughness?.metallicRoughnessTexture === undefined) throw new Error('GLB must embed albedo, tangent normal and roughness maps')
  for (const image of gltf.images) if (image.bufferView === undefined) throw new Error('GLB image must be embedded')
  return { axes: 'canonical Three.js Y-up preserved in scene space', scale: 1.1, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size }, triangles, faceValues: manifest.faceValues, faceNormals: faceNormalsFromManifest(manifest), embeddedImages: gltf.images.length }
}

function proofHtml(faces) {
  return `<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;background:#20272a}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><script type="module">
import * as THREE from 'three'; import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); renderer.setSize(720,720); renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15; document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color('#20272a'); const camera=new THREE.OrthographicCamera(-.78,.78,.78,-.78,.1,100); camera.position.set(0,0,5); camera.lookAt(0,0,0);
scene.add(new THREE.AmbientLight(0xffffff,1.25)); const key=new THREE.DirectionalLight(0xfff1dc,2.4); key.position.set(2,3,5); scene.add(key); const fill=new THREE.DirectionalLight(0xe3edff,1.0);fill.position.set(-3,1,2);scene.add(fill);
const pivot=new THREE.Group();scene.add(pivot); const gltf=await new GLTFLoader().loadAsync('/model.glb');pivot.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
const bounds=new THREE.Box3().setFromObject(gltf.scene);gltf.scene.scale.setScalar(1.1);gltf.scene.updateMatrixWorld(true);const worldBounds=new THREE.Box3().setFromObject(gltf.scene);const materials=[];gltf.scene.traverse(mesh=>{if(mesh.isMesh){for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) materials.push({name:m.name,albedo:!!m.map,normalMap:!!m.normalMap,roughnessMap:!!m.roughnessMap,normalScale:m.normalScale.toArray(),albedoSize:[m.map.image.width,m.map.image.height]})}});
window.__receipt={bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new THREE.Vector3()).toArray()},worldBounds:{min:worldBounds.min.toArray(),max:worldBounds.max.toArray(),size:worldBounds.getSize(new THREE.Vector3()).toArray()},materials,faces:[],errors:[]};
window.__normalReliefProof=()=>{renderer.render(scene,camera);const gl=renderer.getContext();const before=new Uint8Array(720*720*4);const after=new Uint8Array(before.length);gl.readPixels(0,0,720,720,gl.RGBA,gl.UNSIGNED_BYTE,before);const saved=[];gltf.scene.traverse(mesh=>{if(mesh.isMesh)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){saved.push([m,m.normalMap]);m.normalMap=null;m.needsUpdate=true}});renderer.render(scene,camera);gl.readPixels(0,0,720,720,gl.RGBA,gl.UNSIGNED_BYTE,after);for(const [m,map] of saved){m.normalMap=map;m.needsUpdate=true}let changed=0;for(let i=0;i<before.length;i+=4)if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>4)changed++;renderer.render(scene,camera);window.__receipt.normalReliefDeltaPixels=changed;return changed;};
const faces=${JSON.stringify(faces)};
window.__renderFace=value=>{const face=faces.find(f=>f.value===value);const aim=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...face.normal),new THREE.Vector3(0,0,1));const baseline=new THREE.Vector3(...face.baseline).applyQuaternion(aim);const roll=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.atan2(baseline.y,baseline.x));pivot.quaternion.copy(roll.multiply(aim));pivot.updateMatrixWorld(true);renderer.render(scene,camera);window.__receipt.faces.push({value,normal:face.normal,baseline:face.baseline,quaternion:pivot.quaternion.toArray()});};
window.__renderHero=()=>{pivot.quaternion.setFromEuler(new THREE.Euler(.45,-.57,-.12));renderer.render(scene,camera)};window.__ready=true;
</script></html>`
}

async function captureRuntime(out, manifest, chrome) {
  const faces = faceNormalsFromManifest(manifest).map(f => ({ ...f, baseline: faceNumeralBaselinesFromManifest(manifest).find(b => b.value === f.value).baseline }))
  const html = proofHtml(faces)
  await writeFile(path.join(out, 'proof.html'), html)
  const browser = await chromium.launch({ executablePath: chrome, headless: true })
  const errors = []
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 })
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname !== 'wood-d6.local') return route.abort()
      let file
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      if (url.pathname === '/model.glb') file = path.join(out, 'wood-d6.glb')
      else if (url.pathname.startsWith('/three/') && !url.pathname.includes('..')) file = path.join(REPO, 'node_modules', url.pathname)
      else return route.fulfill({ status: 404, body: 'Not found' })
      await route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary', body: await readFile(file) })
    })
    await page.goto('http://wood-d6.local/')
    await page.waitForFunction(() => window.__ready, { timeout: 45000 })
    await mkdir(path.join(out, 'faces'), { recursive: true })
    for (const face of faces) {
      await page.evaluate(value => window.__renderFace(value), face.value)
      await page.screenshot({ path: path.join(out, 'faces', `face-${face.value}.png`) })
    }
    await page.evaluate(() => window.__renderHero())
    await page.screenshot({ path: path.join(out, 'three-hero.png') })
    await page.evaluate(() => window.__normalReliefProof())
    const receipt = await page.evaluate(() => window.__receipt)
    receipt.errors.push(...errors)
    if (receipt.errors.length) throw new Error(`Three runtime errors: ${receipt.errors.join('; ')}`)
    if (!receipt.bounds.size.every(n => Math.abs(n - 1) < 1e-5) || !receipt.worldBounds.size.every(n => Math.abs(n - 1.1) < 1e-5)) throw new Error('Three GLTFLoader unit/world bounds do not match canonical scale policy')
    await writeFile(path.join(out, 'runtime-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
    const composites = []
    for (const [i, face] of faces.entries()) {
      const tile = await sharp(path.join(out, 'faces', `face-${face.value}.png`)).resize(400, 400).png().toBuffer()
      composites.push({ input: tile, left: (i % 3) * 400, top: Math.floor(i / 3) * 450 + 50 })
      const label = `<svg width="400" height="50"><rect width="400" height="50" fill="#20272a"/><text x="200" y="33" text-anchor="middle" fill="#ede5d6" font-family="Arial" font-size="22">Canonical face ${face.value}</text></svg>`
      composites.push({ input: Buffer.from(label), left: (i % 3) * 400, top: Math.floor(i / 3) * 450 })
    }
    await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#20272a' } }).composite(composites).png().toFile(path.join(out, 'all-faces-contact-sheet.png'))
    return receipt
  } finally { await browser.close() }
}

export async function runWoodProof(options = {}) {
  const out = await ensureOutput(options.outputDir ?? DEFAULT_OUT)
  const kit = await ensureOutput(`${EXPERIMENT_ROOT}/kit`)
  const chrome = options.chrome ?? process.env.WOOD_D6_CHROME ?? DEFAULT_CHROME
  await rasterizeKit(kit, chrome)
  const manifestPath = path.join(kit, 'd6', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assertWoodManifest(manifest)
  await generateWoodMaps(manifest, out)
  await runBlender(options.blender ?? process.env.WOOD_D6_BLENDER ?? DEFAULT_BLENDER, ['--manifest', manifestPath, '--out', out], path.join(out, 'blender.log'))
  const glb = path.join(out, 'wood-d6.glb')
  const contract = validateGlbContract(await readFile(glb), manifest)
  const metadata = { version: '1.0', diceType: 'd6', name: 'Woodland honey oak D6 (procedural proof)', artist: 'Procedural Blender experiment (not ImageGen)', created: new Date().toISOString().slice(0, 10), scale: 1.1, faceNormals: contract.faceNormals, physics: { density: 0.3, restitution: 0.3, friction: 0.6 }, colliderType: 'cuboid', colliderArgs: { halfExtents: [0.55, 0.55, 0.55] }, canonicalReferenceVersion: 2, tags: ['dev-only', 'procedural-proof'] }
  await writeFile(path.join(out, 'wood-d6.metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  const runtime = await captureRuntime(out, manifest, chrome)
  const materialMaps = {}
  for (const name of ['albedo', 'normal', 'roughness']) {
    const file = path.join(out, `wood-${name}.png`)
    const info = await sharp(file).metadata()
    materialMaps[name] = { path: file, dimensions: [info.width, info.height], bytes: (await stat(file)).size, colorSpace: name === 'albedo' ? 'sRGB' : 'linear data', ...(name === 'normal' ? { convention: 'tangent-space OpenGL +Y' } : {}) }
  }
  const result = { version: 1, kind: 'woodland-d6-offline-proof', procedural: true, provenance: 'Analytic wood grain + canonical SVG numerals; Blender material/GLB export; no ImageGen or external API calls.', sourceManifest: manifestPath, sourceManifestSha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex'), generatedAt: new Date().toISOString(), scalePolicy: 'unit vertices; metadata.scale=1.1; apply exactly once for world edge 1.1', geometryPolicy: 'canonical sharp 12-triangle cube; visual grain/carved numeral normal relief only', outputs: { blend: path.join(out, 'wood-d6.blend'), glb, metadata: path.join(out, 'wood-d6.metadata.json'), contactSheet: path.join(out, 'all-faces-contact-sheet.png'), blenderHero: path.join(out, 'blender-hero.png'), threeHero: path.join(out, 'three-hero.png'), proofHtml: path.join(out, 'proof.html') }, materialMaps, glbBytes: (await stat(glb)).size, contract, runtime, blender: JSON.parse(await readFile(path.join(out, 'blender-receipt.json'), 'utf8')) }
  await writeFile(path.join(out, 'provenance.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args[0] === '--help') console.log('node scripts/environment-assets/wood-d6.mjs [--out .artifacts/theme-workshop/experiments/woodland/d6]')
  else {
    if (args.length && (args[0] !== '--out' || args.length !== 2)) throw new Error('Expected --out DIR or no arguments')
    const result = await runWoodProof({ outputDir: args[1] })
    console.log(JSON.stringify({ outputs: result.outputs, glbBytes: result.glbBytes, contract: result.contract, runtimeFaces: result.runtime.faces.length }, null, 2))
  }
}
