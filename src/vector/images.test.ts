import { describe, expect, it } from 'vitest'
import { compressImageDataUrl, dataUrlBytes } from '@/vector/images'

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('image budget', () => {
  it('measures the decoded size of a base64 data URL', () => {
    expect(dataUrlBytes(PIXEL)).toBe(70)
    expect(dataUrlBytes('data:image/svg+xml,%3Csvg%3E')).toBe(5)
    expect(dataUrlBytes('nonsense')).toBe(0)
  })

  it('leaves an image that already fits alone', async () => {
    await expect(compressImageDataUrl(PIXEL, 1024)).resolves.toBe(PIXEL)
  })

  it('leaves vector data alone because rasterising it would not help', async () => {
    const svg = `data:image/svg+xml,${'%3Csvg%3E'.repeat(200)}`

    await expect(compressImageDataUrl(svg, 32)).resolves.toBe(svg)
  })

  it('leaves anything that is not an image alone', async () => {
    await expect(compressImageDataUrl('data:text/plain,hello', 1)).resolves.toBe('data:text/plain,hello')
  })
})
