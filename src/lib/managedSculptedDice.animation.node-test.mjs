import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

// Actual GLTFLoader, authored keys and production owner in Chrome, not clip-count mocks.
it('animates all 21 authored Monster eyes across six faces without moving the rigid die', { timeout: 30000 }, async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const models = {
    '/original.glb': readFileSync(new URL('../../public/dice/devil-set/devil-d6/model.glb', import.meta.url)),
    '/managed.glb': readFileSync(new URL('../../public/dice/monster-dungeon-set/d6/model.glb', import.meta.url)),
  }
  const source = `
    import * as T from 'three';
    import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
    import { createManagedSculptedVisual } from './src/lib/managedSculptedDice';
    const faces = [['1_eye'], ['eye2_1', 'eye2_2'], ['eye31', 'eye32', 'eye33'],
      ['eye4_1', 'eye4_2', 'eye4_3', 'eye4_4'], ['eye5_1', 'eye5_2', 'eye5_3', 'eye5_4', 'eye5_5'],
      ['eye6_1', 'eye62', 'eye63', 'eye64', 'eye65', 'eye66']];
    const names = faces.flat();
    const [original, gltf] = await Promise.all(['/original.glb', '/managed.glb'].map(url => new GLTFLoader().loadAsync(url)));
    const asset = { id: 'monster-dungeon-set/d6', metadata: { setId: 'monster-dungeon-set', diceType: 'd6' } };
    const owned = createManagedSculptedVisual(gltf.scene, asset, true, gltf.animations);
    const peer = createManagedSculptedVisual(gltf.scene, asset, true, gltf.animations);
    const pose = object => [object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()];
    const poses = root => { const values = {}; root.traverse(object => { values[object.name] = pose(object) }); return values };
    const cachedPose = poses(gltf.scene);
    const clipsJSON = JSON.stringify(gltf.animations.map(T.AnimationClip.toJSON));
    const initial = poses(owned.scene);
    const originalKeysMatch = JSON.stringify(original.animations.map(T.AnimationClip.toJSON).map(({uuid, ...clip}) => clip)) === JSON.stringify(gltf.animations.map(T.AnimationClip.toJSON).map(({uuid, ...clip}) => clip));
    const parent = new T.Group(); parent.position.set(3, 5, -2); parent.rotation.set(.2, -.3, .4); parent.scale.setScalar(1.3); parent.add(owned.scene);
    const parentPose = pose(parent);
    const sourceMaterialEvents = [], ownedMaterialEvents = [];
    const sourceMaterials = new Set(), ownedMaterials = new Set();
    gltf.scene.traverse(o => { if (o.isMesh) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => sourceMaterials.add(m));
      o.geometry.addEventListener('dispose', () => sourceMaterialEvents.push('geometry'));
    }});
    owned.scene.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => ownedMaterials.add(m)) });
    sourceMaterials.forEach(m => m.addEventListener('dispose', () => sourceMaterialEvents.push(m.uuid)));
    ownedMaterials.forEach(m => m.addEventListener('dispose', () => ownedMaterialEvents.push(m.uuid)));
    const maxAngles = Object.fromEntries(names.map(name => [name, 0]));
    let authoredMaxError = 0, fixedPose = true, profilePreservesPhase = true, pausedStable = true;
    const readEyes = () => names.map(name => owned.scene.getObjectByName(name).quaternion.toArray());
    const tracks = names.map(name => original.animations.find(c => c.name === name + 'Action').tracks.find(t => t.name === name + '.quaternion'));
    const interpolants = tracks.map(track => track.createInterpolant());
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640); renderer.setPixelRatio(1); renderer.setScissorTest(true);
    renderer.setClearColor('#1c2028'); document.body.style.margin = '0'; document.body.appendChild(renderer.domElement);
    const world = new T.Scene(); world.add(parent); // Keep the sentinel physics parent mounted throughout.
    world.add(new T.HemisphereLight('#d7e8ff', '#84634b', 2));
    const key = new T.DirectionalLight('#fff2d4', 3); world.add(key);
    world.updateMatrixWorld(true);
    const center = new T.Vector3(); owned.scene.getObjectByName('BODY').getWorldPosition(center);
    key.position.copy(center).add(new T.Vector3(3, 5, 4)); key.target.position.copy(center); world.add(key.target);
    const cameras = faces.map(face => {
      const direction = new T.Vector3(); face.forEach(name => direction.add(owned.scene.getObjectByName(name).getWorldPosition(new T.Vector3())));
      direction.divideScalar(face.length).sub(center).normalize();
      const camera = new T.PerspectiveCamera(34, 1, .01, 30);
      if (Math.abs(direction.y) > .9) camera.up.set(0, 0, -1);
      camera.position.copy(center).addScaledVector(direction, 3.4); camera.lookAt(center); return camera;
    });
    const draw = () => {
      cameras.forEach((camera, i) => {
        const x = (i % 3) * 320, y = i < 3 ? 320 : 0;
        renderer.setViewport(x, y, 320, 320); renderer.setScissor(x, y, 320, 320); renderer.render(world, camera);
      });
      return renderer.domElement.toDataURL('image/png');
    };
    const frames = [{ time: 0, image: draw() }];
    const pixels = () => {
      const gl = renderer.getContext(), bytes = new Uint8Array(960 * 640 * 4);
      gl.readPixels(0, 0, 960, 640, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      if (gl.getError() !== 0) throw new Error('Monster eye WebGL readback failed');
      return bytes;
    };
    const firstPixels = pixels(), faceChangedPixels = Array(6).fill(0);
    for (let step = 1; step <= 240; step++) {
      owned.update(1/60, false);
      const time = (step / 60) % original.animations[0].duration;
      names.forEach((name, i) => {
        const node = owned.scene.getObjectByName(name);
        maxAngles[name] = Math.max(maxAngles[name], node.quaternion.angleTo(new T.Quaternion(...initial[name][1])));
        const expected = interpolants[i].evaluate(time);
        node.quaternion.toArray().forEach((value, j) => { authoredMaxError = Math.max(authoredMaxError, Math.abs(value - expected[j])) });
      });
      owned.scene.traverse(object => {
        const current = pose(object), start = initial[object.name];
        if (names.includes(object.name)) { if (JSON.stringify([current[0], current[2]]) !== JSON.stringify([start[0], start[2]])) fixedPose = false; }
        else if (JSON.stringify(current) !== JSON.stringify(start)) fixedPose = false;
      });
      if (step === 48 || step === 96 || step === 144) {
        frames.push({ time: step/60, image: draw() });
        const currentPixels = pixels(), changed = Array(6).fill(0);
        for (let y = 0; y < 640; y++) for (let x = 0; x < 960; x++) {
          const i = (y * 960 + x) * 4;
          if (Math.abs(currentPixels[i] - firstPixels[i]) + Math.abs(currentPixels[i+1] - firstPixels[i+1]) + Math.abs(currentPixels[i+2] - firstPixels[i+2]) > 12) changed[(y >= 320 ? 0 : 3) + Math.floor(x/320)]++;
        }
        changed.forEach((count, i) => { faceChangedPixels[i] = Math.max(faceChangedPixels[i], count) });
      }
      if (step === 60) {
        const before = JSON.stringify(readEyes());
        owned.setLightingResponse('night'); owned.setLightingResponse('original');
        profilePreservesPhase = before === JSON.stringify(readEyes());
        for (let pause = 0; pause < 120; pause++) owned.update(1/60, true);
        pausedStable = before === JSON.stringify(readEyes());
      }
    }
    const parentUnchanged = JSON.stringify(pose(parent)) === JSON.stringify(parentPose);
    const frozenPeer = names.every(name => JSON.stringify(pose(peer.scene.getObjectByName(name))) === JSON.stringify(cachedPose[name]));
    const sourceUnchanged = JSON.stringify(poses(gltf.scene)) === JSON.stringify(cachedPose);
    const clipsUnchanged = clipsJSON === JSON.stringify(gltf.animations.map(T.AnimationClip.toJSON));
    owned.dispose(); owned.dispose(); const retired = JSON.stringify(readEyes());
    for (let i = 0; i < 120; i++) owned.update(1/60, false);
    const retiredStable = retired === JSON.stringify(readEyes());
    const peerBefore = names.map(name => peer.scene.getObjectByName(name).quaternion.clone());
    for (let i = 0; i < 60; i++) peer.update(1/60, false);
    const livePeerMoves = names.every((name, i) => peer.scene.getObjectByName(name).quaternion.angleTo(peerBefore[i]) > .001);
    window.result = { originalKeysMatch, originalClipCount: original.animations.length, maxAngles, authoredMaxError, faceChangedPixels,
      fixedPose, parentUnchanged, profilePreservesPhase, pausedStable, frozenPeer, sourceUnchanged, clipsUnchanged,
      retiredStable, livePeerMoves, sourceDisposals: sourceMaterialEvents.length,
      ownedMaterialCount: ownedMaterials.size, ownedDisposals: ownedMaterialEvents.length,
      uniqueOwnedDisposals: new Set(ownedMaterialEvents).size, frames, webgl: renderer.getContext().getParameter(renderer.getContext().VERSION) };
    peer.dispose(); renderer.dispose();
  `
  const baseline = process.env.EYES_BASELINE_SOURCE
  const bundled = await build({
    stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false,
    plugins: baseline ? [{ name: 'preserved-animation-owner', setup(builder) {
      builder.onLoad({ filter: /\/managedSculptedDice\.ts$/ }, () => ({ contents: readFileSync(baseline, 'utf8'), loader: 'ts', resolveDir: root + 'src/lib' }))
    } }] : [],
  })
  const server = createServer((req, res) => {
    if (models[req.url]) { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(models[req.url]) }
    else if (req.url === '/proof.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundled.outputFiles[0].contents) }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<title>Source-bound Monster eye animation gallery — faces 1–6</title><script type="module" src="/proof.js"></script>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME ?? (existsSync(chrome) ? chrome : undefined) })
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const address = server.address()
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.waitForFunction(() => 'result' in window)
    const result = await page.evaluate(() => window.result)
    const { frames, ...metrics } = result
    console.log(JSON.stringify(metrics))
    if (process.env.EYES_PROOF_OUTPUT) {
      mkdirSync(process.env.EYES_PROOF_OUTPUT, { recursive: true })
      writeFileSync(`${process.env.EYES_PROOF_OUTPUT}/metrics.json`, JSON.stringify({ ...metrics,
        errors, sourceSha256: createHash('sha256').update(readFileSync(baseline ?? new URL('./managedSculptedDice.ts', import.meta.url))).digest('hex'),
        models: Object.fromEntries(Object.entries(models).map(([url, bytes]) => [url, createHash('sha256').update(bytes).digest('hex')])),
      }, null, 2))
      for (const frame of frames) writeFileSync(`${process.env.EYES_PROOF_OUTPUT}/faces-1-6-t${frame.time}.png`, Buffer.from(frame.image.split(',')[1], 'base64'))
    }
    assert.deepEqual(errors, [])
    assert.equal(result.originalKeysMatch, true)
    assert.equal(result.originalClipCount, 22)
    assert.deepEqual(Object.entries(result.maxAngles).filter(([, angle]) => angle < .05).map(([name]) => name), [], 'every authored eye must move, including faces 2–6')
    assert.ok(result.authoredMaxError < 1e-5, `named authored quaternion error ${result.authoredMaxError}`)
    assert.ok(result.faceChangedPixels.every(count => count > 100), `visible motion on every face: ${result.faceChangedPixels}`)
    for (const key of ['fixedPose', 'parentUnchanged', 'profilePreservesPhase', 'pausedStable', 'frozenPeer', 'sourceUnchanged', 'clipsUnchanged', 'retiredStable', 'livePeerMoves']) assert.equal(result[key], true, key)
    assert.equal(result.sourceDisposals, 0)
    assert.equal(result.ownedDisposals, result.ownedMaterialCount)
    assert.equal(result.uniqueOwnedDisposals, result.ownedMaterialCount)
  } finally {
    await browser?.close()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
