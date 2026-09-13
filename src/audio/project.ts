import { sanitizeAudioDocument, saveAudioDocument, storageMessage, type AudioDocument } from '@/audio/document'
import { isTableName, registerWavetable, wavetableFromCycles, WAVETABLE_FRAME, WAVETABLE_MAX_CYCLES } from '@/audio/dsp/wavetable'
import { decodeWav, type DecodedWav } from '@/audio/dsp/wav'
import { loadResource, storeResource } from '@/state/resources'
import { labSources } from './labs/model'

/**
 * How an audio document leaves the browser and comes back, including the wavetables it needs.
 *
 * The patch itself stays JSON. Binary tables live in IndexedDB while you work, and ride along as
 * base64 inside the file so a session that has never seen them can still play the sound.
 */

export const PROJECT_FORMAT = 'paramrig.audio'
export const PROJECT_FORMAT_VERSION = 1

export type AudioAsset = {
  id: string
  kind: 'wavetable'
  name: string
  /** PCM cycles, each one frame of the stored table. */
  frames: number
  frameSize: number
  sampleRate: number
  /** Interleaved float32, base64, one cycle after another. */
  data: string
}

export type AudioProject = {
  format: typeof PROJECT_FORMAT
  formatVersion: number
  app: string
  savedAt: string
  document: AudioDocument
  assets?: AudioAsset[]
}

export type AudioProjectImport =
  | { ok: true; project: AudioProject; note?: string }
  | { ok: false; error: string }

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024
export const WAVETABLE_FRAME_SIZES = [256, 512, 1024, 2048, 4096] as const

const assetCache = new Map<string, AudioAsset>()

export function exportAudioProject(document: AudioDocument, assets: AudioAsset[] = collectAssets(document)): AudioProject {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: 'ParamRig',
    savedAt: new Date().toISOString(),
    document: sanitizeAudioDocument(document) ?? document,
    ...(assets.length ? { assets } : {}),
  }
}

export function serializeAudioProject(document: AudioDocument, assets?: AudioAsset[]): string {
  return `${JSON.stringify(exportAudioProject(document, assets), null, 2)}\n`
}

export function importAudioProject(input: unknown): AudioProjectImport {
  let value = input
  if (typeof value === 'string') {
    if (value.length > 32 * 1024 * 1024) return { ok: false, error: 'That project is larger than 32 MB.' }
    try { value = JSON.parse(value) } catch { return { ok: false, error: 'That file is not valid JSON.' } }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'That file is not an audio project.' }
  }
  const source = value as Record<string, unknown>
  if (source.format !== PROJECT_FORMAT) {
    return { ok: false, error: 'That file is not an audio project.' }
  }
  if (source.formatVersion !== PROJECT_FORMAT_VERSION) return { ok: false, error: 'That audio project version is not supported.' }
  const document = sanitizeAudioDocument(source.document)
  if (!document) return { ok: false, error: 'The sound in that file could not be read.' }
  if (Array.isArray(source.assets) && source.assets.some((entry) => !readAsset(entry))) return { ok: false, error: 'That project contains an invalid wavetable.' }
  const assets = (Array.isArray(source.assets) ? source.assets : []).flatMap((entry) => {
    const asset = readAsset(entry)
    return asset ? [asset] : []
  })
  const missing = referencedTables(document).filter((id) => !assets.some((asset) => asset.id === id) && !isBuiltIn(id))
  const note = missing.length
    ? `Missing wavetable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`
    : undefined
  return { ok: true, project: { format: PROJECT_FORMAT, formatVersion: 1, app: 'ParamRig', savedAt: typeof source.savedAt === 'string' ? source.savedAt : new Date(0).toISOString(), document, ...(assets.length ? { assets } : {}) }, ...(note ? { note } : {}) }
}

function isBuiltIn(id: string): boolean {
  return isTableName(id) && !id.startsWith('user:')
}

