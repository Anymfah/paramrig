import { applyMacros, macrosOf } from '@/audio/macros'
import { createVoice, processVoice, triggerVoice, updateVoice } from '@/audio/dsp/engine'
import { LINEAR } from '@/audio/dsp/curve'
import { describe, expect, it } from 'vitest'
import { renderPatch } from '@/audio/dsp/render'
import { coin, uiClick } from '@/audio/presets'
import { titanLatch, prismBloom, aetherGate, glassSerpent, ionChoir, titanLatchRig, prismBloomRig, aetherGateRig, glassSerpentRig, ionChoirRig } from '@/audio/presets-signature'
import { sanitizeAudioPatch } from '@/audio/patch'

const RATE = 44100

function close(a: Float32Array, b: Float32Array, eps = 1e-5): void {
  expect(a.length).toBe(b.length)
  let worst = 0
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)))
  expect(worst).toBeLessThan(eps)
}

describe('block render', () => {
  it('is the same samples whether the block is sixty-four long or the whole file', () => {
    const patch = uiClick()
    const whole = renderPatch(patch, RATE)
    const blocks = renderPatch(patch, RATE, 64)
    close(whole.left, blocks.left)
    close(whole.right, blocks.right)
  })

  it('does not depend on a 1024-sample cut either', () => {
    const patch = coin()
    const a = renderPatch(patch, RATE, 64)
    const b = renderPatch(patch, RATE, 1024)
    close(a.left, b.left)
    close(a.right, b.right)
  })

  it('is deterministic at a seed', () => {
    const patch = { ...uiClick(), seed: 9 }
    const first = renderPatch(patch, RATE, 128)
    const second = renderPatch(patch, RATE, 128)
    expect(Array.from(first.left)).toEqual(Array.from(second.left))
  })
})

describe('signature presets', () => {
  it('round-trip through sanitise without losing their gestures or bodies', () => {
    for (const build of [titanLatch, prismBloom, aetherGate, glassSerpent, ionChoir]) {
      const patch = build()
      const back = sanitizeAudioPatch(JSON.parse(JSON.stringify(patch)))
      expect(back.layers.some((layer) => layer.insertC.kind === 'body')).toBe(true)
      expect(back.duration).toBe(patch.duration)
    }
    const gate = sanitizeAudioPatch(JSON.parse(JSON.stringify(aetherGate())))
    expect(gate.gestures?.length).toBeGreaterThan(0)
    expect(gate.gestures?.[0]?.points.length).toBeGreaterThan(4)
  })
})

describe('live edits and automation', () => {
  const block = (voice: ReturnType<typeof createVoice>, size = 256) => {
    const left = new Float32Array(size)
    processVoice(voice, left, new Float32Array(size))
    return left
  }
  it('updates duration and keeps oscillator phase on a numeric edit', () => {
    const patch = uiClick()
    const voice = createVoice(patch, RATE, { live: true })
    block(voice)
    const phases = voice.layers[0]!.phases
    updateVoice(voice, { ...patch, duration: 2 })
    expect(voice.length).toBe(RATE * 2)
    expect(voice.layers[0]!.phases).toBe(phases)
  })
  it('refreshes insert modulation without clearing its delay memory', () => {
    const patch = uiClick()
    const voice = createVoice(patch, RATE)
    const state = voice.layers[0]!.chain[0]!.left
    const next = structuredClone(patch)
    next.mods[0] = { ...next.mods[0]!, kind: 'lfo', enabled: true, target: 'layers[0].insertA', depth: 0.7 }
    updateVoice(voice, next)
    expect(voice.layers[0]!.chain[0]!.left).toBe(state)
    expect(voice.layers[0]!.chain[0]!.swing[0]?.depth).toBe(0.7)
  })
  it('restarts gestures with each note rather than the lifetime clock', () => {
    const patch = uiClick()
    patch.gestures = [{ id: 'mute', macro: 0, start: 0, duration: 0.02, enabled: true, points: [{ t: 0, v: 0 }, { t: 1, v: 0 }], destinations: [{ property: 'master.gain', from: 0, to: 1, invert: false, curve: LINEAR }] }]
    const voice = createVoice(patch, RATE)
    block(voice, RATE)
    triggerVoice(voice)
    expect(block(voice).every((value) => value === 0)).toBe(true)
  })
  it('uses internal PM for an invalid self-route', () => {
    const patch = uiClick()
    patch.layers[0]!.source.fmIndex = 2
    const internal = renderPatch(patch, RATE)
    patch.layers[0]!.source.pmFrom = 'layer0'
    close(internal.left, renderPatch(patch, RATE).left)
  })
  it('automates FX exactly like an equivalent fixed setting', () => {
    const patch = uiClick()
    patch.fx.y = { ...patch.fx.y, kind: 'delay', time: 0.01, mix: 0 }
    const fixed = structuredClone(patch)
    fixed.fx.y.mix = 0.7
    patch.gestures = [{ id: 'wet', macro: 0, start: 0, duration: patch.duration, enabled: true, points: [{ t: 0, v: 0.7 }, { t: 1, v: 0.7 }], destinations: [{ property: 'fx.y.mix', from: 0, to: 1, invert: false, curve: LINEAR }] }]
    close(renderPatch(patch, RATE).left, renderPatch(fixed, RATE).left)
  })
})

it('keeps every signature preset unchanged when its default rig is applied', () => {
  for (const [build, rig] of [
    [titanLatch, titanLatchRig], [prismBloom, prismBloomRig], [aetherGate, aetherGateRig],
    [glassSerpent, glassSerpentRig], [ionChoir, ionChoirRig],
  ] as const) {
    const patch = build()
    const controls = rig(patch)
    const resolved = applyMacros(patch, macrosOf(controls, patch))
    close(renderPatch(patch, 22050).left, renderPatch(resolved, 22050).left, 1e-4)
    const audio = renderPatch(patch, 22050).left
    expect(audio.every(Number.isFinite)).toBe(true)
    expect(Math.max(...audio.subarray(0, 16000).map(Math.abs))).toBeGreaterThan(0.01)
  }
})

it('ramps live gain changes without changing the patch stored by the editor', () => {
  const patch = uiClick()
  const voice = createVoice(patch, RATE, { live: true, gate: 'hold' })
  processVoice(voice, new Float32Array(100), new Float32Array(100))
  const next = { ...patch, master: { ...patch.master, gain: 0 } }
  updateVoice(voice, next)
  processVoice(voice, new Float32Array(1), new Float32Array(1))
  expect(voice.sounding.master.gain).toBeGreaterThan(0)
  expect(next.master.gain).toBe(0)
  processVoice(voice, new Float32Array(512), new Float32Array(512))
  expect(voice.sounding.master.gain).toBe(0)
})
