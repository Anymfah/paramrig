import { afterEach, describe, expect, it, vi } from 'vitest'
import { LabPreviewCache, LabRunner } from './runner'
import { generateSound, type LabRender } from './generate'
import { DEFAULT_CRITERIA } from './model'
import type { WorkerOutput } from './worker'

class FakeWorker {
  static instances: FakeWorker[] = []
  constructor() { FakeWorker.instances.push(this) }
  onmessage: ((message: MessageEvent<WorkerOutput>) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
}
const sound = generateSound(DEFAULT_CRITERIA, 8)
const render = (key: string, size = 100): LabRender => ({ sound: { ...sound, fingerprint: key }, samples: { left: new Float32Array(size), right: new Float32Array(size) }, peak: 0.5, rms: 0.1, preview: [], spectrum: { columns: 1, rows: 1, values: new Float32Array(1), minHz: 40, maxHz: 8000 }, wave: new Float32Array(2),
  shape: { topDb: -6, spreadAll: 0 } })
afterEach(() => { vi.unstubAllGlobals(); FakeWorker.instances = [] })

describe('Labs worker lifecycle', () => {
  it('terminates cancelled DSP and ignores already queued events from the obsolete worker', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const runner = new LabRunner(), first = vi.fn(), second = vi.fn(), done = vi.fn()
    runner.run({ kind: 'preview', sound, rate: 48000 }, first, done)
    const stale = FakeWorker.instances[0]!
    runner.run({ kind: 'preview', sound, rate: 48000 }, second, done)
    expect(stale.terminate).toHaveBeenCalledOnce()
    stale.onmessage?.({ data: { kind: 'candidate', candidate: render('old') } } as MessageEvent<WorkerOutput>)
    stale.onerror?.()
    expect(first).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled()
    FakeWorker.instances[1]!.onmessage?.({ data: { kind: 'candidate', candidate: render('new') } } as MessageEvent<WorkerOutput>)
    expect(second).toHaveBeenCalledOnce()
    runner.cancel(); expect(FakeWorker.instances[1]!.terminate).toHaveBeenCalledOnce()
  })
  it('reports unavailable workers and missing custom assets without a stuck operation', () => {
    const runner = new LabRunner(), done = vi.fn()
    vi.stubGlobal('Worker', undefined)
    runner.run({ kind: 'preview', sound, rate: 48000 }, vi.fn(), done)
    expect(done).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
    const custom = structuredClone(sound); custom.patch.layers[0]!.source.table = 'user:missing-labs-table'
    runner.run({ kind: 'preview', sound: custom, rate: 48000 }, vi.fn(), done)
    expect(done).toHaveBeenLastCalledWith(expect.stringContaining('missing'))
  })
  it('bounds cached audio and retains recently auditioned entries', () => {
    const cache = new LabPreviewCache()
    for (let i = 0; i < 8; i++) cache.put(render(String(i)))
    cache.get('0'); cache.put(render('8'))
    expect(cache.get('1')).toBeUndefined(); expect(cache.get('0')).toBeDefined()
    cache.put(render('oversized', 3_000_000))
    expect(cache.get('oversized')).toBeUndefined()
  })
})
