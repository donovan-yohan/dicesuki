import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { Connect, ViteDevServer } from 'vite'
import { woodlandAssetPath, woodlandDevAssets } from './woodlandDevAssets'

const SCRATCH = fs.realpathSync(os.tmpdir())
const ASSET_URL = '/__experiments/woodland/wood-d6.glb'
const ASSET_PATH = '.artifacts/theme-workshop/experiments/woodland/wood-d6.glb'

describe('woodland dev artifact allowlist', () => {
  it('maps only the exact local proof paths', () => {
    expect(woodlandAssetPath('/__experiments/woodland/wood-d6.glb')).toBe('.artifacts/theme-workshop/experiments/woodland/wood-d6.glb')
    expect(woodlandAssetPath('/__experiments/woodland/wood-d6.metadata.json')).toContain('wood-d6.metadata.json')
  })
  it.each(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'])('maps the exact selected sculpted %s export', shape => {
    expect(woodlandAssetPath(`/__experiments/woodland/sculpted/${shape}.glb`)).toBe(
      `.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/${shape}.glb`,
    )
  })
  it('rejects arbitrary files, traversal and encoded paths', () => {
    for (const pathname of [
      '/__experiments/woodland/../.env', '/__experiments/woodland/%2e%2e/.env',
      '/__experiments/woodland/foo.glb', '/.env',
      '/__experiments/woodland/sculpted/d10tens.glb',
      '/__experiments/woodland/sculpted/d100.glb',
      '/__experiments/woodland/sculpted/d6.json',
      '/__experiments/woodland/sculpted/d6.glb/',
      '/__experiments/woodland/sculpted/%64%36.glb',
      '/__experiments/woodland/sculpted/../wood-d6.glb',
      '/__experiments/woodland/sculpted//d6.glb',
    ]) {
      expect(woodlandAssetPath(pathname)).toBeUndefined()
    }
  })
})

