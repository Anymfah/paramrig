import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_STORE_KEYS, PROJECT_INDEX_KEY, indexSuccessfulWrite, readProjectIndex, rebuildProjectIndex, resetProjectIndexCache, subscribeProjectIndex } from './projectIndex'
import { writeStore, writeDocument } from '@/editor/storage'

beforeEach(() => { localStorage.clear(); resetProjectIndexCache(); vi.restoreAllMocks() })
const stored = { 'legacy-sound': { id: 'legacy-sound', name: 'Saved fusion', updatedAt: '2026-09-12', patch: { seed: 17, privateLegacyShape: ['unchanged'] }, labs: { recipeRoles: ['Attack'] } } }

describe('reconstructible project metadata', () => {
  it('indexes old documents without changing their exact bytes or regenerating patches', () => {
    const raw = JSON.stringify(stored, null, 3)
    localStorage.setItem(DOCUMENT_STORE_KEYS.audio, raw)
    const entries = readProjectIndex()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'legacy-sound', module: 'audio', name: 'Saved fusion' })
    expect(JSON.stringify(entries)).not.toMatch(/patch|recipeRoles|privateLegacyShape/)
    expect(localStorage.getItem(DOCUMENT_STORE_KEYS.audio)).toBe(raw)
  })
  it('recovers from a corrupt index and keeps malformed documents addressable for domain validation', () => {
    localStorage.setItem(PROJECT_INDEX_KEY, '{broken')
    localStorage.setItem(DOCUMENT_STORE_KEYS.vector, JSON.stringify({ damaged: null }))
    expect(readProjectIndex()[0]).toMatchObject({ id: 'damaged', module: 'vector' })
    expect(localStorage.getItem(DOCUMENT_STORE_KEYS.vector)).toBe('{"damaged":null}')
  })
  it('does not turn a successful document save into a failed save when index writes are refused', () => {
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (key === PROJECT_INDEX_KEY) throw new DOMException('Full', 'QuotaExceededError')
      original.call(this, key, value)
    })
    expect(writeStore(DOCUMENT_STORE_KEYS.audio, stored)).toEqual({ ok: true })
    expect(readProjectIndex()[0]?.id).toBe('legacy-sound')
    expect(JSON.parse(localStorage.getItem(DOCUMENT_STORE_KEYS.audio)!)).toEqual(stored)
  })
  it('preserves unreadable neighbours and other-tab documents when saving one project', () => {
    const untouched = { patch: { seed: 99, legacyField: 'keep' }, futureVersion: 8 }
    localStorage.setItem(DOCUMENT_STORE_KEYS.audio, JSON.stringify({ damaged: null, legacy: untouched, otherTab: { id: 'otherTab', name: 'New in another tab' } }))
    expect(writeDocument(DOCUMENT_STORE_KEYS.audio, 'current', stored['legacy-sound'])).toEqual({ ok: true })
    const after = JSON.parse(localStorage.getItem(DOCUMENT_STORE_KEYS.audio)!)
    expect(after.legacy).toEqual(untouched)
    expect(after.damaged).toBeNull()
    expect(after.otherTab.name).toBe('New in another tab')
    expect(writeDocument(DOCUMENT_STORE_KEYS.audio, 'current', undefined)).toEqual({ ok: true })
    expect(readProjectIndex().map(item => item.id)).toEqual(['damaged', 'legacy', 'otherTab'])
  })
  it('refuses to replace an unreadable source store', () => {
    localStorage.setItem(DOCUMENT_STORE_KEYS.vector, '{broken')
    expect(writeDocument(DOCUMENT_STORE_KEYS.vector, 'new', { name: 'New' }).ok).toBe(false)
    expect(localStorage.getItem(DOCUMENT_STORE_KEYS.vector)).toBe('{broken')
  })
  it('refreshes other-tab saves and deletions, and releases its subscription', () => {
    const change = vi.fn(); const stop = subscribeProjectIndex(change)
    readProjectIndex(); change.mockClear()
    localStorage.setItem(DOCUMENT_STORE_KEYS.audio, JSON.stringify(stored))
    window.dispatchEvent(new StorageEvent('storage', { key: DOCUMENT_STORE_KEYS.audio }))
    expect(readProjectIndex()).toHaveLength(1); expect(change).toHaveBeenCalledOnce()
    localStorage.removeItem(DOCUMENT_STORE_KEYS.audio)
    window.dispatchEvent(new StorageEvent('storage', { key: DOCUMENT_STORE_KEYS.audio }))
    expect(readProjectIndex()).toEqual([])
    stop(); change.mockClear()
    window.dispatchEvent(new StorageEvent('storage', { key: DOCUMENT_STORE_KEYS.audio }))
    expect(change).not.toHaveBeenCalled()
  })
  it('checks all sources even when the first action is saving one domain', () => {
    localStorage.setItem(DOCUMENT_STORE_KEYS.audio, JSON.stringify(stored))
    localStorage.setItem(DOCUMENT_STORE_KEYS.vector, '{"drawing":{"name":"Poster"}}')
    indexSuccessfulWrite(DOCUMENT_STORE_KEYS.audio, JSON.stringify(stored))
    expect(readProjectIndex().map(entry => entry.module).sort()).toEqual(['audio', 'vector'])
  })
  it('reconciles saves missed while no page was subscribed', () => {
    const first = subscribeProjectIndex(() => {})
    expect(readProjectIndex()).toEqual([])
    first()
    localStorage.setItem(DOCUMENT_STORE_KEYS.audio, JSON.stringify(stored))
    // No storage listener is active on this page. Returning to the library must catch up.
    window.dispatchEvent(new StorageEvent('storage', { key: DOCUMENT_STORE_KEYS.audio }))
    const stop = subscribeProjectIndex(() => {})
    expect(readProjectIndex()[0]?.id).toBe('legacy-sound')
    stop()
  })
  it('keeps known entries accessible while storage is unavailable', () => {
    localStorage.setItem(DOCUMENT_STORE_KEYS.audio, JSON.stringify(stored)); readProjectIndex()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    expect(rebuildProjectIndex()[0]?.id).toBe('legacy-sound')
  })
})
