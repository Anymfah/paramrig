import { describe, expect, it } from 'vitest'
import { bindMacro, emptyMacros, macroIsMapped, macroIsParked, macrosOf, prepareMacroMove, renameMacro, setMacroDestination, setMacroValue, syncMacrosToPatch, writeMacros, applyMacros } from '@/audio/macros'
import { coin } from '@/audio/presets'
import { emptyAudioRig, resolveAudioValues, audioRigDefaults } from '@/audio/rig'

describe('macros', () => {
  it('adds a destination without clearing the ones already there', () => {
    const patch = coin()
    let table = emptyMacros()
    table = bindMacro(table, 0, 'layers[0].filterA.cutoff', patch)
    table = bindMacro(table, 0, 'layers[0].gain', patch)
    expect(table[0]?.destinations.map((dest) => dest.property)).toEqual([
      'layers[0].filterA.cutoff',
      'layers[0].gain',
    ])
  })

  it('lets the last assigned macro steal a property', () => {
    const patch = coin()
    let table = emptyMacros()
    table = bindMacro(table, 0, 'layers[0].gain', patch)
    table = bindMacro(table, 1, 'layers[0].gain', patch)
    expect(table[0]?.destinations).toEqual([])
    expect(table[1]?.destinations[0]?.property).toBe('layers[0].gain')
  })

  it('keeps a custom name when another destination is added', () => {
    const patch = coin()
    let table = emptyMacros()
    table = bindMacro(table, 0, 'layers[0].gain', patch)
    table = renameMacro(table, 0, 'Energy')
    table = bindMacro(table, 0, 'layers[0].filterA.cutoff', patch)
    expect(table[0]?.label).toBe('Energy')
    expect(table[0]?.renamed).toBe(true)
  })

  it('writes every destination when the amount moves', () => {
    const patch = coin()
    let table = emptyMacros()
    table = bindMacro(table, 0, 'layers[0].gain', patch)
    table = bindMacro(table, 0, 'master.gain', patch)
    table = setMacroDestination(table, 0, 'layers[0].gain', { from: 0.2, to: 0.8 })
    table = setMacroDestination(table, 0, 'master.gain', { from: 1, to: 0.5 })
    table = setMacroValue(table, 0, 1)
    const next = applyMacros(patch, table)
    expect(next.layers[0]?.gain).toBeCloseTo(0.8)
    expect(next.master.gain).toBeCloseTo(0.5)
  })

  it('round-trips through the rig', () => {
    const patch = coin()
    let table = emptyMacros()
    table = bindMacro(table, 2, 'fx.width', patch)
    table = renameMacro(table, 2, 'Width')
    const rig = writeMacros(emptyAudioRig(), table, patch)
    const back = macrosOf(rig, patch)
    expect(back[2]?.label).toBe('Width')
    expect(back[2]?.destinations[0]?.property).toBe('fx.width')
  })

  it('treats several destinations as a mapped 0..1 amount', () => {
    const patch = coin()
    let table = emptyMacros()
    table = bindMacro(table, 0, 'layers[0].gain', patch)
    expect(macroIsMapped(table[0]!)).toBe(true)
    table = bindMacro(table, 0, 'layers[0].filterA.cutoff', patch)
    expect(macroIsMapped(table[0]!)).toBe(true)
  })
})

it('keeps native legacy macros in their units through a rename', () => {
  const patch = coin()
  const rig = { ...emptyAudioRig(), parameters: [{ id: 'pitch', kind: 'number' as const, label: 'Pitch', group: '', min: 20, max: 20000, step: 1, defaultValue: patch.layers[0]!.pitch.start }], bindings: [{ id: 'pitch', property: 'layers[0].pitch.start', parameterId: 'pitch' }] }
  const slots = macrosOf(rig, patch)
  expect(macroIsMapped(slots[0]!)).toBe(false)
  const saved = writeMacros(rig, renameMacro(slots, 0, 'Frequency'), patch)
  expect(applyMacros(patch, macrosOf(saved, patch)).layers[0]!.pitch.start).toBe(patch.layers[0]!.pitch.start)
})

it('moving one macro leaves manually edited destinations of other macros alone', () => {
  const patch = coin()
  let slots = bindMacro(emptyMacros(), 0, 'layers[0].gain', patch)
  slots = bindMacro(slots, 1, 'master.gain', patch)
  const rig = writeMacros(undefined, slots, patch)
  const edited = { ...patch, master: { ...patch.master, gain: 0.73 } }
  const next = applyMacros(edited, setMacroValue(slots, 0, 0.9), rig, 0)
  expect(next.master.gain).toBe(0.73)
})

it('preserves the name of a free macro and does not duplicate its parameter', () => {
  const patch = coin()
  const slots = renameMacro(emptyMacros(), 4, 'My space')
  const once = writeMacros(undefined, slots, patch)
  const twice = writeMacros(once, macrosOf(once, patch), patch)
  expect(macrosOf(twice, patch)[4]?.label).toBe('My space')
  expect(twice.parameters.filter((entry) => entry.id === 'macro-5')).toHaveLength(1)
})

it('keeps a manual destination edit when Tune opens at the saved defaults', () => {
  const patch = coin()
  const slots = bindMacro(emptyMacros(), 0, 'master.gain', patch)
  const rig = writeMacros(undefined, slots, patch)
  const edited = { ...patch, master: { ...patch.master, gain: 0.37 } }
  const doc = { id: 'manual', updatedAt: '', patch: edited, rig }
  expect(resolveAudioValues(doc, audioRigDefaults(rig)).master.gain).toBe(0.37)
  expect(resolveAudioValues(doc, { 'macro-1': 1 }).master.gain).not.toBe(0.37)
})

it('syncs a mapped macro when the patch still sits on one amount', () => {
  const patch = coin()
  let table = bindMacro(emptyMacros(), 0, 'layers[0].gain', patch)
  table = bindMacro(table, 0, 'master.gain', patch)
  table = setMacroValue(table, 0, 0.2)
  const moved = applyMacros(patch, table)
  const synced = syncMacrosToPatch(table, moved)
  expect(synced[0]?.value).toBeCloseTo(0.2, 5)
})

it('recaptures a parked macro so the next move starts from the heard values', () => {
  const patch = coin()
  let table = bindMacro(emptyMacros(), 0, 'layers[0].filterA.cutoff', patch)
  table = bindMacro(table, 0, 'layers[0].gain', patch)
  const drawn = { ...patch, layers: patch.layers.map((layer, index) => index === 0 ? { ...layer, gain: 0.12, filterA: { ...layer.filterA, cutoff: 220 } } : layer) }
  expect(macroIsParked(table[0]!, drawn)).toBe(true)
  const next = prepareMacroMove(table, 0, table[0]!.value, drawn)
  const heard = applyMacros(drawn, next, undefined, 0)
  expect(heard.layers[0]!.gain).toBeCloseTo(0.12, 3)
  expect(heard.layers[0]!.filterA.cutoff).toBeCloseTo(220, 0)
})
