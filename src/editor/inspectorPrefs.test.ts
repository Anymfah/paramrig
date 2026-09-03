import { describe, expect, it } from 'vitest'
import { inspectorPrefsStore, isOpen, modeOf, tabOf, withMode, withSection, withTab } from '@/editor/inspectorPrefs'

const store = inspectorPrefsStore<'object' | 'history', { tool: string }>({
  key: 'paramrig.test-inspector.v1',
  tabs: ['object', 'history'],
  defaultTab: 'object',
  extra: { empty: { tool: 'select' }, parse: (value) => ({ tool: typeof value.tool === 'string' ? value.tool : 'select' }) },
})

describe('what an inspector remembers, whichever editor it belongs to', () => {
  it('falls back to the tab the caller names', () => {
    expect(tabOf(store.empty, 'scene-1', 'object')).toBe('object')
    expect(tabOf(withTab(store.empty, 'scene-1', 'history'), 'scene-1', 'object')).toBe('history')
  })

  it('drops a tab name the editor does not have', () => {
    expect(store.parse({ tabs: { a: 'history', b: 'nowhere' } }).tabs).toEqual({ a: 'history' })
  })

  it('keeps a folded section folded, and reads back what the editor added of its own', () => {
    const folded = withSection(store.empty, 'modifiers', false)
    expect(isOpen(folded, 'modifiers')).toBe(false)
    expect(isOpen(folded, 'transform')).toBe(true)
    expect(store.parse({ tool: 'move' }).tool).toBe('move')
    expect(store.parse({ tool: 7 }).tool).toBe('select')
  })

  it('opens a document the way it was left', () => {
    expect(modeOf(store.empty, 'scene-1')).toBe('edit')
    expect(modeOf(withMode(store.empty, 'scene-1', 'tune'), 'scene-1')).toBe('tune')
    expect(store.parse({ modes: { a: 'tune', b: 'sideways' } }).modes).toEqual({ a: 'tune' })
  })

  it('reads nonsense as an empty memory rather than throwing', () => {
    expect(store.parse(null)).toEqual(store.empty)
    expect(store.parse('nope')).toEqual(store.empty)
    expect(store.parse({ collapsed: 'not a list' }).collapsed).toEqual([])
  })
})
