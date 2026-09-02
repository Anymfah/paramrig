import { describe, expect, it } from 'vitest'
import { assetCount, documentAssets, fontUsers, patternSources } from '@/vector/assets'
import { createVectorElement } from '@/vector/document'
import { patternFromElement } from '@/vector/patterns'
import type { VectorDocument, VectorElement } from '@/vector/types'

function documentWith(extra: Partial<VectorDocument>): VectorDocument {
  return {
    version: 1,
    id: 'vector-test',
    name: 'Test',
    background: '#151516',
    width: 800,
    height: 600,
    elements: [],
    guides: [],
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...extra,
  }
}

const rect = (id: string, patch: Partial<VectorElement> = {}): VectorElement => ({
  ...createVectorElement('rectangle', { x: 0, y: 0, width: 40, height: 40 }),
  id,
  ...patch,
})

describe('what a document reuses', () => {
  it('lists the five families, even when they are empty', () => {
    const groups = documentAssets(documentWith({}))
    expect(groups.map((group) => group.id)).toEqual(['components', 'styles', 'brushes', 'patterns', 'fonts'])
    expect(assetCount(groups)).toBe(3) // the three brushes that ship
  })

  it('counts what follows a style', () => {
    const document = documentWith({
      styles: [{ id: 'style-1', name: 'Ink', kind: 'fill', paints: [{ id: 'p', type: 'solid', color: '#112233', opacity: 1, visible: true }] }],
      elements: [rect('a', { fillStyleId: 'style-1' }), rect('b')],
    })
    const styles = documentAssets(document).find((group) => group.id === 'styles')!
    expect(styles.assets[0]).toMatchObject({ name: 'Ink', detail: 'Fill', userIds: ['a'] })
    expect(styles.assets[0]!.swatch).toBe('#112233')
  })

  it('finds the object a pattern stamps, and what it paints', () => {
    const tile = rect('tile')
    const painted = rect('painted')
    const paint = patternFromElement(tile, 'paint-1')
    const document = documentWith({ elements: [tile, { ...painted, fills: [paint] }] })
    expect([...patternSources(document.elements)]).toEqual([['tile', ['painted']]])
    const patterns = documentAssets(document).find((group) => group.id === 'patterns')!
    expect(patterns.assets[0]).toMatchObject({ name: 'Rectangle', detail: '40 × 40', sourceId: 'tile' })
  })

  it('marks the brushes that ship as untouchable, and keeps the document own ones editable', () => {
    const document = documentWith({ brushes: [{ id: 'mine', name: 'Mine', network: { nodes: [], segments: [] } }] })
    const brushes = documentAssets(document).find((group) => group.id === 'brushes')!
    expect(brushes.assets.map((asset) => [asset.name, asset.builtin ?? false])).toEqual([
      ['Round', true], ['Calligraphic', true], ['Dashed', true], ['Mine', false],
    ])
  })

  it('says which texts a font sets', () => {
    const elements = [
      { ...rect('t1'), kind: 'text' as const, fontFamily: 'Inter' },
      { ...rect('t2'), kind: 'text' as const, fontFamily: 'Other' },
    ]
    expect(fontUsers(elements, 'Inter')).toEqual(['t1'])
    const fonts = documentAssets(documentWith({ elements, fonts: [{ family: 'Inter', source: 'file', weights: [400], format: 'ttf' }] })).find((group) => group.id === 'fonts')!
    expect(fonts.assets[0]).toMatchObject({ name: 'Inter', detail: 'TTF', userIds: ['t1'] })
  })
})
