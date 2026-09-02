import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVectorDocument, getVectorDocument } from '@/vector/document'
import { saveBadgeLabel, useProjectFile } from '@/vector/useProjectFile'
import type { VectorDocument } from '@/vector/types'

describe('the autosave badge', () => {
  it('says when the last write landed, and what is still pending', () => {
    expect(saveBadgeLabel({ state: 'clean', savedAt: null })).toBe('No changes yet')
    expect(saveBadgeLabel({ state: 'pending', savedAt: null })).toBe('Unsaved changes')
    expect(saveBadgeLabel({ state: 'saving', savedAt: null })).toBe('Saving…')
    expect(saveBadgeLabel({ state: 'error', savedAt: null })).toBe('Not saved')
    expect(saveBadgeLabel({ state: 'saved', savedAt: '2026-09-02T10:04:00.000Z' })).toMatch(/^Saved · \d\d:\d\d$/)
  })
})

describe('autosave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  const edited = (base: VectorDocument, name: string): VectorDocument => ({ ...base, name })

  it('writes the document once the pause is over', () => {
    const document = createVectorDocument()
    const { rerender } = renderHook(({ value }: { value: VectorDocument }) => useProjectFile(value), {
      initialProps: { value: document },
    })

    rerender({ value: edited(document, 'Renamed') })
    expect(getVectorDocument(document.id)?.name).toBe('Untitled')

    act(() => { vi.advanceTimersByTime(900) })

    expect(getVectorDocument(document.id)?.name).toBe('Renamed')
  })

  it('holds the write until the edits stop', () => {
    const document = createVectorDocument()
    const { rerender } = renderHook(({ value }: { value: VectorDocument }) => useProjectFile(value), {
      initialProps: { value: document },
    })

    rerender({ value: edited(document, 'One') })
    act(() => { vi.advanceTimersByTime(400) })
    rerender({ value: edited(document, 'Two') })
    act(() => { vi.advanceTimersByTime(400) })

    expect(getVectorDocument(document.id)?.name).toBe('Untitled')

    act(() => { vi.advanceTimersByTime(500) })

    expect(getVectorDocument(document.id)?.name).toBe('Two')
  })

  it('writes what it was still holding when the editor is left', () => {
    const document = createVectorDocument()
    const { rerender, unmount } = renderHook(({ value }: { value: VectorDocument }) => useProjectFile(value), {
      initialProps: { value: document },
    })

    rerender({ value: edited(document, 'Half typed') })
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { unmount() })

    expect(getVectorDocument(document.id)?.name).toBe('Half typed')
  })

  it('does not write again when nothing changed', () => {
    const document = createVectorDocument()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { rerender, unmount } = renderHook(({ value }: { value: VectorDocument }) => useProjectFile(value), {
      initialProps: { value: document },
    })
    write.mockClear()

    rerender({ value: document })
    act(() => { vi.advanceTimersByTime(900) })
    act(() => { unmount() })

    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })
})
