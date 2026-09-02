import { describe, expect, it } from 'vitest'
import { EMPTY_PREFS, isOpen, parseInspectorPrefs, tabOf, withSection, withTab } from '@/vector/inspectorPrefs'

describe('what the inspector remembers', () => {
  it('opens a document it has never seen on Design', () => {
    expect(tabOf(EMPTY_PREFS, 'vector-1')).toBe('design')
  })

  it('keeps a tab per document', () => {
    const prefs = withTab(withTab(EMPTY_PREFS, 'a', 'controls'), 'b', 'history')
    expect(tabOf(prefs, 'a')).toBe('controls')
    expect(tabOf(prefs, 'b')).toBe('history')
    expect(tabOf(prefs, 'c')).toBe('design')
  })

  it('keeps folded sections for everyone, not per document', () => {
    const prefs = withSection(EMPTY_PREFS, 'effects', false)
    expect(isOpen(prefs, 'effects')).toBe(false)
    expect(isOpen(prefs, 'fill')).toBe(true)
    expect(isOpen(withSection(prefs, 'effects', true), 'effects')).toBe(true)
  })

  it('honours a section that starts folded', () => {
    expect(isOpen(EMPTY_PREFS, 'stroke-detail', false)).toBe(false)
  })

  it('folds a section once, however often it is asked', () => {
    const prefs = withSection(withSection(EMPTY_PREFS, 'fill', false), 'fill', false)
    expect(prefs.collapsed).toEqual(['fill'])
  })

  it('reads back nothing it does not recognise', () => {
    expect(parseInspectorPrefs(null)).toEqual(EMPTY_PREFS)
    expect(parseInspectorPrefs('nonsense')).toEqual(EMPTY_PREFS)
    expect(parseInspectorPrefs({ tabs: { a: 'design', b: 'nowhere' }, collapsed: ['fill', 7] })).toEqual({ tabs: { a: 'design' }, collapsed: ['fill'] })
  })
})
