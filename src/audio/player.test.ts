import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioPlayer, type AudioPlayer } from './player'
import { defaultPatch } from './patch'

class WorkletNode {
  static nodes: WorkletNode[] = []
  port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as ((event: { data: unknown }) => void) | null }
  connect = vi.fn()
  disconnect = vi.fn()
  onprocessorerror: (() => void) | null = null
  constructor() { WorkletNode.nodes.push(this) }
}
const context = () => ({ state: 'running', resume: vi.fn().mockResolvedValue(undefined), close: vi.fn(), audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }, destination: {} })
const players: AudioPlayer[] = []
beforeEach(() => { WorkletNode.nodes = []; vi.stubGlobal('AudioWorkletNode', WorkletNode) })
afterEach(() => { players.splice(0).forEach(player => player.destroy()); vi.unstubAllGlobals() })
function player(host: ReturnType<typeof context>, extra = {}) {
  const result = createAudioPlayer({ context: host as unknown as AudioContext, destination: host.destination as AudioNode, ...extra })
  players.push(result)
  return result
}

describe('host-owned audio players', () => {
  it('isolates transport, meters and user tables between players on the same context', async () => {
    const host = context()
    const a = player(host, { resolveWavetable: () => ({ frames: new Float32Array([1]), limits: [1] }) })
    const b = player(host, { resolveWavetable: () => ({ frames: new Float32Array([2]), limits: [1] }) })
    const patch = defaultPatch(); patch.layers[0]!.source.kind = 'table'; patch.layers[0]!.source.table = 'user:shared-id'
    expect(await a.start(patch)).toBe(true)
    expect(await b.start(patch)).toBe(true)
    expect(host.audioWorklet.addModule).toHaveBeenCalledOnce()
    const [first, second] = WorkletNode.nodes
    expect(first!.port.postMessage.mock.calls[0]![0].tables[0].frames[0]).toBe(1)
    expect(second!.port.postMessage.mock.calls[0]![0].tables[0].frames[0]).toBe(2)
    first!.port.onmessage!({ data: { type: 'meter', peak: 0.4, clock: 128, note: 128 } })
    expect(a.getMeter().peak).toBe(0.4)
    expect(b.getMeter().peak).toBe(0)
    a.destroy()
    expect(first!.disconnect).toHaveBeenCalledOnce()
    expect(first!.port.close).toHaveBeenCalledOnce()
    expect(second!.disconnect).not.toHaveBeenCalled()
    expect(b.isPlaying()).toBe(true)
    expect(host.close).not.toHaveBeenCalled()
  })
  it('cancels loading and rejects reuse after destruction without closing the host context', async () => {
    const host = context(); let finish!: () => void
    host.audioWorklet.addModule.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const a = player(host); const pending = a.start(defaultPatch())
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    a.destroy(); finish()
    expect(await pending).toBe(false)
    expect(WorkletNode.nodes).toHaveLength(0)
    await expect(a.start(defaultPatch())).rejects.toThrow('destroyed')
    expect(host.close).not.toHaveBeenCalled()
  })
  it('allows a failed worklet URL to be retried and exposes the failure', async () => {
    const host = context(); host.audioWorklet.addModule.mockRejectedValueOnce(new Error('Network unavailable'))
    const a = player(host, { workletUrl: '/assets/custom-processor.js' })
    expect(await a.start(defaultPatch())).toBe(false)
    expect(a.getError()?.message).toBe('Network unavailable')
    expect(await a.start(defaultPatch())).toBe(true)
    expect(a.getError()).toBeNull()
    expect(host.audioWorklet.addModule).toHaveBeenLastCalledWith('/assets/custom-processor.js')
  })
})
