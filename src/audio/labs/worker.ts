import { registerWavetable, type Wavetable } from '@paramrig/audio/wavetables'
import { createLabBatch, measureRender, type LabRender } from './generate'
import type { LabRequest, LabSound } from './model'
import { renderSculpted } from './sculpt'

/** A preview may carry a target peak: the sound comes back with the gain that reaches it. */
export type WorkerInput = { rate: number; tables: { id: string; table: Wavetable }[] } & (
  { kind: 'batch'; request: LabRequest } | { kind: 'preview'; sound: LabSound; targetPeakDb?: number }
)
export type WorkerOutput = { kind: 'candidate'; candidate: LabRender } | { kind: 'done'; issue: string } | { kind: 'error'; issue: string }

function send(message: WorkerOutput, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}
const deliver = (candidate: LabRender) => send({ kind: 'candidate', candidate }, [candidate.samples.left.buffer, candidate.samples.right.buffer, candidate.spectrum.values.buffer, candidate.wave.buffer])
self.onmessage = (event: MessageEvent<WorkerInput>) => {
  try {
    const data = event.data
    data.tables.forEach(({ id, table }) => registerWavetable(id, table))
    if (data.kind === 'batch') {
      const result = createLabBatch(data.request, data.rate, deliver)
      send({ kind: 'done', issue: result.issue })
    } else {
      const { sound, samples } = renderSculpted(data.sound, data.rate, data.targetPeakDb)
      const { finite, ...measured } = measureRender(samples, data.rate)
      if (!finite) throw new Error('This sound could not be played safely.')
      deliver({ sound, ...measured })
      send({ kind: 'done', issue: '' })
    }
  } catch (error) { send({ kind: 'error', issue: error instanceof Error ? error.message : 'The audio worker could not render this sound.' }) }
}
