import { describe, expect, it } from 'vitest'
import { DEAL, FACES, FOLD, KEEP, PLATE, fitPlate, plateBox } from '@/audio/faces'

describe('the faces of the plate', () => {
  it('keeps the wide face wherever it reads comfortably and fills the room, at the scale that fits it whole', () => {
    expect(fitPlate(1500, 744)).toEqual({ layout: 'wide', scale: Math.min(1500 / PLATE.w, 744 / PLATE.h) })
    expect(fitPlate(1200, 852)).toEqual({ layout: 'wide', scale: 1200 / PLATE.w })
    // A big screen gets a big plate, as the plugin's own zoom would give it.
    expect(fitPlate(2000, 1200).layout).toBe('wide')
    expect(fitPlate(2000, 1200).scale).toBeGreaterThan(1)
    expect(KEEP).toBeGreaterThan(FOLD)
  })

  it('folds to the face that fills the room best once the wide one would leave it half empty or read small', () => {
    // A laptop with the rail open: taller than the reference is wide, and a third of it was empty.
    const laptop = fitPlate(1046, 835)
    expect(laptop.layout).toBe('medium')
    expect(laptop.scale).toBeCloseTo(Math.min(1046 / FACES.medium.w, 835 / FACES.medium.h), 6)
    expect(laptop.scale).toBeGreaterThan(1046 / PLATE.w)
    // A wider one still, but tall: the wide face would read well and fill two thirds; the medium fills it.
    expect(fitPlate(1230, 992).layout).toBe('medium')
    expect(fitPlate(784, 687).layout).toBe('medium')
    // A tablet upright is the narrow face's room.
    const tablet = fitPlate(820, 1038)
    expect(tablet.layout).toBe('narrow')
    expect(tablet.scale).toBeCloseTo(Math.min(820 / FACES.narrow.w, 1038 / FACES.narrow.h), 6)
  })

  it('keeps a readable size and lets the room scroll when no face fits it whole', () => {
    // Wide but short: the wide face, at the width's scale and no bigger than the reference.
    expect(fitPlate(1200, 400)).toEqual({ layout: 'wide', scale: Math.min(1, 1200 / PLATE.w) })
    // Narrower than that: the medium face, then the narrow, each at its own size.
    expect(fitPlate(900, 500)).toEqual({ layout: 'medium', scale: 1 })
    expect(fitPlate(430, 680)).toEqual({ layout: 'narrow', scale: 430 / FACES.narrow.w })
  })

  it('deals every panel once on each face, the routing bar in a row of its own', () => {
    for (const layout of ['wide', 'medium', 'narrow'] as const) {
      const rows = DEAL[layout]
      const items = rows.flatMap((row) => (row === 'routing' ? [] : row))
      expect([...items].sort()).toEqual(['amp', 'filter', 'fx', 'insert', 'modulators', 'noise', 'osc', 'pitch'])
      expect(rows.filter((row) => row === 'routing')).toHaveLength(1)
      for (const row of rows) if (row !== 'routing') expect(row.length).toBeGreaterThan(0)
    }
    // The wide face is the reference's: the seven panels on one row, the modulators on their own.
    expect(DEAL.wide[0]).toEqual(['pitch', 'osc', 'noise', 'insert', 'filter', 'amp', 'fx'])
    expect(DEAL.wide[2]).toEqual(['modulators'])
    // The medium face keeps the inserts beside the noise and gives the modulator the effects' row.
    expect(DEAL.medium[0]).toContain('insert')
    expect(DEAL.medium[2]).toEqual(['filter', 'amp', 'fx', 'modulators'])
    // The narrow face gives the modulator a row under the routing bar.
    expect(DEAL.narrow[DEAL.narrow.length - 1]).toEqual(['modulators'])
  })

  it('lays the plate out in a box no smaller than the face, that the room fills at the face\'s scale', () => {
    expect(plateBox('wide', 1, { w: 0, h: 0 })).toEqual(PLATE)
    expect(plateBox('wide', 0.5, { w: 1250, h: 900 })).toEqual({ w: 2500, h: 1800 })
    expect(plateBox('narrow', 1, { w: 600, h: 500 })).toEqual(FACES.narrow)
  })

  it('is taller than it is wide only when folded', () => {
    expect(FACES.wide.w / FACES.wide.h).toBeGreaterThan(1.5)
    expect(FACES.medium.w).toBeGreaterThan(FACES.medium.h)
    expect(FACES.narrow.h).toBeGreaterThan(FACES.narrow.w)
  })
})
