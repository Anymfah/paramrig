import { describe, expect, it } from 'vitest'
import { clampCrop, cropForBox, displayRect, droppedImageBounds, FULL_CROP, isFullCrop, panCrop, resetCropBox, resizeCrop, sanitizeCrop } from '@/vector/crop'

const box = { x: 100, y: 100, width: 200, height: 100 }

describe('where the picture sits', () => {
  it('places the whole picture over the box when nothing is cropped', () => {
    expect(displayRect(box)).toEqual(box)
  })

  it('scales the picture up so the cropped part fills the box', () => {
    const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 }

    expect(displayRect(box, crop)).toEqual({ x: 0, y: 0, width: 400, height: 200 })
  })

  it('reads a box back as the crop it describes', () => {
    const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 }
    const display = displayRect(box, crop)

    expect(cropForBox(display, box)).toMatchObject(crop)
  })
})

describe('crop limits', () => {
  it('keeps a crop inside the picture', () => {
    expect(clampCrop({ x: -0.4, y: 0.9, width: 0.5, height: 0.5 })).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 })
  })

  it('never lets a crop vanish or exceed the picture', () => {
    expect(clampCrop({ x: 0, y: 0, width: 0, height: 4 })).toMatchObject({ width: 0.02, height: 1 })
  })

  it('knows a full crop from a partial one', () => {
    expect(isFullCrop(undefined)).toBe(true)
    expect(isFullCrop(FULL_CROP)).toBe(true)
    expect(isFullCrop({ x: 0, y: 0, width: 0.5, height: 1 })).toBe(false)
  })
})

describe('dragging the crop window', () => {
  it('pulls one edge in and leaves the picture where it was', () => {
    const before = displayRect(box)

    const result = resizeCrop(box, FULL_CROP, 'w', { x: 150, y: 0 })

    expect(result.box).toMatchObject({ x: 150, width: 150 })
    expect(result.crop).toMatchObject({ x: 0.25, width: 0.75 })
    expect(displayRect(result.box, result.crop)).toMatchObject({ x: before.x, width: before.width })
  })

  it('stops at the edge of the picture instead of showing nothing', () => {
    const result = resizeCrop(box, FULL_CROP, 'w', { x: 20, y: 0 })

    expect(result.box.x).toBe(100)
    expect(result.crop).toMatchObject({ x: 0, width: 1 })
  })

  it('keeps a corner drag from collapsing the box', () => {
    const result = resizeCrop(box, FULL_CROP, 'se', { x: 100, y: 100 })

    expect(result.box.width).toBeGreaterThanOrEqual(4)
    expect(result.box.height).toBeGreaterThanOrEqual(4)
  })
})

describe('sliding the picture under the box', () => {
  it('moves the crop the other way', () => {
    const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

    const panned = panCrop(box, crop, { x: 100, y: 0 })

    expect(panned.x).toBeCloseTo(0)
    expect(panned.y).toBeCloseTo(0.25)
  })

  it('stops at the edge of the picture', () => {
    const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

    expect(panCrop(box, crop, { x: -1000, y: 0 }).x).toBeCloseTo(0.5)
  })
})

describe('showing the whole picture again', () => {
  it('gives the box the picture had', () => {
    const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 }

    expect(resetCropBox(box, crop)).toEqual({ x: 0, y: 0, width: 400, height: 200 })
  })
})

describe('sanitising a stored crop', () => {
  it('keeps a partial crop and forgets a full one', () => {
    expect(sanitizeCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 })
    expect(sanitizeCrop({ x: 0, y: 0, width: 1, height: 1 })).toBeUndefined()
    expect(sanitizeCrop({ x: 'a', y: 0, width: 1, height: 1 })).toBeUndefined()
    expect(sanitizeCrop(null)).toBeUndefined()
  })
})

describe('a picture dropped on the canvas', () => {
  it('lands at its natural size, centred on the drop', () => {
    expect(droppedImageBounds({ width: 200, height: 100 }, { x: 300, y: 300 })).toEqual({ x: 200, y: 250, width: 200, height: 100 })
  })

  it('shrinks a big picture but keeps its shape', () => {
    const bounds = droppedImageBounds({ width: 4000, height: 2000 }, { x: 0, y: 0 })

    expect(bounds.width).toBe(640)
    expect(bounds.height).toBe(320)
  })
})
