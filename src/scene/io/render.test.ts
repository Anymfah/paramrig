import { describe, expect, it } from 'vitest'
import { createSceneDocument } from '@/scene/document'
import { outputSize, renderTiles } from '@/scene/io/render'
import type { SceneDocument } from '@/scene/types'

/**
 * The render itself needs a graphics card; the arithmetic that decides what it draws does not, and
 * that arithmetic is where a render goes wrong — a tile that overhangs the edge leaves a seam, and
 * a percentage read the wrong way round leaves an image nobody asked for.
 */

function withOutput(output: NonNullable<SceneDocument['output']>): SceneDocument {
  return { ...createSceneDocument(), output }
}

describe('cutting an image into tiles', () => {
  it('gives one tile when the image fits in one', () => {
    expect(renderTiles(800, 600, 1024)).toEqual([{ x: 0, y: 0, width: 800, height: 600 }])
  })

  it('covers every pixel exactly once', () => {
    const tiles = renderTiles(2000, 1500, 512)
    const area = tiles.reduce((total, tile) => total + tile.width * tile.height, 0)
    expect(area).toBe(2000 * 1500)
    // No tile reaches past the edge, or its share of the camera's view offset would be wrong.
    expect(tiles.every((tile) => tile.x + tile.width <= 2000 && tile.y + tile.height <= 1500)).toBe(true)
  })

  it('reads left to right and top to bottom, so progress goes forwards', () => {
    const tiles = renderTiles(200, 200, 100)
    expect(tiles.map((tile) => `${tile.x},${tile.y}`)).toEqual(['0,0', '100,0', '0,100', '100,100'])
  })

  it('refuses to cut an image into pieces smaller than sixteen pixels', () => {
    expect(renderTiles(64, 64, 1)).toHaveLength(16)
  })
})

describe('the size an image is rendered at', () => {
  it('is the output’s own, at a hundred per cent', () => {
    expect(outputSize(withOutput({ width: 1920, height: 1080, percentage: 100, transparent: false })))
      .toEqual({ width: 1920, height: 1080 })
  })

  it('scales by the percentage, which is how a draft is made small', () => {
    expect(outputSize(withOutput({ width: 1920, height: 1080, percentage: 50, transparent: false })))
      .toEqual({ width: 960, height: 540 })
  })

  it('bounds what a graphics card will be asked for', () => {
    const size = outputSize(withOutput({ width: 16000, height: 9000, percentage: 400, transparent: false }), 8192)
    expect(size.width).toBe(8192)
    expect(size.height).toBe(8192)
  })

  it('falls back to Blender’s own frame when the document says nothing', () => {
    expect(outputSize(createSceneDocument())).toEqual({ width: 1920, height: 1080 })
  })
})
