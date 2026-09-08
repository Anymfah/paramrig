/**
 * The only Web Audio in the domain, and it does one thing: hand a finished buffer to the speakers.
 *
 * No graph, no nodes to keep in step with the patch, nothing that could make what is heard differ
 * from what is exported — the synthesiser has already run by the time anything here is called.
 * That is the whole benefit of rendering offline, and it is why this file is forty lines instead
 * of four hundred.
 */

type ContextCtor = typeof AudioContext

let shared: AudioContext | null = null
let current: AudioBufferSourceNode | null = null

function ctor(): ContextCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/** Null wherever there is no audio at all — a test environment, or a browser that blocks it. */
export function audioContext(): AudioContext | null {
  if (shared) return shared
  const Ctor = ctor()
  if (!Ctor) return null
  try {
    shared = new Ctor()
  } catch {
    return null
  }
  return shared
}

/**
 * The rate to render at. Matching the device means the browser never resamples on the way out, so
 * the buffer that was drawn is the buffer that is heard. Exports use their own fixed rate instead,
 * because a file has to mean the same thing on a machine that is not this one.
 */
export function playbackRate(): number {
  return audioContext()?.sampleRate ?? 44100
}

export function stopPlayback(): void {
  if (!current) return
  const node = current
  current = null
  node.onended = null
  try {
    node.stop()
  } catch {
    /* Already finished; there is nothing to stop. */
  }
  node.disconnect()
}

/**
 * Plays a buffer, replacing whatever was playing. Returns false when there is no audio available,
 * so a caller can say so rather than leaving a button that does nothing.
 *
 * The context is resumed here rather than on mount: browsers only allow that inside a gesture, and
 * every call site is a click or a key press.
 */
export function playSamples(samples: Float32Array, sampleRate: number, onEnded?: () => void): boolean {
  const context = audioContext()
  if (!context || samples.length === 0) return false
  stopPlayback()
  void context.resume().catch(() => {
    /* A context that will not resume simply stays silent; nothing here can force it. */
  })
  const buffer = context.createBuffer(1, samples.length, sampleRate)
  // set() rather than copyToChannel(): the latter is typed against a Float32Array backed by a plain
  // ArrayBuffer, and a renderer that simply says it returns a Float32Array does not promise that.
  buffer.getChannelData(0).set(samples)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.onended = () => {
    if (current === source) current = null
    onEnded?.()
  }
  current = source
  source.start()
  return true
}

/** Used when the workspace is left, so a long tail does not outlive the page that started it. */
export function disposePlayback(): void {
  stopPlayback()
  if (!shared) return
  const context = shared
  shared = null
  void context.close().catch(() => {
    /* Closing a context that is already gone is not a failure worth reporting. */
  })
}
