import { describe, expect, it } from 'vitest'
import { makeLayer, makePatch } from '@/audio/patch'
import { monoSum, pmOrder, renderPatch } from '@/audio/dsp/render'

/**
 * The matrix, which is the one thing here that makes the layers stop being independent.
 *
 * A layer whose phase is modulated by another has to wait for it, so there is an order; and two
 * layers naming each other have no order at all, so there is a rule for that too.
 */

const voice = (over: object = {}) => makeLayer({
  gain: 0.8,
  source: { kind: 'tone', wave: 'sine', fmRatio: 2, fmIndex: 4, fmFall: 0, ...over },
  pitch: { start: 220 },
  amp: { attack: 0.002, hold: 0.2, decay: 0.1, sustain: 0.5, release: 0.05, curve: 1 },
})

const four = (...over: object[]) => makePatch(0.3, over.map((one) => voice(one)))

const loudness = (patch: Parameters<typeof renderPatch>[0]) => {
  const out = monoSum(renderPatch(patch, 22050))
  let sum = 0
  for (const value of out) sum += value * value
  return Math.sqrt(sum / out.length)
}

describe('pmOrder', () => {
  it('leaves four independent layers in the order they are written', () => {
    const { order, from } = pmOrder(four({}, {}, {}, {}).layers)
    expect(order).toEqual([0, 1, 2, 3])
    expect(from).toEqual([null, null, null, null])
  })

  it('puts a layer after the one that modulates it, however they are written', () => {
    const { order, from } = pmOrder(four({ pmFrom: 'layer3' }, { pmFrom: 'layer0' }, {}, {}).layers)
    expect(from).toEqual([3, 0, null, null])
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(0))
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(1))
  })

  it('refuses a layer that names itself, and plays it with its own modulator', () => {
    const { order, from } = pmOrder(four({ pmFrom: 'layer0' }, {}, {}, {}).layers)
    expect(from[0]).toBeNull()
    expect(order).toHaveLength(4)
  })

  it('refuses a layer that names one which is not there', () => {
    expect(pmOrder(four({ pmFrom: 'layer9' }, {}, {}, {}).layers).from[0]).toBeNull()
    expect(pmOrder(four({ pmFrom: 'nonsense' }, {}, {}, {}).layers).from[0]).toBeNull()
  })

  it('breaks a ring rather than deadlocking on it', () => {
    const { order, from } = pmOrder(four({ pmFrom: 'layer1' }, { pmFrom: 'layer0' }, {}, {}).layers)
    expect(from[0]).toBeNull()
    expect(from[1]).toBeNull()
    expect([...order].sort()).toEqual([0, 1, 2, 3])
  })

  it('keeps a chain of three, longest last', () => {
    const { order, from } = pmOrder(four({ pmFrom: 'layer1' }, { pmFrom: 'layer2' }, {}, {}).layers)
    expect(from).toEqual([1, 2, null, null])
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1))
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(0))
  })
})

describe('a layer modulated by another layer', () => {
  it('sounds different from the same layer modulated by its own oscillator', () => {
    const own = monoSum(renderPatch(four({}, { gain: 0.4 }), 22050))
    const other = monoSum(renderPatch(four({ pmFrom: 'layer1' }, { gain: 0.4 }), 22050))
    let apart = 0
    for (let at = 0; at < own.length; at += 1) apart += Math.abs((own[at] ?? 0) - (other[at] ?? 0))
    expect(apart).toBeGreaterThan(1)
  })

  it('is modulated by a layer turned all the way down, which is what a modulator oscillator is', () => {
    // The reading is taken before the level, so silencing the modulator does not silence what it does.
    const heard = renderPatch(four({ pmFrom: 'layer1' }, { gain: 0.4 }), 22050)
    const silent = renderPatch(four({ pmFrom: 'layer1' }, { gain: 0 }), 22050)
    const alone = renderPatch(four({ fmIndex: 0 }, { gain: 0 }), 22050)
    let bent = 0
    for (let at = 0; at < silent.left.length; at += 1) bent += Math.abs((silent.left[at] ?? 0) - (alone.left[at] ?? 0))
    expect(bent).toBeGreaterThan(1)
    expect(loudness(four({ pmFrom: 'layer1' }, { gain: 0 }))).toBeGreaterThan(0.005)
    expect(heard.left.length).toBe(silent.left.length)
  })

  it('stays finite and inside full scale through a chain and through a ring', () => {
    for (const patch of [
      four({ pmFrom: 'layer1' }, { pmFrom: 'layer2' }, { pmFrom: 'layer3' }, {}),
      four({ pmFrom: 'layer1' }, { pmFrom: 'layer0' }, {}, {}),
      four({ pmFrom: 'layer0' }, {}, {}, {}),
    ]) {
      const out = renderPatch(patch, 22050)
      for (const value of out.left) {
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('renders the same twice, which a graph resolved at render time could easily not', () => {
    const patch = four({ pmFrom: 'layer2' }, { pmFrom: 'layer3' }, {}, {})
    expect(Array.from(renderPatch(patch, 22050).left)).toEqual(Array.from(renderPatch(patch, 22050).left))
  })
})