describe('woodland dev artifact middleware', () => {
  let sandbox: string
  let root: string
  const servers: http.Server[] = []

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(SCRATCH, 'woodland-dev-assets-'))
    root = path.join(sandbox, 'repo')
    fs.mkdirSync(root)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    fs.rmSync(sandbox, { recursive: true, force: true })
  })

  async function serve() {
    let middleware: Connect.NextHandleFunction | undefined
    const plugin = woodlandDevAssets()
    if (typeof plugin.configureServer !== 'function') throw new Error('Missing dev middleware hook')
    plugin.configureServer({
      config: { root },
      middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler } },
    } as unknown as ViteDevServer)
    if (!middleware) throw new Error('Missing dev middleware')
    const handler = middleware
    const server = http.createServer((request, response) => {
      handler(request, response, () => {
        response.statusCode = 404
        response.end('fallthrough')
      })
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    return (url = ASSET_URL, method = 'GET') => new Promise<{
      status: number | undefined
      headers: http.IncomingHttpHeaders
      body: string
    }>((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: address.port, path: url, method }, response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => { body += chunk })
        response.on('error', reject)
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
      })
      request.setTimeout(1000, () => request.destroy(new Error('Artifact request timed out')))
      request.on('error', reject)
      request.end()
    })
  }

  function writeAsset(relativePath = ASSET_PATH, content = 'approved artifact') {
    const file = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }

  it('is restricted to Vite development serving', () => {
    const plugin = woodlandDevAssets()
    expect(plugin.apply).toBe('serve')
    expect(plugin.configurePreviewServer).toBeUndefined()
  })

  it.each([
    [ASSET_URL, ASSET_PATH, 'model/gltf-binary'],
    ['/__experiments/woodland/wood-d6.metadata.json', ASSET_PATH.replace('.glb', '.metadata.json'), 'application/json'],
    ['/__experiments/woodland/variants/mobile.glb', '.artifacts/theme-workshop/experiments/woodland/variants/mobile.glb', 'model/gltf-binary'],
    ['/__experiments/woodland/variants/desktop.glb', '.artifacts/theme-workshop/experiments/woodland/variants/desktop.glb', 'model/gltf-binary'],
    ...['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].map(shape => [
      `/__experiments/woodland/sculpted/${shape}.glb`,
      `.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/${shape}.glb`,
      'model/gltf-binary',
    ]),
  ])('serves a regular allowlisted file at %s with GET and HEAD', async (url, relativePath, contentType) => {
    writeAsset(relativePath)
    const request = await serve()
    const get = await request(`${url}?cache=ignored`)
    expect(get.status).toBe(200)
    expect(get.body).toBe('approved artifact')
    expect(get.headers['content-type']).toBe(contentType)
    expect(get.headers['cache-control']).toBe('no-store')
    const head = await request(url, 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers['content-type']).toBe(contentType)
    expect(head.headers['cache-control']).toBe('no-store')
  })

  it.each(['directory', 'file'])('returns 404 for a missing artifact %s', async missing => {
    if (missing === 'file') fs.mkdirSync(path.dirname(path.join(root, ASSET_PATH)), { recursive: true })
    const request = await serve()
    expect((await request()).status).toBe(404)
    expect((await request(ASSET_URL, 'HEAD')).status).toBe(404)
  })

  it.each(['GET', 'HEAD'])('rejects a final symlink for %s without reading its target', async method => {
    const secret = path.join(root, '.env')
    fs.writeFileSync(secret, 'synthetic repository secret')
    fs.mkdirSync(path.dirname(path.join(root, ASSET_PATH)), { recursive: true })
    fs.symlinkSync(secret, path.join(root, ASSET_PATH))
    const open = vi.spyOn(fs, 'openSync')
    const request = await serve()
    const response = await request(ASSET_URL, method)
    expect(response.status).toBe(404)
    expect(response.body).not.toContain('synthetic repository secret')
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['.', '.artifacts', '.artifacts/theme-workshop', '.artifacts/theme-workshop/experiments', '.artifacts/theme-workshop/experiments/woodland'])(
    'rejects the symlink ancestor %s even when its target is inside the repository', async ancestor => {
      writeAsset()
      const directory = path.join(root, ancestor)
      const target = ancestor === '.' ? path.join(sandbox, 'real-root') : `${directory}-real`
      fs.renameSync(directory, target)
      fs.symlinkSync(target, directory, 'dir')
      const request = await serve()
      expect((await request()).status).toBe(404)
    },
  )

  it.each(['mobile', 'desktop'])('rejects a symlink variants directory for %s', async tier => {
    const relativePath = `.artifacts/theme-workshop/experiments/woodland/variants/${tier}.glb`
    const file = writeAsset(relativePath)
    const directory = path.dirname(file)
    fs.renameSync(directory, `${directory}-real`)
    fs.symlinkSync(`${directory}-real`, directory, 'dir')
    const request = await serve()
    expect((await request(`/__experiments/woodland/variants/${tier}.glb`)).status).toBe(404)
  })

  it.each(['anime-grade', 'anime-grade/assets', 'anime-grade/assets/d6.glb'])(
    'rejects a symlink at the new sculpted export boundary %s', async ancestor => {
      const relativePath = '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d6.glb'
      writeAsset(relativePath)
      const entry = path.join(root, '.artifacts/theme-workshop/experiments/woodland', ancestor)
      const isFile = ancestor.endsWith('.glb')
      fs.renameSync(entry, `${entry}-real`)
      fs.symlinkSync(`${entry}-real`, entry, isFile ? 'file' : 'dir')
      const open = vi.spyOn(fs, 'openSync')
      const request = await serve()
      for (const method of ['GET', 'HEAD']) {
        expect((await request('/__experiments/woodland/sculpted/d6.glb', method)).status).toBe(404)
      }
      expect(open).not.toHaveBeenCalled()
    },
  )

  it.each(['directory', 'pipe'])('rejects a %s artifact without opening it or hanging', async kind => {
    const file = path.join(root, ASSET_PATH)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (kind === 'directory') fs.mkdirSync(file)
    else execFileSync('mkfifo', [file])
    const open = vi.spyOn(fs, 'openSync')
    const request = await serve()
    expect((await request()).status).toBe(404)
    expect((await request(ASSET_URL, 'HEAD')).status).toBe(404)
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects path attempts and unsupported methods without accessing files', async () => {
    writeAsset()
    fs.writeFileSync(path.join(root, '.env'), 'synthetic repository secret')
    const open = vi.spyOn(fs, 'openSync')
    const stat = vi.spyOn(fs, 'lstatSync')
    const request = await serve()
    for (const url of [
      '/__experiments/woodland/../.env',
      '/__experiments/woodland/%2e%2e/.env',
      '/__experiments/woodland/%2e%2e%2f.env',
      '/__experiments/woodland/wood-d6.glb/../../.env',
      '/__experiments/woodland/%77ood-d6.glb',
      '/__experiments/woodland/wood-d6.glb/',
      '/__experiments/woodland/wood-d6.glb%00',
      '/__experiments/woodland/foo.glb',
      '/__experiments/woodland/variants/',
      '/__experiments/woodland/variants/ultra.glb',
      '/__experiments/woodland/variants/mobile.glb/',
      '/__experiments/woodland/variants/%6dobile.glb',
      '/__experiments/woodland/variants/../wood-d6.glb',
      '/__experiments/woodland/toString',
      '/__experiments/woodland//wood-d6.glb',
      '/.env',
    ]) {
      const response = await request(url)
      expect(response.status, url).toBe(404)
      expect(response.body, url).not.toContain('synthetic repository secret')
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      expect((await request(ASSET_URL, method)).status, method).toBe(404)
    }
    expect(stat).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects a realpath outside the repository even when lexical stats look safe', async () => {
    const file = writeAsset()
    const realpath = fs.realpathSync
    vi.spyOn(fs, 'realpathSync').mockImplementation((...args) => args[0] === file
      ? path.join(sandbox, 'outside', 'wood-d6.glb')
      : realpath(...args))
    const open = vi.spyOn(fs, 'openSync')
    const request = await serve()
    expect((await request()).status).toBe(404)
    expect(open).not.toHaveBeenCalled()
  })

  it('does not follow a file replaced with a symlink after path validation', async () => {
    const file = path.join(root, ASSET_PATH)
    const secret = path.join(sandbox, 'synthetic-secret')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'approved artifact')
    fs.writeFileSync(secret, 'synthetic secret')
    const realpath = fs.realpathSync
    let replaced = false
    vi.spyOn(fs, 'realpathSync').mockImplementation((...args) => {
      const resolved = realpath(...args)
      if (args[0] === file && !replaced) {
        replaced = true
        fs.unlinkSync(file)
        fs.symlinkSync(secret, file)
      }
      return resolved
    })

    const request = await serve()
    const response = await request()
    expect(replaced).toBe(true)
    expect(response.status).toBe(404)
    expect(response.body).not.toContain('synthetic secret')
  })

  it('rejects an ancestor swapped to a symlink before open and closes the rejected descriptor', async () => {
    const file = writeAsset()
    const directory = path.dirname(file)
    const outside = path.join(sandbox, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'wood-d6.glb'), 'synthetic secret')
    const open = fs.openSync
    let descriptor: number | undefined
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      if (args[0] === file) {
        fs.renameSync(directory, `${directory}-original`)
        fs.symlinkSync(outside, directory, 'dir')
      }
      descriptor = open(...args)
      return descriptor
    })
    const request = await serve()
    const response = await request()
    expect(response.status).toBe(404)
    expect(response.body).not.toContain('synthetic secret')
    expect(descriptor).toBeDefined()
    expect(() => fs.fstatSync(descriptor!)).toThrow()
  })

  it('rejects an ancestor replaced by a symlink even if the file inode stays the same', async () => {
    const file = writeAsset()
    const directory = path.dirname(file)
    const open = fs.openSync
    let descriptor: number | undefined
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      if (args[0] === file) {
        fs.renameSync(directory, `${directory}-original`)
        fs.symlinkSync(`${directory}-original`, directory, 'dir')
      }
      descriptor = open(...args)
      return descriptor
    })
    const request = await serve()
    expect((await request()).status).toBe(404)
    expect(descriptor).toBeDefined()
    expect(() => fs.fstatSync(descriptor!)).toThrow()
  })

  it('rejects a file swapped to a pipe before open without blocking', async () => {
    const file = writeAsset()
    const open = fs.openSync
    let descriptor: number | undefined
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      if (args[0] === file) {
        fs.unlinkSync(file)
        execFileSync('mkfifo', [file])
      }
      descriptor = open(...args)
      return descriptor
    })
    const request = await serve()
    expect((await request()).status).toBe(404)
    expect(descriptor).toBeDefined()
    expect(() => fs.fstatSync(descriptor!)).toThrow()
  })

  it('streams the validated descriptor instead of reopening a changed path', async () => {
    const file = writeAsset()
    const secret = path.join(sandbox, 'synthetic-secret')
    fs.writeFileSync(secret, 'synthetic secret')
    const createReadStream = fs.createReadStream
    vi.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
      fs.unlinkSync(file)
      fs.symlinkSync(secret, file)
      return createReadStream(...args)
    })
    const request = await serve()
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.body).toBe('approved artifact')
  })

  it('closes the validated descriptor for HEAD without creating a stream', async () => {
    writeAsset()
    const open = vi.spyOn(fs, 'openSync')
    const stream = vi.spyOn(fs, 'createReadStream')
    const request = await serve()
    expect((await request(ASSET_URL, 'HEAD')).status).toBe(200)
    const descriptor = open.mock.results[0]?.value as number
    expect(descriptor).toBeTypeOf('number')
    expect(() => fs.fstatSync(descriptor)).toThrow()
    expect(stream).not.toHaveBeenCalled()
  })

  it('destroys a failed stream response and closes its file descriptor', async () => {
    writeAsset()
    const createReadStream = fs.createReadStream
    let descriptor: number | undefined
    let closed: Promise<void> | undefined
    vi.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
      const stream = createReadStream(...args)
      const options = args[1]
      descriptor = typeof options === 'object' && typeof options.fd === 'number' ? options.fd : undefined
      closed = new Promise<void>(resolve => stream.once('close', resolve))
      queueMicrotask(() => stream.destroy(new Error('Synthetic read failure')))
      return stream
    })
    const request = await serve()
    await expect(request()).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(closed).toBeDefined()
    await closed
    expect(descriptor).toBeTypeOf('number')
    expect(() => fs.fstatSync(descriptor!)).toThrow()
    vi.restoreAllMocks()
    expect((await request()).body).toBe('approved artifact')
  })

  it('rejects an artifact directory symlink escaping the repository', async () => {
    const outside = path.join(sandbox, 'outside')
    const outsideAsset = path.join(outside, 'theme-workshop/experiments/woodland/wood-d6.glb')
    fs.mkdirSync(path.dirname(outsideAsset), { recursive: true })
    fs.writeFileSync(outsideAsset, 'synthetic secret outside the repository')
    fs.symlinkSync(outside, path.join(root, '.artifacts'), 'dir')

    const request = await serve()
    const response = await request()
    expect(response.status).toBe(404)
    expect(response.body).not.toContain('synthetic secret')
  })
})
