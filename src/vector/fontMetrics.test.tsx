import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fontMetricsRevision, useFontMetricsRevision } from '@/vector/fontMetrics'
import { createVectorElement } from '@/vector/document'
import { renderModel } from '@/vector/render'
import { embedFonts } from '@/vector/export'

afterEach(() => vi.unstubAllGlobals())

describe('on-demand artwork fonts', () => {
  it('invalidates cached text on font completion and removes its listener on exit', () => {
    const fonts = new EventTarget()
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })
    const hook = renderHook(useFontMetricsRevision)
    const text = createVectorElement('text', { x: 0, y: 0, width: 100, height: 50 })
    const first = renderModel(text, 'font-test')
    const revision = fontMetricsRevision()
    expect(renderModel(text, 'font-test')).toBe(first)
    act(() => { fonts.dispatchEvent(new Event('loadingdone')) })
    expect(hook.result.current).toBe(revision + 1)
    expect(renderModel(text, 'font-test')).not.toBe(first)
    hook.unmount()
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(fontMetricsRevision()).toBe(revision + 1)
    Reflect.deleteProperty(document, 'fonts')
  })

  it.each(['Space Grotesk', 'Source Serif 4'])('embeds %s from this origin, with no external font request', async family => {
    const fetchFont = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
    vi.stubGlobal('fetch', fetchFont)
    const markup = await embedFonts(`<svg><text font-family="${family}">Aa</text></svg>`)
    expect(fetchFont).toHaveBeenCalledExactlyOnceWith(`/fonts/${family.replaceAll(' ', '')}.woff2`, { signal: expect.any(AbortSignal) })
    expect(markup).toContain(`font-family:'${family}'`)
    expect(markup).toContain('data:font/woff2;base64,AQID')
  })
})
