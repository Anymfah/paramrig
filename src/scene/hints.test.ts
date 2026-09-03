import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissHint, HINT_TEXT, readHintState, shouldShowHint, writeHintState, type HintState } from '@/scene/hints'

const STORAGE_KEY = 'paramrig.scene-hints.v1'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('what the editor remembers about its opening hint', () => {
  it('names the gestures a viewport cannot draw for itself', () => {
    expect(HINT_TEXT).toContain('orbit')
    expect(HINT_TEXT).toContain('⇧A')
    expect(HINT_TEXT).toContain('Tab')
  })

  it('offers the hint to somebody who has never opened the editor', () => {
    expect(readHintState()).toEqual({ dismissed: false, seenAt: null })
    expect(shouldShowHint(readHintState())).toBe(true)
  })

  it('reads back what it wrote, so the hint stays gone on the next document and the next session', () => {
    writeHintState({ dismissed: true, seenAt: '2026-09-03T10:00:00.000Z' })
    expect(readHintState()).toEqual({ dismissed: true, seenAt: '2026-09-03T10:00:00.000Z' })
    expect(shouldShowHint(readHintState())).toBe(false)
  })

  it('offers the hint again to somebody who read it and touched nothing', () => {
    writeHintState({ dismissed: false, seenAt: '2026-09-03T10:00:00.000Z' })
    expect(shouldShowHint(readHintState())).toBe(true)
  })

  it('keeps the first sighting when the hint is waved away', () => {
    const dismissed = dismissHint({ dismissed: false, seenAt: '2026-09-03T10:00:00.000Z' })
    expect(dismissed).toEqual({ dismissed: true, seenAt: '2026-09-03T10:00:00.000Z' })
    expect(shouldShowHint(dismissed)).toBe(false)
  })

  it('stamps the moment for a hint dismissed before any sighting was recorded', () => {
    const dismissed = dismissHint({ dismissed: false, seenAt: null })
    expect(dismissed.dismissed).toBe(true)
    expect(Number.isNaN(Date.parse(dismissed.seenAt ?? ''))).toBe(false)
  })

  it('leaves the state it was handed alone, so a caller can compare before and after', () => {
    const before: HintState = { dismissed: false, seenAt: null }
    dismissHint(before)
    expect(before).toEqual({ dismissed: false, seenAt: null })
  })

  it('reads nonsense out of storage as somebody who has not seen the hint, rather than throwing', () => {
    for (const raw of ['not json at all', 'null', '7', '"dismissed"', '[]', '{"dismissed":"yes","seenAt":42}']) {
      localStorage.setItem(STORAGE_KEY, raw)
      expect(readHintState()).toEqual({ dismissed: false, seenAt: null })
    }
  })

  it('reads a state that is missing a half without losing the half it has', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: true }))
    expect(readHintState()).toEqual({ dismissed: true, seenAt: null })
  })

  it('survives storage that refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is blocked')
    })
    expect(readHintState()).toEqual({ dismissed: false, seenAt: null })
  })

  it('survives storage that is full, rather than taking the editor down with it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(() => writeHintState({ dismissed: true, seenAt: null })).not.toThrow()
  })
})
