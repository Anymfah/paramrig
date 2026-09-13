import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
import { LFO_DESTINATIONS } from '@/audio/fields'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import type { AudioPatch } from '@/audio/types'

/**
 * The family that exists to be played through.
 *
 * `presets-morph.test.ts` guards the other showcase family, and guards it one subsystem at a time,
 * because that is what those sounds are. These are guarded differently: what has to stay true here
 * is that several subsystems are running *at once* in one patch, and that the things nothing else
 * in the library ever reaches for are still reached for. Six of the ten modulation destinations,
 * `pan` on a layer, a row other than the first — all of them had a count of zero across a hundred
 * and six presets before this file, so a change that quietly stopped them working would pass every
 * other test in the repository.
 */

const RATE = 44100
const family = PRESETS.filter((preset) => preset.group === 'Showpiece')
const built = family.map((preset) => ({ id: preset.id, patch: preset.build() }))

const layers = (patch: AudioPatch) => patch.layers.filter((layer) => layer.enabled)
const slots = (patch: AudioPatch) => layers(patch).flatMap((layer) => [layer.insertA, layer.insertB, layer.insertC])
const modsOn = (patch: AudioPatch) => patch.mods.filter((mod) => mod.enabled)
const drawn = (patch: AudioPatch) => patch.performers.filter((performer) => performer.enabled)
/** Where every modulator in the family points, with the layer number taken off. */
const destinations = new Set(built.flatMap(({ patch }) => [
  ...modsOn(patch).map((mod) => mod.target),
  ...drawn(patch).map((performer) => performer.target),
]).map((target) => String(target).replace(/^layers\[\d+\]\./, '')))

