import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { it } from 'node:test'

/** Actual GLTFLoader/Chrome regression: no renderer mocks or replacement die material. */
it('renders a loaded managed bone D4 black without lights, with local RGB falloff and exact original-profile restoration', { timeout: 5000 }, async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const model = readFileSync(new URL('../../public/dice/monster-dungeon-set/d4/model.glb', import.meta.url))
  const source = `
    import * as T from 'three';
    import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
    import { createManagedSculptedVisual } from './src/lib/managedSculptedDice';
    const gltf = await new GLTFLoader().loadAsync('/model.glb');
    const asset = { id: 'monster-dungeon-set/d4', metadata: { setId: 'monster-dungeon-set', diceType: 'd4' } };
    const owned = createManagedSculptedVisual(gltf.scene, asset, true, gltf.animations);
    const renderer = new T.WebGLRenderer({ antialias: false });
    renderer.setSize(128, 128); renderer.toneMapping = T.NoToneMapping;
    const scene = new T.Scene(); scene.background = new T.Color('black'); scene.add(owned.scene);
    const box = new T.Box3().setFromObject(owned.scene);
    const span = Math.max(...box.getSize(new T.Vector3()).toArray());
    owned.scene.position.sub(box.getCenter(new T.Vector3()));
    const camera = new T.PerspectiveCamera(32, 1, span / 100, span * 30);
    camera.position.set(span * 1.1, span * .9, span * 2.9); camera.lookAt(0, 0, 0);
    const light = new T.PointLight('white', 0, span * 20, 2); scene.add(light);
    const gl = renderer.getContext();
    const draw = (profile, color, distance, intensity) => {
      owned.setLightingResponse?.(profile);
      if (Array.isArray(color)) light.color.setRGB(...color); else light.color.set(color);
      light.intensity = intensity * span * span;
      light.position.set(span * .7 * distance, span * .7 * distance, span * .7 * distance);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(128 * 128 * 4);
      gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== 0) throw new Error('WebGL readback failed');
      return pixels;
    };
    const original = draw('original', 'white', 2, 0);
    const dark = draw('night', 'white', 2, 0);
    const warm = draw('night', '#ff9d3e', 2, 12);
    const cyan = draw('night', '#27eaff', 2, 12);
    const magenta = draw('night', '#ff37d5', 2, 12);
    // Equal linear luminance: the old hue-discarding ramp renders these alike.
    const equalCyan = draw('night', [.05, .4434703579418345, 1], 2, 12);
    const equalMagenta = draw('night', [1, .1812639821029083, .8], 2, 12);
    const far = draw('night', '#ff9d3e', 7, 12);
    const sweep = [.1, .3, .8, 2, 5, 12, 28].map(i => draw('night', 'white', 2, i));
    const restored = draw('original', 'white', 2, 0);
    scene.overrideMaterial = new T.MeshBasicMaterial({ color: 'white' });
    const mask = draw('night', 'white', 2, 0);
    let count = 0, darkMax = 0, lit = 0, hue = 0, equalLumaHue = 0, falloff = 0, originalSum = 0, restorationDelta = 0, plateau = false;
    const delta = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]);
    for (let i = 0; i < mask.length; i += 4) {
      if (mask[i] < 250) continue;
      count++; darkMax = Math.max(darkMax, dark[i], dark[i+1], dark[i+2]);
      originalSum += original[i] + original[i+1] + original[i+2];
      restorationDelta += delta(original, restored, i);
      if (delta(dark, warm, i) > 12) lit++;
      if (delta(cyan, magenta, i) > 12) hue++;
      if (delta(equalCyan, equalMagenta, i) > 12) equalLumaHue++;
      if (delta(warm, far, i) > 12) falloff++;
      const values = sweep.map(p => [p[i], p[i+1], p[i+2]].join(','));
      const distinct = new Set(values).size;
      if (distinct >= 3 && distinct <= 5 && values.some((v, j) => j > 0 && v === values[j-1])) plateau = true;
    }
    window.result = { count, darkMax, lit, hue, equalLumaHue, falloff, originalSum, restorationDelta, plateau, webgl: gl.getParameter(gl.VERSION) };
    owned.dispose(); scene.overrideMaterial.dispose(); renderer.dispose();
  `
  // Optional preserved-source replay uses identical fixture bytes, never edits
  // the live checkout. The absent old setter leaves the original bright ramp.
  const baseline = process.env.PROOF_BASELINE_ROOT
  const bundled = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false, plugins: baseline ? [{
    name: 'preserved-production', setup(builder) {
      builder.onLoad({ filter: /(?:woodlandCelMaterial|managedPhysicalCelMaterial|managedSculptedDice)\.ts$/ }, args => ({ contents: readFileSync(new URL('./src/lib/' + args.path.split('/').pop(), 'file://' + baseline + '/'), 'utf8'), loader: 'ts', resolveDir: root + 'src/lib' }))
    },
  }] : [] })
  const server = createServer((req, res) => {
    if (req.url === '/model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(model) }
    else if (req.url === '/proof.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundled.outputFiles[0].contents) }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<script type="module" src="/proof.js"></script>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME ?? (existsSync(chrome) ? chrome : undefined) })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing proof address')
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.waitForFunction(() => 'result' in window)
    const result = await page.evaluate(() => window.result)
    console.log(JSON.stringify(result))
    assert.deepEqual(errors, [])
    assert.match(result.webgl, /WebGL 2.0/)
    assert.ok(result.count > 1000)
    assert.equal(result.darkMax, 0)
    assert.ok(result.lit / result.count > 0.5)
    assert.ok(result.hue / result.count > 0.5)
    assert.ok(result.equalLumaHue / result.count > 0.5)
    assert.ok(result.falloff / result.count > 0.5)
    assert.ok(result.originalSum / result.count > 100)
    assert.equal(result.restorationDelta, 0)
    assert.equal(result.plateau, true)
  } finally {
    await browser?.close()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
