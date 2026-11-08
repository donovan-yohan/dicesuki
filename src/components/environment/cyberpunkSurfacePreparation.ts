import { surfaceKinds, type SurfaceSet, type SurfaceSize } from './cyberpunkSurfaces'

type PreparationResult = { status: 'ready'; pixels: SurfaceSet } | { status: 'unavailable'; error: string } | { status: 'cancelled' }
type JobResult = Exclude<PreparationResult, { status: 'cancelled' }>
type Job = {
  peers: number
  ready: Promise<JobResult>
  finish: (result: JobResult) => void
  worker?: Worker
  timer?: ReturnType<typeof setTimeout>
  settled: boolean
}
// Two fixed tiers × five kinds. Only private CPU bytes are shared, never textures.
const jobs = new Map<SurfaceSize, Job>()

function stop(job: Job) {
  clearTimeout(job.timer)
  if (job.worker) {
    job.worker.onmessage = job.worker.onerror = job.worker.onmessageerror = null
    job.worker.terminate()
    job.worker = undefined
  }
}

function start(size: SurfaceSize) {
  let resolve!: (result: JobResult) => void
  const job: Job = { peers: 0, settled: false, ready: new Promise(done => { resolve = done }), finish: result => {
    if (job.settled) return
    job.settled = true
    stop(job)
    if (result.status === 'unavailable' && jobs.get(size) === job) jobs.delete(size)
    resolve(result)
  } }
  jobs.set(size, job)
  try {
    // Vite's native worker entry is created only by a committed factory request.
    const worker = new Worker(new URL('./cyberpunkSurfaceWorker.ts', import.meta.url), { type: 'module' })
    job.worker = worker
    worker.onmessage = ({ data }: MessageEvent<SurfaceSet>) => {
      if (job.settled) return
      const length = size * size * 4
      if (!data || !surfaceKinds.every(kind => data[kind]?.albedo instanceof Uint8Array && data[kind]?.normal instanceof Uint8Array && data[kind].albedo.length === length && data[kind].normal.length === length)) {
        job.finish({ status: 'unavailable', error: 'Invalid Cyberpunk surface worker result' })
        return
      }
      job.finish({ status: 'ready', pixels: data })
    }
    worker.onerror = () => job.finish({ status: 'unavailable', error: 'Cyberpunk surface worker failed' })
    worker.onmessageerror = () => job.finish({ status: 'unavailable', error: 'Cyberpunk surface worker transfer failed' })
    // A dead worker must not hold an owner pending forever. No synchronous retry.
    job.timer = setTimeout(() => job.finish({ status: 'unavailable', error: 'Cyberpunk surface preparation timed out' }), 15000)
    worker.postMessage(size)
  } catch {
    job.finish({ status: 'unavailable', error: 'Cyberpunk surface worker unavailable' })
  }
  return job
}

export function prepareCyberpunkSurfaces(size: SurfaceSize) {
  if (size !== 256 && size !== 512) throw new Error('Unsupported Cyberpunk surface tier')
  const job = jobs.get(size) ?? start(size)
  job.peers++
  let released = false
  let cancel!: (result: PreparationResult) => void
  const retired = new Promise<PreparationResult>(resolve => { cancel = resolve })
  const ready: Promise<PreparationResult> = Promise.race([retired, job.ready.then(result => {
    if (released) return { status: 'cancelled' } as const
    if (result.status !== 'ready') return result
    const pixels = Object.fromEntries(surfaceKinds.map(kind => [kind, {
      albedo: result.pixels[kind].albedo.slice(), normal: result.pixels[kind].normal.slice(),
    }])) as SurfaceSet
    return { status: 'ready', pixels } as const
  })])
  return { ready, release() {
    if (released) return
    released = true
    cancel({ status: 'cancelled' })
    if (--job.peers === 0 && !job.settled) job.finish({ status: 'unavailable', error: 'Cyberpunk surface preparation retired' })
  } }
}
