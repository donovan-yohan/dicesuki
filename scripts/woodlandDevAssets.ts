import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const ASSETS: Record<string, string> = {
  '/__experiments/woodland/wood-d6.glb': '.artifacts/theme-workshop/experiments/woodland/wood-d6.glb',
  '/__experiments/woodland/wood-d6.metadata.json': '.artifacts/theme-workshop/experiments/woodland/wood-d6.metadata.json',
  '/__experiments/woodland/variants/mobile.glb': '.artifacts/theme-workshop/experiments/woodland/variants/mobile.glb',
  '/__experiments/woodland/variants/desktop.glb': '.artifacts/theme-workshop/experiments/woodland/variants/desktop.glb',
  '/__experiments/woodland/sculpted/d4.glb': '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d4.glb',
  '/__experiments/woodland/sculpted/d6.glb': '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d6.glb',
  '/__experiments/woodland/sculpted/d8.glb': '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d8.glb',
  '/__experiments/woodland/sculpted/d10.glb': '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d10.glb',
  '/__experiments/woodland/sculpted/d12.glb': '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d12.glb',
  '/__experiments/woodland/sculpted/d20.glb': '.artifacts/theme-workshop/experiments/woodland/anime-grade/assets/d20.glb',
}

export function woodlandAssetPath(pathname: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(ASSETS, pathname) ? ASSETS[pathname] : undefined
}

/** Reject symlinks at every level, then stream the checked file descriptor. */
function openArtifact(root: string, relativePath: string): number | undefined {
  root = path.resolve(root)
  const file = path.resolve(root, relativePath)
  let descriptor: number | undefined
  try {
    const entries = [root]
    let directory = root
    for (const component of relativePath.split('/').slice(0, -1)) {
      directory = path.join(directory, component)
      entries.push(directory)
    }
    entries.push(file)
    const stats = entries.map((entry, index) => {
      const stat = fs.lstatSync(entry)
      if (index === entries.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
        throw new Error('Invalid artifact path')
      }
      return stat
    })
    const realRoot = fs.realpathSync(root)
    const expectedFile = path.resolve(realRoot, relativePath)
    if (fs.realpathSync(file) !== expectedFile) throw new Error('Artifact escaped its repository path')

    // NOFOLLOW protects the leaf swap; NONBLOCK prevents a swapped FIFO from hanging.
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const opened = fs.fstatSync(descriptor)
    const original = stats[stats.length - 1]
    if (!opened.isFile() || opened.dev !== original.dev || opened.ino !== original.ino) {
      throw new Error('Artifact changed before opening')
    }
    // Revalidate the ancestors after open as well: O_NOFOLLOW covers only the leaf.
    for (let index = 0; index < entries.length; index++) {
      const current = fs.lstatSync(entries[index])
      if (current.isSymbolicLink() || current.dev !== stats[index].dev || current.ino !== stats[index].ino) {
        throw new Error('Artifact path changed before opening')
      }
    }
    if (fs.realpathSync(root) !== realRoot || fs.realpathSync(file) !== expectedFile) {
      throw new Error('Artifact resolved path changed before opening')
    }
    return descriptor
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    return undefined
  }
}

/** Fixed allowlist, dev server only. Never expose an artifact directory wholesale. */
export function woodlandDevAssets(): Plugin {
  return {
    name: 'woodland-local-asset-proof',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? ''
        if (!pathname.startsWith('/__experiments/woodland/')) return next()
        const relativePath = woodlandAssetPath(pathname)
        if (!relativePath || !['GET', 'HEAD'].includes(request.method ?? '')) {
          response.statusCode = 404
          response.end()
          return
        }
        const descriptor = openArtifact(server.config.root, relativePath)
        if (descriptor === undefined) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('Content-Type', relativePath.endsWith('.glb') ? 'model/gltf-binary' : 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (request.method === 'HEAD') {
          fs.closeSync(descriptor)
          response.end()
        } else {
          const stream = fs.createReadStream('', { fd: descriptor, autoClose: true })
          response.on('close', () => stream.destroy())
          stream.on('error', () => response.destroy()).pipe(response)
        }
      })
    },
  }
}
