import { describe, expect, it } from 'vitest'
import { createVectorDocument, createVectorElement } from './model'
import { createVectorRenderer } from './browser'

describe('vector view lifecycle', () => {
  it('exports the latest pending update and discards superseded image work', async () => {
    const container = document.createElement('div')
    const original = createVectorDocument()
    original.elements.push({ ...createVectorElement('rectangle', { x: 0, y: 0, width: 40, height: 40 }), fill: '#112233' })
    let resolveImage: ((url: string) => void) | undefined
    let signal: AbortSignal | undefined
    const view = createVectorRenderer({ container, document: original, resources: { image: (_id, abort) => {
      signal = abort; return new Promise(resolve => { resolveImage = resolve })
    } } })
    await view.ready
    const next = structuredClone(original)
    next.elements[0]!.fill = '#aabbcc'
    next.elements.push({ ...createVectorElement('image', { x: 45, y: 0, width: 40, height: 40 }), image: 'host-image' })
    const update = view.update(next)
    const exported = view.exportSvg()
    let exportedYet = false
    void exported.then(() => { exportedYet = true })
    await Promise.resolve()
    expect(exportedYet).toBe(false)
    resolveImage!('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E')
    await update
    expect(await exported).toContain('#aabbcc')
    expect(original.elements).toHaveLength(1)
    const pending = view.update(next)
    view.destroy()
    expect(signal?.aborted).toBe(true)
    resolveImage!('data:image/svg+xml,%3Csvg/%3E')
    await pending
    expect(container.children).toHaveLength(0)
    await expect(view.exportSvg()).rejects.toThrow('unavailable')
  })
})
