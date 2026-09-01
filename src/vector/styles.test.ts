import { describe, expect, it } from 'vitest'
import { createVectorDocument, createVectorElement, sanitizeVectorDocument } from '@/vector/document'
import {
  applyStylePatch,
  detachStylePatch,
  linkedStyle,
  pruneStyleLinks,
  pushRecentColor,
  sanitizeColorList,
  sanitizeStyles,
  styleFromElement,
  styleUsage,
  syncStylePatches,
  toggleSwatch,
  MAX_RECENT_COLORS,
} from '@/vector/styles'
import type { VectorElement, VectorStyle } from '@/vector/types'

const box = (patch: Partial<VectorElement> = {}): VectorElement => ({
  ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }),
  ...patch,
})

describe('styles', () => {
  it('takes a fill style from what an element paints', () => {
    const style = styleFromElement(box({ fill: '#123456' }), 'fill', '  Brand  ', 's1')

    expect(style).toMatchObject({ id: 's1', kind: 'fill', name: 'Brand' })
    expect(style.paints).toHaveLength(1)
    expect(style.paints[0]).toMatchObject({ type: 'solid', color: '#123456' })
  })

  it('takes the contour properties into a stroke style, and nothing extra into a fill one', () => {
    const element = box({ stroke: '#222222', strokeWidth: 6, strokeCap: 'round', strokeDash: [4, 2] })

    const stroke = styleFromElement(element, 'stroke', 'Hairline', 's2')
    const fill = styleFromElement(element, 'fill', 'Paper', 's3')

    expect(stroke).toMatchObject({ strokeWidth: 6, strokeCap: 'round', strokeDash: [4, 2] })
    expect(fill).not.toHaveProperty('strokeWidth')
  })

  it('applies a style to several objects at once and records the link', () => {
    const style = styleFromElement(box({ fill: '#AA0000' }), 'fill', 'Red', 's1')
    const elements = [box({ id: 'a' }), box({ id: 'b' }), box({ id: 'c', fill: '#00FF00' })]

    const linked = elements.slice(0, 2).map((element) => ({ ...element, ...applyStylePatch(style) }))

    expect(linked.every((element) => element.fillStyleId === 's1')).toBe(true)
    expect(linked.every((element) => element.fill === '#AA0000')).toBe(true)
    expect(styleUsage([...linked, elements[2]!], style)).toBe(2)
  })

  it('repaints every linked object when the style changes', () => {
    const style = styleFromElement(box({ fill: '#AA0000' }), 'fill', 'Red', 's1')
    const elements = [
      { ...box({ id: 'a' }), ...applyStylePatch(style) },
      { ...box({ id: 'b' }), ...applyStylePatch(style) },
      box({ id: 'c', fill: '#00FF00' }),
    ]
    const updated: VectorStyle = { ...style, paints: [{ id: 'p', type: 'solid', color: '#0000FF', opacity: 1, visible: true }] }

    const patches = syncStylePatches(elements, updated)

    expect(patches.map((patch) => patch.id)).toEqual(['a', 'b'])
    expect(patches[0]!.patch.fill).toBe('#0000FF')
    expect(patches[0]!.patch.fills?.[0]).toMatchObject({ color: '#0000FF' })
  })

  it('keeps the look but cuts the link when detached', () => {
    const style = styleFromElement(box({ fill: '#AA0000' }), 'fill', 'Red', 's1')
    const element = { ...box({ id: 'a' }), ...applyStylePatch(style) }

    const detached = { ...element, ...detachStylePatch('fill') }

    expect(detached.fillStyleId).toBeUndefined()
    expect(detached.fill).toBe('#AA0000')
    expect(syncStylePatches([detached], style)).toEqual([])
  })

  it('finds the style an element follows, and only for the right kind', () => {
    const fillStyle = styleFromElement(box({ fill: '#AA0000' }), 'fill', 'Red', 's1')
    const strokeStyle = styleFromElement(box({ stroke: '#00AA00' }), 'stroke', 'Green', 's2')
    const element = { ...box(), ...applyStylePatch(fillStyle) }

    expect(linkedStyle([fillStyle, strokeStyle], element, 'fill')?.id).toBe('s1')
    expect(linkedStyle([fillStyle, strokeStyle], element, 'stroke')).toBeNull()
    expect(linkedStyle([strokeStyle], element, 'fill')).toBeNull()
  })

  it('drops links to styles the document no longer holds', () => {
    const elements = [box({ id: 'a', fillStyleId: 'gone' }), box({ id: 'b', strokeStyleId: 's2' })]
    const styles = sanitizeStyles([{ id: 's2', name: 'Green', kind: 'stroke', paints: [{ id: 'p', type: 'solid', color: '#00AA00', opacity: 1, visible: true }] }])!

    const pruned = pruneStyleLinks(elements, styles)

    expect(pruned[0]!.fillStyleId).toBeUndefined()
    expect(pruned[1]!.strokeStyleId).toBe('s2')
  })
})

