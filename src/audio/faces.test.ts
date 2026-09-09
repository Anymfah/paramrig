import { describe, expect, it } from 'vitest'
import { DEAL, FACES, FOLD, KEEP, PLATE, fitPlate } from '@/audio/faces'

describe('the faces of the plate', () => {
  it('keeps the wide face wherever it reads comfortably, at the scale that fits the room whole', () => {
    expect(fitPlate(1500, 744)).toEqual({ layout: 'wide', scale: Math.min(1500 / PLATE.w, 744 / PLATE.h) })
    expect(fitPlate(1200, 852)).toEqual({ layout: 'wide', scale: 1200 / PLATE.w })
    // A big screen gets a big plate, as the plugin's own zoom would give it.
    expect(fitPlate(2000, 1200).layout).toBe('wide')
    expect(fitPlate(2000, 1200).scale).toBeGreaterThan(1)
    expect(KEEP).toBeGreaterThan(FOLD)
  })

  it('folds to the face that fills the room best once the wide one would read small', () => {
    // A laptop with the rail open: taller than the reference is wide, and a third of it was empty.
    const laptop = fitPlate(1046, 835)
    expect(laptop.layout).toBe('medium')
    expect(laptop.scale).toBeCloseTo(Math.min(1046 / FACES.medium.w, 835 / FACES.medium.h), 6)
    expect(laptop.scale).toBeGreaterThan(1046 / PLATE.w)
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

  it('deals every item once on each face, the routing bar between two rules', () => {
    for (const layout of ['wide', 'medium', 'narrow'] as const) {
      const { order, grow, rules } = DEAL[layout]
      // A rule takes a line of its own, so its order is never an item's.
      for (const rule of rules) expect(Object.values(order)).not.toContain(rule)
      expect(rules).toContain(order.routing - 1)
      expect(rules).toContain(order.routing + 1)
      for (const item of grow) expect(order).toHaveProperty(item)
      // The wide face is the reference's: nothing grows, and the panels share one line.
      if (layout === 'wide') {
        expect(grow).toEqual([])
        expect(new Set([order.pitch, order.osc, order.noise, order.body, order.filter, order.amp, order.fx]).size).toBe(1)
      }
    }
    // The medium face keeps the body beside the noise and gives the modulator the effects' line.
    expect(DEAL.medium.order.body).toBe(DEAL.medium.order.noise)
    expect(DEAL.medium.order.modulators).toBe(DEAL.medium.order.fx)
    // The narrow face gives the modulator a line under the routing bar.
    expect(DEAL.narrow.order.modulators).toBeGreaterThan(DEAL.narrow.order.routing)
  })

  it('is taller than it is wide only when folded', () => {
    expect(FACES.wide.w / FACES.wide.h).toBeGreaterThan(1.5)
    expect(FACES.medium.w).toBeGreaterThan(FACES.medium.h)
    expect(FACES.narrow.h).toBeGreaterThan(FACES.narrow.w)
  })
})