function referencedTables(document: AudioDocument): string[] {
  const ids = new Set<string>()
  const kept = document.snapshots ?? []
  const patches = [document.patch, ...kept.map((entry) => entry.patch), ...labSources(document.labs).map((entry) => entry.patch), ...kept.flatMap((entry) => entry.lab?.parents.map((parent) => parent.patch) ?? [])]
  for (const patch of patches) for (const layer of patch.layers) {
    if (layer.source.table.startsWith('user:')) ids.add(layer.source.table)
  }
  return [...ids]
}

function readAsset(value: unknown): AudioAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (source.kind !== 'wavetable' || typeof source.id !== 'string' || typeof source.data !== 'string' || !source.id.startsWith('user:') || !isTableName(source.id) || source.id.length > 80) return null
  const frames = typeof source.frames === 'number' ? source.frames : 0
  const frameSize = typeof source.frameSize === 'number' ? source.frameSize : 0
  if (!Number.isInteger(frames) || frames < 1 || frames > WAVETABLE_MAX_CYCLES || !WAVETABLE_FRAME_SIZES.includes(frameSize as typeof WAVETABLE_FRAME_SIZES[number])) return null
  const asset: AudioAsset = {
    id: source.id,
    kind: 'wavetable',
    name: typeof source.name === 'string' ? source.name.slice(0, 80) : 'Wavetable',
    frames,
    frameSize,
    sampleRate: typeof source.sampleRate === 'number' && Number.isFinite(source.sampleRate) && source.sampleRate > 0 ? source.sampleRate : 44100,
    data: source.data,
  }
  return cyclesOf(asset) ? asset : null
}

export async function installAudioAssets(assets: AudioAsset[]): Promise<void> {
  for (const asset of assets) {
    const cycles = cyclesOf(asset)
    if (!cycles) continue
    await storeResource(asset.id, new Blob([JSON.stringify(asset)], { type: 'application/json' }))
    assetCache.set(asset.id, asset)
    registerWavetable(asset.id, wavetableFromCycles(cycles))
  }
}

function cyclesOf(asset: AudioAsset): Float32Array[] | null {
  try {
    const expected = asset.frames * asset.frameSize * 4
    if (!Number.isSafeInteger(expected) || expected < 4 || expected > MAX_IMPORT_BYTES || asset.data.length !== 4 * Math.ceil(expected / 3)) return null
    const raw = Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0))
    const floats = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
    const need = asset.frames * asset.frameSize
    if (floats.length !== need || floats.some((value) => !Number.isFinite(value))) return null
    return Array.from({ length: asset.frames }, (_, frame) => floats.slice(frame * asset.frameSize, (frame + 1) * asset.frameSize))
  } catch {
    return null
  }
}

export type WavetablePreview = {
  sampleRate: number
  channels: number
  samples: number
  seconds: number
  frameSize: number
  frames: number
  ambiguous: boolean
  candidates: number[]
}

/**
 * What an imported WAV would become, before anything is stored.
 *
 * Frame size is only guessed when the file divides cleanly by a known size. Two possible sizes
 * is ambiguous: the caller must pick one. Nothing is stored until then.
 */
export function inspectWavetable(wav: DecodedWav): WavetablePreview | { error: string } {
  if (wav.samples.length === 0) return { error: 'That file has no samples.' }
  const bytes = wav.samples.length * 4
  if (bytes > MAX_IMPORT_BYTES) return { error: 'That wavetable is larger than 8 MB.' }
  const candidates = WAVETABLE_FRAME_SIZES.filter((size) => wav.samples.length % size === 0 && wav.samples.length / size <= WAVETABLE_MAX_CYCLES && wav.samples.length / size >= 1)
  if (candidates.length === 0) {
    return { error: `That file is ${wav.samples.length} samples. Split it into frames of ${WAVETABLE_FRAME_SIZES.join(', ')} samples so the cycle count is between 1 and ${WAVETABLE_MAX_CYCLES}.` }
  }
  const frameSize = candidates.includes(WAVETABLE_FRAME) && candidates.length === 1 ? WAVETABLE_FRAME : candidates[0]!
  return {
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    samples: wav.samples.length,
    seconds: wav.samples.length / wav.sampleRate,
    frameSize,
    frames: wav.samples.length / frameSize,
    ambiguous: candidates.length > 1,
    candidates,
  }
}

