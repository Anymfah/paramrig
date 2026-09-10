import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uiClick } from '@/audio/presets'
const mocks = vi.hoisted(() => ({ context: null as unknown, stopPlayback: vi.fn() }))
vi.mock('@/audio/playback', () => ({ audioContext: () => mocks.context, stopPlayback: mocks.stopPlayback }))
import { isLive, startLive, stopLive, watchLiveMeter } from '@/audio/live'
class Node {
  static made: Node[] = []
  port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as ((event: { data: unknown }) => void) | null }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() { Node.made.push(this) }
}
const context = () => ({ state: 'running', resume: vi.fn().mockResolvedValue(undefined), audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }, destination: {} })
beforeEach(() => { vi.stubGlobal('AudioWorkletNode', Node); mocks.context = context(); Node.made = [] })
afterEach(() => { stopLive(); watchLiveMeter(null); vi.unstubAllGlobals() })
describe('live playback lifecycle', () => {
  it('loads the processor into every new AudioContext', async () => {
    const first = mocks.context as ReturnType<typeof context>
    expect(await startLive(uiClick())).toBe(true)
    stopLive()
    const second = context(); mocks.context = second
    expect(await startLive(uiClick())).toBe(true)
    expect(first.audioWorklet.addModule).toHaveBeenCalledOnce()
    expect(second.audioWorklet.addModule).toHaveBeenCalledOnce()
  })
  it('does not start after stop was requested while the module loaded', async () => {
    let resolve!: () => void
    const current = mocks.context as ReturnType<typeof context>
    current.audioWorklet.addModule.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const pending = startLive(uiClick())
    await vi.waitFor(() => expect(current.audioWorklet.addModule).toHaveBeenCalledOnce())
    stopLive(); resolve()
    expect(await pending).toBe(false)
    expect(isLive()).toBe(false)
    expect(Node.made).toHaveLength(0)
  })
  it('reports completion and disconnects its node', async () => {
    const listener = vi.fn(); watchLiveMeter(listener)
    await startLive(uiClick())
    Node.made[0]!.port.onmessage!({ data: { type: 'ended' } })
    expect(isLive()).toBe(false)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ ended: true, peak: 0 }))
  })
})