describe('the Showpiece family', () => {
  it('is a family the browser can show, with a sound each', () => {
    expect(PRESET_GROUPS).toContain('Showpiece')
    expect(family.length).toBeGreaterThanOrEqual(7)
    expect(new Set(family.map((preset) => preset.id)).size).toBe(family.length)
  })

  /**
   * The one that matters most. Ten destinations were declared and four were pointed at; a
   * modulator dropped on any of the other six did nothing, which is most of the reason the plate
   * read as broken. Every one of them is now driven by something that ships.
   */
  it('points a modulator at every destination the engine declares', () => {
    for (const where of LFO_DESTINATIONS) expect(destinations, where).toContain(where)
  })

  it('puts a layer somewhere in the field, and moves it while it plays', () => {
    expect(built.some(({ patch }) => layers(patch).some((layer) => Math.abs(layer.pan) > 0.1))).toBe(true)
    const moved = built.filter(({ patch }) => modsOn(patch).some((mod) => mod.target.endsWith('.pan')))
    expect(moved.length).toBeGreaterThanOrEqual(3)
  })

  it('chains the phase modulation matrix rather than using one link of it', () => {
    const chained = built.filter(({ patch }) => layers(patch).filter((layer) => layer.source.pmFrom !== 'internal').length >= 2)
    expect(chained.length).toBeGreaterThanOrEqual(1)
    // And one of them bends a layer that is turned down to nothing, which is the rule that makes
    // a modulator oscillator possible: the reading is taken before the level.
    expect(built.some(({ patch }) => patch.layers.some((layer) => layer.source.pmFrom !== 'internal'
      && patch.layers.some((source, at) => `layer${at}` === layer.source.pmFrom && source.gain <= 0.15)))).toBe(true)
  })

  it('runs the whole performer rack, in every shape, on a row that is not the first', () => {
    const rows = built.flatMap(({ patch }) => drawn(patch))
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const shape of ['step', 'line', 'curve']) expect(new Set(rows.map((row) => row.shape)), shape).toContain(shape)
    // Three at once in one patch, at rates that are not the same, or it is one sequencer three times.
    const together = built.find(({ patch }) => drawn(patch).length === 3)
    expect(together, 'no patch runs all three performers').toBeDefined()
    expect(new Set(drawn(together!.patch).map((row) => row.rate)).size).toBe(3)
    expect(built.some(({ patch }) => patch.scene !== 0)).toBe(true)
  })

  it('holds two filters on one layer, in both arrangements, and reaches the models nothing else does', () => {
    const ways = new Set(built.flatMap(({ patch }) => layers(patch).map((layer) => layer.routing)))
    for (const way of ['series', 'parallel']) expect(ways, way).toContain(way)
    const kinds = new Set(built.flatMap(({ patch }) => layers(patch).flatMap((layer) => [layer.filterA.kind, layer.filterB.kind])))
    for (const model of ['comb', 'formant', 'ladder']) expect(kinds, model).toContain(model)
  })

  it('stands an insert on both sides of the amplifier, in the same layer', () => {
    const both = built.some(({ patch }) => layers(patch).some((layer) => {
      const on = [layer.insertA, layer.insertB, layer.insertC].filter((slot) => slot.kind !== 'off')
      return on.some((slot) => slot.place === 'pre') && on.some((slot) => slot.place === 'post')
    }))
    expect(both).toBe(true)
    const kinds = new Set(built.flatMap(({ patch }) => slots(patch).map((slot) => slot.kind)))
    for (const kind of ['drive', 'crusher', 'ring', 'fold', 'body', 'comb']) expect(kinds, kind).toContain(kind)
  })

  it('uses free modulator envelopes, which the rest of the library has one of', () => {
    const envelopes = built.flatMap(({ patch }) => modsOn(patch).filter((mod) => mod.kind === 'envelope'))
    expect(envelopes.length).toBeGreaterThanOrEqual(4)
    // At least one pulling the other way: a negative depth is what makes an envelope close a thing.
    expect(envelopes.some((envelope) => envelope.depth < 0)).toBe(true)
  })

  /**
   * The house principle, measured: brightness belongs in the transient and the body is allowed to
   * be dark. A sound bright all the way through reads as thin, which is what makes a showcase
   * preset sound like a test tone. Counted as zero crossings rather than by a transform — it is a
   * coarser number than a centroid but it moves with it, and this is a direction test.
   */
  it('arrives brighter than it leaves, every one of them', () => {
    const brightness = (samples: Float32Array, from: number, to: number) => {
      let crossings = 0
      for (let i = from + 1; i < to; i += 1) if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) crossings += 1
      return crossings / Math.max(1, to - from)
    }
    for (const { id, patch } of built) {
      const out = monoSum(renderPatch(patch, RATE))
      const head = brightness(out, 0, Math.round(out.length * 0.12))
      const tail = brightness(out, Math.round(out.length * 0.6), Math.round(out.length * 0.85))
      expect(head, `${id} is no brighter at its head than at its tail`).toBeGreaterThan(tail)
    }
  }, 30_000)

  /**
   * Measured a channel at a time, which is the whole point of measuring it here.
   *
   * Every other level check in the repository reads the mono sum, and the sum is where a panned
   * sound hides: equal-power panning puts a hard-left transient at full scale in the left channel
   * and at 0.707 of it in the sum, so a family built around pan is exactly the family a mono-sum
   * reading passes while it clips. Four of these seven did, at 1.0000 in one channel and under
   * 0.85 in the sum, and it took the exporter to say so.
   */
  it('sits where the rest of the library sits, in each channel and on every row', () => {
    for (const { id, patch } of built) {
      // All twelve rows, not only the one that ships: a scene is another version of the sound, not
      // a louder one, and the level is chosen from the loudest of them.
      for (let scene = 0; scene < 12; scene += 1) {
        const out = renderPatch({ ...patch, scene }, RATE)
        let peak = 0
        for (const channel of [out.left, out.right]) {
          for (const value of channel) peak = Math.max(peak, Math.abs(value))
        }
        expect(peak, `${id} row ${scene + 1} is at the ceiling`).toBeLessThan(0.96)
        if (scene === patch.scene) {
          expect(peak, `${id} is too quiet to sit beside the others`).toBeGreaterThan(0.45)
        }
      }
    }
  }, 60_000)
})