describe('style sanitising', () => {
  const sound = { id: 's1', name: 'Brand', kind: 'fill', paints: [{ id: 'p', type: 'solid', color: '#112233', opacity: 1, visible: true }] }

  it('keeps sound styles and drops the rest', () => {
    const styles = sanitizeStyles([
      sound,
      { ...sound, id: 's1' },
      { id: 's2', name: '   ', kind: 'fill', paints: sound.paints },
      { id: 's3', name: 'No paints', kind: 'fill' },
      { id: 's4', name: 'Odd kind', kind: 'gradientish', paints: sound.paints },
    ])

    expect(styles?.map((style) => style.id)).toEqual(['s1', 's4'])
    expect(styles?.[1]!.kind).toBe('fill')
  })

  it('keeps the contour properties of a stroke style within range', () => {
    const styles = sanitizeStyles([{ ...sound, id: 's5', kind: 'stroke', strokeWidth: -3, strokeCap: 'square', strokeAlign: 'sideways', strokeDash: [4, 2] }])

    expect(styles?.[0]).toMatchObject({ kind: 'stroke', strokeWidth: 0, strokeCap: 'square', strokeDash: [4, 2] })
    expect(styles?.[0]).not.toHaveProperty('strokeAlign')
  })

  it('rides through a document round trip, links included', () => {
    const document = {
      ...createVectorDocument(),
      elements: [box({ id: 'a', fillStyleId: 's1' })],
      styles: sanitizeStyles([sound]),
      swatches: ['#112233'],
      recentColors: ['#445566'],
    }

    const clean = sanitizeVectorDocument(document)

    expect(clean?.styles?.[0]?.name).toBe('Brand')
    expect(clean?.elements[0]?.fillStyleId).toBe('s1')
    expect(clean?.swatches).toEqual(['#112233'])
    expect(clean?.recentColors).toEqual(['#445566'])
  })
})

describe('colour rows', () => {
  it('keeps the most recent first, without repeats, capped', () => {
    let recent = pushRecentColor([], '#111111')
    recent = pushRecentColor(recent, '#222222')
    recent = pushRecentColor(recent, '#111111')

    expect(recent).toEqual(['#111111', '#222222'])

    for (let index = 0; index < 20; index += 1) recent = pushRecentColor(recent, `#0000${index.toString(16).padStart(2, '0')}`)

    expect(recent).toHaveLength(MAX_RECENT_COLORS)
  })

  it('ignores anything that is not a hex colour', () => {
    expect(pushRecentColor(['#111111'], 'none')).toEqual(['#111111'])
    expect(toggleSwatch(['#111111'], 'rgb(0,0,0)')).toEqual(['#111111'])
  })

  it('adds a swatch once and removes it on request', () => {
    const added = toggleSwatch([], '#abcdef')

    expect(added).toEqual(['#ABCDEF'])
    expect(toggleSwatch(added, '#ABCDEF')).toEqual(['#ABCDEF'])
    expect(toggleSwatch(added, '#abcdef', true)).toEqual([])
  })

  it('normalises a stored list and drops what is not a colour', () => {
    expect(sanitizeColorList(['#aabbcc', 'red', '#aabbcc', 42], 12)).toEqual(['#AABBCC'])
    expect(sanitizeColorList('nope', 12)).toBeUndefined()
    expect(sanitizeColorList([], 12)).toBeUndefined()
  })
})