export async function importWavetableFile(file: File, frameSize: number): Promise<{ id: string; name: string; tableName: string } | { error: string }> {
  if (file.size > MAX_IMPORT_BYTES) return { error: 'That wavetable is larger than 8 MB.' }
  const buffer = await file.arrayBuffer()
  const wav = decodeWav(buffer)
  if ('error' in wav) return wav
  const inspect = inspectWavetable(wav)
  if ('error' in inspect) return inspect
  if (!inspect.candidates.includes(frameSize)) return { error: `That file does not split into ${frameSize}-sample frames.` }
  const frames = wav.samples.length / frameSize
  const id = `user:${crypto.randomUUID()}`
  const bytes = new Uint8Array(wav.samples.buffer, wav.samples.byteOffset, wav.samples.byteLength)
  let binary = ''
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
  const asset: AudioAsset = { id, kind: 'wavetable', name: file.name, frames, frameSize, sampleRate: wav.sampleRate, data: btoa(binary) }
  try { await installAudioAssets([asset]) } catch { return { error: 'The wavetable could not be saved. Check available storage.' } }

  return { id, name: file.name.replace(/\.wav$/i, ''), tableName: id }
}

export async function restoreWavetable(id: string): Promise<boolean> {
  if (!id.startsWith('user:')) return isTableName(id)
  if (assetCache.has(id)) return true
  const stored = await loadResource(id)
  if (stored) {
    const asset = readAsset(JSON.parse(await stored.text()))
    const cycles = asset && cyclesOf(asset)
    if (!asset || !cycles) return false
    assetCache.set(id, asset)
    registerWavetable(id, wavetableFromCycles(cycles))
    return true
  }
  const blob = await loadResource(id.slice(5))
  if (!blob) return false
  const wav = decodeWav(await blob.arrayBuffer())
  if ('error' in wav) return false
  const inspect = inspectWavetable(wav)
  if ('error' in inspect) return false
  // Older imports did not record frame size. Do not silently choose a different sound.
  if (inspect.ambiguous) return false
  const frameSize = inspect.frameSize
  const cycles = Array.from({ length: inspect.samples / frameSize }, (_, frame) => wav.samples.slice(frame * frameSize, (frame + 1) * frameSize))
  const bytes = new Uint8Array(wav.samples.buffer, wav.samples.byteOffset, wav.samples.byteLength)
  let binary = ''
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
  await installAudioAssets([{ id, kind: 'wavetable', name: 'Imported table', frames: cycles.length, frameSize, sampleRate: wav.sampleRate, data: btoa(binary) }])
  return true
}

/** Store an imported document and the tables it brought, then give back its id. */
export async function openAudioProject(project: AudioProject): Promise<{ id: string; name: string; note?: string }> {
  await installAudioAssets(project.assets ?? [])
  const message = storageMessage(saveAudioDocument(project.document))
  if (message) throw new Error(message)
  return { id: project.document.id, name: project.document.name }
}


export async function restoreAudioAssets(document: AudioDocument): Promise<string[]> {
  const missing: string[] = []
  for (const id of referencedTables(document)) {
    try { if (!await restoreWavetable(id)) missing.push(id) } catch { missing.push(id) }
  }
  return missing
}

function collectAssets(document: AudioDocument): AudioAsset[] {
  return referencedTables(document).map((id) => {
    const asset = assetCache.get(id)
    if (!asset) throw new Error(`Wavetable ${id} is missing. Import it again before exporting this project.`)
    return asset
  })
}
