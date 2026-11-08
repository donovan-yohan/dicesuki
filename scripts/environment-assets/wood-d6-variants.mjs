#!/usr/bin/env node
/** Offline, dev-only derivatives; never rewrites the raw Blender proof. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir, realpath, mkdtemp, rm, rename, lstat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { EXPERIMENT_ROOT, validateGlbContract } from './wood-d6.mjs'
import { chromium } from 'playwright'
import { faceNormalsFromManifest, faceNumeralBaselinesFromManifest } from '../imagegen-uv/themed-polyhedral-glb.mjs'

const exec = promisify(execFile)
const hash = buffer => createHash('sha256').update(buffer).digest('hex')

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const VARIANT_ROOT = '.artifacts/theme-workshop/experiments/woodland/variants'

export function assertVariantOutput(outputDir) {
  const root = path.resolve(REPO, VARIANT_ROOT)
  const resolved = path.resolve(REPO, outputDir)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Wood D6 outputs must stay inside the woodland variants subtree')
  }
  return resolved
}

async function ensureOutput(outputDir) {
  const out = assertVariantOutput(outputDir)
  // Resolve the nearest existing ancestor BEFORE mkdir, preventing symlink writes.
  let ancestor = out
  for (;;) {
    try {
      await lstat(ancestor)
      if (await realpath(ancestor) !== ancestor) throw new Error('Symlink output is not supported in woodland variants')
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      ancestor = path.dirname(ancestor)
    }
  }
  await mkdir(out, { recursive: true })
  if (await realpath(out) !== out) throw new Error('Symlink output is not supported in woodland variants')
  return out
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, contents, { flag: 'wx' })
  await rename(temporary, file)
}

function parseGlb(buffer) {
  const jsonLength = buffer.readUInt32LE(12)
  return { json: JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength)), binary: buffer.subarray(28 + jsonLength) }
}

function embeddedSlot(buffer, slot) {
  const { json, binary } = parseGlb(buffer)
  const material = json.materials[0]
  const textureIndex = (slot === 'normalTexture' ? material : material.pbrMetallicRoughness)[slot].index
  const texture = json.textures[textureIndex]
  const image = json.images[texture.extensions?.EXT_texture_webp?.source ?? texture.source]
  if (image.bufferView === undefined || image.uri) throw new Error(`${slot} must be embedded`)
  const view = json.bufferViews[image.bufferView]
  return { textureIndex, mimeType: image.mimeType, bytes: binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) }
}

function attributeValues(buffer, index) {
  const { json, binary } = parseGlb(buffer)
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type]
  const readers = { 5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2], 5121: ['readUInt8', 1] }
  const [method, bytes] = readers[accessor.componentType] ?? []
  if (!components || !method || accessor.sparse || accessor.normalized) throw new Error('Unsupported unchanged attribute accessor')
  return Array.from({ length: accessor.count }, (_, vertex) => Array.from({ length: components }, (_, component) => binary[method]((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + vertex * (view.byteStride ?? components * bytes) + component * bytes)))
}

function assertUnchangedAttributes(source, target) {
  const sourcePrimitives = parseGlb(source).json.meshes.flatMap(mesh => mesh.primitives)
  const targetPrimitives = parseGlb(target).json.meshes.flatMap(mesh => mesh.primitives)
  if (sourcePrimitives.length !== targetPrimitives.length) throw new Error('Geometry primitive count changed')
  const names = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'indices']
  for (const [index, primitive] of sourcePrimitives.entries()) {
    for (const name of names) {
      const sourceIndex = name === 'indices' ? primitive.indices : primitive.attributes[name]
      const targetIndex = name === 'indices' ? targetPrimitives[index].indices : targetPrimitives[index].attributes[name]
      if (sourceIndex === undefined || targetIndex === undefined || !isDeepStrictEqual(attributeValues(source, sourceIndex), attributeValues(target, targetIndex))) throw new Error(`Geometry attribute changed: ${name}`)
    }
  }
  return names
}

/** Reuse the installed CLI, with explicit slots; no geometry optimization/compression. */
export async function buildWoodVariants(options = {}) {
  const out = await ensureOutput(options.outputDir ?? VARIANT_ROOT)
  const sourcePath = path.join(REPO, EXPERIMENT_ROOT, 'wood-d6.glb')
  const metadataPath = path.join(REPO, EXPERIMENT_ROOT, 'wood-d6.metadata.json')
  const manifestPath = path.join(REPO, EXPERIMENT_ROOT, 'kit/d6/manifest.json')
  const source = await readFile(sourcePath)
  const metadataBytes = await readFile(metadataPath)
  const metadata = JSON.parse(metadataBytes)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes)
  validateGlbContract(source, manifest)
  if (metadata.scale !== 1.1) throw new Error('Raw metadata.scale must remain 1.1')
  const cli = path.join(REPO, 'node_modules/.bin/gltf-transform')
  const run = async args => (await exec(cli, args, { cwd: REPO, env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 8 * 1024 * 1024 })).stdout.trim()
  const version = await run(['--version'])
  if (version !== '4.4.1') throw new Error(`Expected @gltf-transform/cli 4.4.1, got ${version}`)
  const result = {
    version: 1, kind: 'woodland-d6-optimized-variants',
    source: { path: path.relative(REPO, sourcePath), bytes: source.length, sha256: hash(source), metadataSha256: hash(metadataBytes), manifestSha256: hash(manifestBytes) },
    tool: { name: '@gltf-transform/cli', version },
    scale: metadata.scale, scalePolicy: 'unit canonical geometry; apply unchanged metadata.scale=1.1 exactly once',
    optimization: { baseColor: { format: 'webp', quality: 80, effort: 80 }, normalAndRoughness: { format: 'webp', lossless: true, effort: 80 }, geometryCompression: 'none' },
    variants: [], receiptPath: path.relative(REPO, path.join(out, 'variant-receipt.json')),
  }
  const temporary = await mkdtemp(path.join(out, '.build-'))
  try {
    for (const [tier, dimension] of [['mobile', 512], ['desktop', 1024]]) {
      const resized = path.join(temporary, `${tier}-resized.glb`)
      const baseColor = path.join(temporary, `${tier}-base-color.glb`)
      const model = path.join(temporary, `${tier}.glb`)
      const commands = [
        ['resize', sourcePath, resized, '--width', String(dimension), '--height', String(dimension), '--filter', 'lanczos3'],
        ['webp', resized, baseColor, '--slots', 'baseColorTexture', '--quality', '80', '--effort', '80'],
        ['webp', baseColor, model, '--slots', '{normalTexture,metallicRoughnessTexture}', '--lossless', '--effort', '80'],
      ]
      for (const args of commands) await run(args)
      const buffer = await readFile(model)
      const contract = validateGlbContract(buffer, manifest)
      const preservedAttributes = assertUnchangedAttributes(source, buffer)
      if (buffer.length >= source.length) throw new Error(`${tier} variant must be smaller than raw GLB`)
      const resizedBuffer = await readFile(resized)
      const images = []
      for (const slot of ['baseColorTexture', 'normalTexture', 'metallicRoughnessTexture']) {
        const image = embeddedSlot(buffer, slot)
        const info = await sharp(image.bytes).metadata()
        if (image.mimeType !== 'image/webp' || info.format !== 'webp' || info.width !== dimension || info.height !== dimension) throw new Error(`${tier} ${slot}: expected embedded ${dimension}px WebP`)
        const record = { slot, textureIndex: image.textureIndex, mimeType: image.mimeType, dimensions: [info.width, info.height], bytes: image.bytes.length }
        if (slot !== 'baseColorTexture') {
          const before = await sharp(embeddedSlot(resizedBuffer, slot).bytes).ensureAlpha().raw().toBuffer()
          const after = await sharp(image.bytes).ensureAlpha().raw().toBuffer()
          record.losslessPixelMatch = before.equals(after)
          if (!record.losslessPixelMatch) throw new Error(`${tier} ${slot}: data map lossless pixel mismatch`)
        }
        images.push(record)
      }
      const target = path.join(out, `${tier}.glb`)
      await atomicWrite(target, buffer)
      result.variants.push({ tier, dimension, path: path.relative(REPO, target), bytes: buffer.length, sha256: hash(buffer), preservedAttributes, contract, images })
    }
    if (hash(await readFile(sourcePath)) !== hash(source) || hash(await readFile(metadataPath)) !== hash(metadataBytes)) throw new Error('Raw proof inputs changed during optimization')
    await atomicWrite(path.join(out, 'variant-receipt.json'), `${JSON.stringify(result, null, 2)}\n`)
    return result
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

function proofHtml(face) {
  return `<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;background:#20272a}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setSize(720,720); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#20272a');
const camera=new THREE.OrthographicCamera(-.95,.95,.95,-.95,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
scene.add(new THREE.AmbientLight(0xffffff,1.25));
const key=new THREE.DirectionalLight(0xfff1dc,2.4);key.position.set(2,3,5);scene.add(key);
const fill=new THREE.DirectionalLight(0xe3edff,1);fill.position.set(-3,1,2);scene.add(fill);
const pivot=new THREE.Group();scene.add(pivot);
const gltf=await new GLTFLoader().loadAsync('/model.glb');pivot.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
const box=b=>({min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()});
const bounds=box(new THREE.Box3().setFromObject(gltf.scene));
gltf.scene.scale.setScalar(1.1);gltf.scene.updateMatrixWorld(true);
const worldBounds=box(new THREE.Box3().setFromObject(gltf.scene));
const materials=[];gltf.scene.traverse(mesh=>{if(mesh.isMesh)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(!materials.includes(m))materials.push(m)});
const mapInfo=map=>map?{dimensions:[map.image.width,map.image.height],colorSpace:map.colorSpace}:null;
window.__receipt={bounds,worldBounds,materials:materials.map(m=>({name:m.name,albedo:mapInfo(m.map),normal:mapInfo(m.normalMap),roughness:mapInfo(m.roughnessMap),normalScale:m.normalScale.toArray()})),faces:[],pixels:{},errors:[]};
const pixels=()=>{const gl=renderer.getContext();const data=new Uint8Array(720*720*4);gl.readPixels(0,0,720,720,gl.RGBA,gl.UNSIGNED_BYTE,data);return data};
const pixelProof=()=>{const data=pixels();const colors=new Set();let foreground=0;for(let i=0;i<data.length;i+=4){const distance=Math.abs(data[i]-data[0])+Math.abs(data[i+1]-data[1])+Math.abs(data[i+2]-data[2]);if(distance>10){foreground++;colors.add((data[i]<<16)|(data[i+1]<<8)|data[i+2])}}return {foreground,colors:colors.size}};
const face=${JSON.stringify(face)};
window.__renderFace=()=>{const aim=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...face.normal),new THREE.Vector3(0,0,1));const baseline=new THREE.Vector3(...face.baseline).applyQuaternion(aim);const roll=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.atan2(baseline.y,baseline.x));pivot.quaternion.copy(roll.multiply(aim));pivot.updateMatrixWorld(true);renderer.render(scene,camera);window.__receipt.faces.push({...face,quaternion:pivot.quaternion.toArray()});window.__receipt.pixels.face6=pixelProof()};
window.__renderHero=()=>{pivot.quaternion.setFromEuler(new THREE.Euler(.45,-.57,-.12));pivot.updateMatrixWorld(true);renderer.render(scene,camera);window.__receipt.pixels.hero=pixelProof()};
window.__proveDataMaps=()=>{for(const slot of ['normalMap','roughnessMap']){renderer.render(scene,camera);const before=pixels();const saved=materials.map(m=>[m,m[slot]]);for(const [m]of saved){m[slot]=null;m.needsUpdate=true}renderer.render(scene,camera);const after=pixels();let changed=0;for(let i=0;i<before.length;i+=4)if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>4)changed++;for(const [m,map]of saved){m[slot]=map;m.needsUpdate=true}window.__receipt[slot==='normalMap'?'normalReliefDeltaPixels':'roughnessDeltaPixels']=changed}renderer.render(scene,camera)};
window.__ready=true;
</script></html>`
}

/** Read existing validated variants and exercise the actual WebP GLTFLoader path. */
export async function captureWoodVariantProof(options = {}) {
  const out = await ensureOutput(options.outputDir ?? VARIANT_ROOT)
  const receiptPath = path.join(out, 'variant-receipt.json')
  const result = JSON.parse(await readFile(receiptPath, 'utf8'))
  const manifest = JSON.parse(await readFile(path.join(REPO, EXPERIMENT_ROOT, 'kit/d6/manifest.json'), 'utf8'))
  const face = faceNormalsFromManifest(manifest).find(face => face.value === 6)
  face.baseline = faceNumeralBaselinesFromManifest(manifest).find(face => face.value === 6).baseline
  const html = proofHtml(face)
  await atomicWrite(path.join(out, 'proof.html'), html)
  const executable = options.chrome ?? process.env.WOOD_D6_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await chromium.launch({ executablePath: executable, headless: true })
  result.browser = { executable, version: browser.version(), network: 'fixed local route fulfillment; no server' }
  const modules = new Map([
    ['/three/build/three.module.js', 'three/build/three.module.js'],
    ['/three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/loaders/GLTFLoader.js'],
    ['/three/examples/jsm/utils/BufferGeometryUtils.js', 'three/examples/jsm/utils/BufferGeometryUtils.js'],
  ])
  try {
    for (const variant of result.variants) {
      const buffer = await readFile(path.join(out, `${variant.tier}.glb`))
      if (hash(buffer) !== variant.sha256) throw new Error(`${variant.tier} receipt/model hash mismatch`)
      validateGlbContract(buffer, manifest)
      const errors = []
      const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 })
      page.on('pageerror', error => errors.push(String(error)))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.hostname !== 'wood-d6-variants.local') { errors.push(`Unexpected network request: ${url}`); return route.abort() }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/model.glb') return route.fulfill({ contentType: 'model/gltf-binary', body: buffer })
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
        const module = modules.get(url.pathname)
        if (module) return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(REPO, 'node_modules', module)) })
        errors.push(`Unexpected local request: ${url.pathname}`)
        return route.fulfill({ status: 404, body: 'Not found' })
      })
      try {
        await page.goto('http://wood-d6-variants.local/')
        await page.waitForFunction(() => window.__ready, null, { timeout: 45000 })
        variant.proofs = {}
        for (const [view, action] of [['face6', '__renderFace'], ['hero', '__renderHero']]) {
          await page.evaluate(action => window[action](), action)
          const file = path.join(out, `${variant.tier}-${view}.png`)
          await atomicWrite(file, await page.screenshot())
          variant.proofs[view] = path.relative(REPO, file)
        }
        await page.evaluate(() => window.__proveDataMaps())
        variant.runtime = await page.evaluate(() => window.__receipt)
        variant.runtime.errors.push(...errors)
        if (errors.length) throw new Error(`Browser proof failed: ${errors.join('; ')}`)
        for (const size of [variant.runtime.bounds.size, variant.runtime.worldBounds.size]) {
          const expected = size === variant.runtime.bounds.size ? 1 : 1.1
          if (!size.every(v => Math.abs(v - expected) < 1e-5)) throw new Error('Runtime unit/world size policy changed')
        }
        if (variant.runtime.materials.length === 0 || variant.runtime.materials.some(m => ['albedo', 'normal', 'roughness'].some(slot => !m[slot] || m[slot].dimensions.some(n => n !== variant.dimension)))) throw new Error('Runtime GLTFLoader PBR maps missing or incorrect dimensions')
        if (variant.runtime.normalReliefDeltaPixels <= 100 || variant.runtime.roughnessDeltaPixels <= 100) throw new Error('Runtime normal/roughness shading not exercised')
        for (const proof of Object.values(variant.runtime.pixels)) if (proof.foreground <= 10000 || proof.colors <= 100) throw new Error('Runtime canvas is blank or unshaded')
      } finally { await page.close() }
    }
    const composites = []
    for (const [row, variant] of result.variants.entries()) {
      for (const [column, view] of ['face6', 'hero'].entries()) {
        composites.push({ input: await sharp(path.join(REPO, variant.proofs[view])).resize(400, 400).png().toBuffer(), left: column * 400, top: row * 450 + 50 })
        const label = `<svg width="400" height="50"><rect width="400" height="50" fill="#20272a"/><text x="200" y="32" text-anchor="middle" font-family="Arial" font-size="20" fill="#ede5d6">${variant.tier} ${variant.dimension}px / ${view}</text></svg>`
        composites.push({ input: Buffer.from(label), left: column * 400, top: row * 450 })
      }
    }
    const sheet = path.join(out, 'variant-proof.png')
    await sharp({ create: { width: 800, height: 900, channels: 3, background: '#20272a' } }).composite(composites).png().toFile(sheet)
    result.proofContactSheet = path.relative(REPO, sheet)
    await atomicWrite(receiptPath, `${JSON.stringify(result, null, 2)}\n`)
    return result
  } finally { await browser.close() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args[0] === '--help') console.log('node scripts/environment-assets/wood-d6-variants.mjs [--out .artifacts/theme-workshop/experiments/woodland/variants/SUBDIR]\nRequires existing raw wood-d6.glb/metadata/kit, installed gltf-transform 4.4.1 and Chrome. Builds both tiers and browser proof; never starts a server or rewrites raw outputs.')
  else {
    if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1])) throw new Error('Expected --out DIR or no arguments')
    const options = { outputDir: args[1] }
    await buildWoodVariants(options)
    const result = await captureWoodVariantProof(options)
    console.log(JSON.stringify({ variants: result.variants.map(v => ({ tier: v.tier, bytes: v.bytes, path: v.path, images: v.images, runtime: v.runtime, proofs: v.proofs })), receiptPath: result.receiptPath, proofContactSheet: result.proofContactSheet }, null, 2))
  }
}
