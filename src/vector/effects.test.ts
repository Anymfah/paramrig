import { describe, expect, it } from 'vitest'
import { activeEffects, blendModeCss, boundsWithEffects, createEffect, effectFingerprint, effectPadding, filterRegion, hasEffects, sanitizeAdjustments, sanitizeBlendMode, sanitizeEffects } from '@/vector/effects'
import type { VectorEffect } from '@/vector/types'

const shadow = (patch: Partial<VectorEffect> = {}): VectorEffect => ({ ...createEffect('dropShadow', 'e1'), ...patch })

describe('sanitising effects', () => {
  it('keeps a well-formed shadow and clamps what is out of range', () => {
    const [effect] = sanitizeEffects([{ id: 'a', kind: 'dropShadow', visible: true, dx: 5, dy: 900000, blur: 1000, spread: 2, color: '#ff0000', opacity: 4 }])!

    expect(effect).toEqual({ id: 'a', kind: 'dropShadow', visible: true, dx: 5, dy: 2000, blur: 200, spread: 2, color: '#FF0000', opacity: 1 })
  })

  it('drops what is not an effect and returns nothing for an empty list', () => {
    expect(sanitizeEffects([{ kind: 'glow' }, null, 4])).toBeUndefined()
    expect(sanitizeEffects([])).toBeUndefined()
    expect(sanitizeEffects('shadow')).toBeUndefined()
  })

  it('keeps a blur down to its radius, without shadow fields', () => {
    const [effect] = sanitizeEffects([{ id: 'b', kind: 'layerBlur', blur: 12, dx: 40, color: '#fff' }])!

    expect(effect).toEqual({ id: 'b', kind: 'layerBlur', visible: true, blur: 12 })
  })

  it('falls back to black for a colour it cannot read', () => {
    expect(sanitizeEffects([{ id: 'c', kind: 'innerShadow', blur: 1, color: 'rebeccapurple' }])![0]!.color).toBe('#000000')
  })
})

describe('sanitising the blend mode and the adjustments', () => {
  it('keeps the modes it knows and forgets normal, which is the default anyway', () => {
    expect(sanitizeBlendMode('multiply')).toBe('multiply')
    expect(sanitizeBlendMode('normal')).toBeUndefined()
    expect(sanitizeBlendMode('sepia')).toBeUndefined()
  })

  it('writes blend modes the way CSS and SVG spell them', () => {
    expect(blendModeCss('colorDodge')).toBe('color-dodge')
    expect(blendModeCss('multiply')).toBe('multiply')
  })

  it('clamps adjustments and drops the ones left at zero', () => {
    expect(sanitizeAdjustments({ exposure: 3, contrast: 0, saturation: -9, nonsense: 1 })).toEqual({ exposure: 1, saturation: -1 })
    expect(sanitizeAdjustments({ exposure: 0 })).toBeUndefined()
    expect(sanitizeAdjustments(null)).toBeUndefined()
  })
})

describe('what an effect paints outside the box', () => {
  it('counts nothing when the effects are switched off or empty', () => {
    expect(hasEffects({ effects: [shadow({ visible: false })] })).toBe(false)
    expect(hasEffects({ effects: [shadow({ blur: 0, dx: 0, dy: 0, spread: 0 })] })).toBe(false)
    expect(activeEffects({ effects: undefined })).toEqual([])
  })

  it('reaches further on the side the shadow is pushed towards', () => {
    const padding = effectPadding([shadow({ dx: 10, dy: 0, blur: 10, spread: 0 })])

    expect(padding.right).toBe(25)
    expect(padding.left).toBe(5)
  })

  it('ignores the effects that stay inside the shape', () => {
    expect(effectPadding([{ id: 'i', kind: 'innerShadow', visible: true, dx: 30, dy: 30, blur: 40 }])).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(effectPadding([{ id: 'b', kind: 'backgroundBlur', visible: true, blur: 40 }])).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('gives a filter region that holds the whole shadow', () => {
    const region = filterRegion({ x: 100, y: 100, width: 50, height: 50 }, [shadow({ dx: 0, dy: 0, blur: 10, spread: 0 })])

    expect(region).toEqual({ x: 85, y: 85, width: 80, height: 80 })
  })

  it('grows an export box by the widest padding of the objects in it', () => {
    const box = boundsWithEffects({ x: 0, y: 0, width: 100, height: 100 }, [
      { effects: [shadow({ dx: 0, dy: 0, blur: 10, spread: 0 })] },
      { effects: [shadow({ dx: 0, dy: 0, blur: 4, spread: 0 })] },
      { effects: undefined },
    ])

    expect(box).toEqual({ x: -15, y: -15, width: 130, height: 130 })
  })
})

describe('the fingerprint the render cache keys on', () => {
  it('is empty for an object with nothing on it', () => {
    expect(effectFingerprint({})).toBe('')
  })

  it('changes as soon as anything about the effects changes', () => {
    const before = effectFingerprint({ effects: [shadow()] })

    expect(effectFingerprint({ effects: [shadow({ blur: 9 })] })).not.toBe(before)
    expect(effectFingerprint({ effects: [shadow()], blendMode: 'multiply' })).not.toBe(before)
    expect(effectFingerprint({ effects: [shadow()] })).toBe(before)
  })
})
