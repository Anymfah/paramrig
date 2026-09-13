import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { createAudioDocument } from '@/audio/document'
import { installAudioAssets, serializeAudioProject, type AudioAsset } from '@/audio/project'
const storage = vi.hoisted(() => new Map<string, Blob>())
vi.mock('@/state/resources', () => ({
  storeResource: async (id: string, blob: Blob) => { storage.set(id, blob) },
  loadResource: async (id: string) => storage.get(id) ?? null,
}))
afterEach(() => vi.unstubAllGlobals())
it('restores exact frame metadata from storage and embeds snapshot assets in exports', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const samples = Float32Array.from({ length: 512 }, (_, at) => Math.sin(at * Math.PI * 2 / 256))
  const data = btoa(String.fromCharCode(...new Uint8Array(samples.buffer)))
  const asset: AudioAsset = { id: 'user:roundtrip-table', kind: 'wavetable', name: 'Two cycles', frames: 2, frameSize: 256, sampleRate: 44100, data }
  await installAudioAssets([asset])
  const doc = createAudioDocument()
  const patch = structuredClone(doc.patch)
  patch.layers[0]!.source.kind = 'table'
  patch.layers[0]!.source.table = asset.id
  doc.snapshots = [{ id: 'saved-table', name: 'Saved table', patch, createdAt: '' }]
  expect(JSON.parse(serializeAudioProject(doc)).assets[0]).toEqual(asset)
  vi.resetModules()
  const fresh = await import('@/audio/project')
  expect(() => fresh.serializeAudioProject(doc)).toThrow(/missing/i)
  expect(await fresh.restoreAudioAssets(doc)).toEqual([])
  expect(JSON.parse(fresh.serializeAudioProject(doc)).assets[0]).toEqual(asset)
})
