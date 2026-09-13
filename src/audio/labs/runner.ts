import { wavetableOf } from '@paramrig/audio/wavetables'
import type { LabRender } from './generate'
import type { LabSound, LabSource } from './model'
import type { WorkerInput, WorkerOutput } from './worker'

/**
 * One worker per runner, kept warm between operations.
 *
 * A worker that is still rendering is terminated, because that is the only way to cancel DSP
 * rather than merely the reply — a second press on Generate must not queue behind the first. An
 * idle worker is reused, so the ordinary rhythm of listen, press, listen never pays to boot the
 * synthesiser again.
 */
export class LabRunner {
  private worker: Worker | null = null
  private busy = false
  /** Stops work in flight. An idle worker is left ready. */
  cancel() {
    if (this.worker && this.busy) { this.worker.terminate(); this.worker = null }
    this.busy = false
  }
  /** Lets the worker go entirely; for unmounting. */
  dispose() { this.worker?.terminate(); this.worker = null; this.busy = false }
  get running() { return this.busy }
  run(input: Omit<Extract<WorkerInput, { kind: 'batch' }>, 'tables'> | Omit<Extract<WorkerInput, { kind: 'preview' }>, 'tables'>,
    onCandidate: (render: LabRender) => void, onDone: (issue: string) => void) {
    this.cancel()
    const sounds: LabSource[] = input.kind === 'preview' ? [input.sound] : [input.request.reference, input.request.contributor].filter((s): s is LabSound => !!s)
    const names = new Set(sounds.flatMap((s) => s.patch.layers.map((l) => l.source.table)).filter((id) => id.startsWith('user:')))
    const tables = [...names].map((id) => ({ id, table: wavetableOf(id) }))
    if (tables.some((entry) => !entry.table)) { onDone('A custom wavetable is missing. Restore it in Instrument before continuing.'); return }
    try {
      const worker = this.worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      this.busy = true
      worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
        if (this.worker !== worker) return
        if (event.data.kind === 'candidate') onCandidate(event.data.candidate)
        else { this.busy = false; onDone(event.data.issue) }
      }
      worker.onerror = () => { if (this.worker === worker) { this.dispose(); onDone('The audio worker stopped. Try generating again. Your kept sounds are safe.') } }
      worker.postMessage({ ...input, tables })
    } catch { this.dispose(); onDone('Background audio rendering is unavailable in this browser.') }
  }
}

const bytesOf = (render: LabRender) => render.samples.left.byteLength + render.samples.right.byteLength + (render.spectrum?.values.byteLength ?? 0) + (render.wave?.byteLength ?? 0)

/** Bound memory by bytes as well as count: four-second stereo buffers are much larger than clicks. */
export class LabPreviewCache {
  private entries = new Map<string, LabRender>()
  get(key: string) {
    const value = this.entries.get(key)
    if (value) { this.entries.delete(key); this.entries.set(key, value) }
    return value
  }
  has(key: string) { return this.entries.has(key) }
  put(render: LabRender) {
    const key = render.sound.fingerprint
    this.entries.delete(key); this.entries.set(key, render)
    let bytes = [...this.entries.values()].reduce((total, r) => total + bytesOf(r), 0)
    while (this.entries.size > 8 || bytes > 16 * 1024 * 1024) {
      const first = this.entries.keys().next().value
      if (!first) break
      bytes -= bytesOf(this.entries.get(first)!)
      this.entries.delete(first)
    }
  }
}
