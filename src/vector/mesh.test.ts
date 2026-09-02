import { describe, expect, it } from 'vitest'
import { defaultMesh, meshCells, meshColorAt, meshPoint, meshSubdivisions, mixColor, sanitizeMesh, splitMesh } from '@/vector/mesh'

const box = { x: 0, y: 0, width: 100, height: 100 }

describe('a mesh to start from', () => {
  it('is one patch with a colour at each corner', () => {
    const mesh = defaultMesh()

    expect(mesh).toMatchObject({ rows: 1, cols: 1 })
    expect(mesh.points).toHaveLength(4)
    expect(meshPoint(mesh, 1, 1)).toMatchObject({ x: 1, y: 1 })
  })
})

describe('cutting a patch into cells', () => {
  it('covers the box, corner to corner', () => {
    const cells = meshCells(defaultMesh(), box, 4)
    const numbers = cells.flatMap((cell) => [...cell.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]!), Number(match[2]!)] as const))

    expect(cells).toHaveLength(16)
    expect(Math.min(...numbers.map(([x]) => x))).toBe(0)
    expect(Math.max(...numbers.map(([x]) => x))).toBe(100)
    expect(Math.max(...numbers.map(([, y]) => y))).toBe(100)
  })

  it('carries the corner colours into the corner cells', () => {
    const mesh = defaultMesh(['#FF0000', '#00FF00', '#0000FF', '#FFFFFF'])
    const cells = meshCells(mesh, box, 16)

    // The first cell sits in the top-left corner; its colour is nearly the corner's own.
    expect(cells[0]!.color).toBe(mixColor(mixColor('#FF0000', '#00FF00', 1 / 32), mixColor('#0000FF', '#FFFFFF', 1 / 32), 1 / 32))
    expect(cells[0]!.color.startsWith('#F')).toBe(true)
  })

  it('reads the colour anywhere in a patch, exactly at the corners', () => {
    const mesh = defaultMesh(['#FF0000', '#00FF00', '#0000FF', '#FFFFFF'])

    expect(meshColorAt(mesh, 0, 0, 0, 0)).toBe('#FF0000')
    expect(meshColorAt(mesh, 0, 0, 1, 0)).toBe('#00FF00')
    expect(meshColorAt(mesh, 0, 0, 0, 1)).toBe('#0000FF')
    expect(meshColorAt(mesh, 0, 0, 1, 1)).toBe('#FFFFFF')
    expect(meshColorAt(mesh, 0, 0, 0.5, 0)).toBe('#808000')
  })

  it('cuts finer for a bigger patch, within reason', () => {
    expect(meshSubdivisions(20)).toBe(8)
    expect(meshSubdivisions(240)).toBe(20)
    expect(meshSubdivisions(4000)).toBe(32)
  })
})

describe('adding lines to a mesh', () => {
  it('adds a row and a column through the point, and colours the new knots', () => {
    const mesh = splitMesh(defaultMesh(['#FF0000', '#00FF00', '#0000FF', '#FFFFFF']), { x: 0.5, y: 0.5 })

    expect(mesh).toMatchObject({ rows: 2, cols: 2 })
    expect(mesh.points).toHaveLength(9)
    expect(meshPoint(mesh, 1, 1)).toMatchObject({ x: 0.5, y: 0.5 })
    expect(meshPoint(mesh, 1, 1).color).toBe('#808080')
  })

  it('keeps the corners where they were', () => {
    const mesh = splitMesh(defaultMesh(), { x: 0.25, y: 0.75 })

    expect(meshPoint(mesh, 0, 0)).toMatchObject({ x: 0, y: 0 })
    expect(meshPoint(mesh, 2, 2)).toMatchObject({ x: 1, y: 1 })
  })

  it('stops at eight lines each way', () => {
    let mesh = defaultMesh()
    for (let index = 0; index < 20; index += 1) mesh = splitMesh(mesh, { x: 0.5, y: 0.5 })

    expect(mesh.rows).toBe(8)
    expect(mesh.cols).toBe(8)
  })
})

describe('sanitising a mesh', () => {
  it('keeps a grid whose points match its size', () => {
    expect(sanitizeMesh(defaultMesh())).toMatchObject({ rows: 1, cols: 1 })
  })

  it('refuses one whose points do not', () => {
    expect(sanitizeMesh({ rows: 2, cols: 2, points: defaultMesh().points })).toBeUndefined()
    expect(sanitizeMesh(null)).toBeUndefined()
  })

  it('clamps the points into the box and falls back on a colour it cannot read', () => {
    const mesh = sanitizeMesh({ rows: 1, cols: 1, points: [{ x: -3, y: 9, color: 'red' }, { x: 1, y: 0, color: '#abcdef' }, { x: 0, y: 1, color: '#000000' }, { x: 1, y: 1, color: '#FFFFFF' }] })!

    expect(mesh.points[0]).toEqual({ x: 0, y: 1, color: '#808080' })
    expect(mesh.points[1]!.color).toBe('#ABCDEF')
  })
})
