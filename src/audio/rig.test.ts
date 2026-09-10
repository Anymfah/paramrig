import { describe, expect, it } from 'vitest'
import {
  AUDIO_PROPERTY_PATHS, applyAudioBinding, audioPropertyLabel, clearAudioRigCache,
  currentAudioValue, parameterForAudioProperty, parseAudioProperty, resolveAudioValues, sanitizeAudioRig,
} from '@/audio/rig'
import { defaultPatch } from '@/audio/patch'
import { coin } from '@/audio/presets'

const doc = (patch = defaultPatch(), rig?: Parameters<typeof resolveAudioValues>[0]['rig']) =>
  ({ id: 'audio-test', updatedAt: '2026-09-08T00:00:00.000Z', patch, ...(rig ? { rig } : {}) })

describe('parseAudioProperty', () => {
  it('reads the shapes a patch is made of', () => {
    expect(parseAudioProperty('duration')?.kind).toBe('patch')
    expect(parseAudioProperty('fx.delayMix')?.kind).toBe('fx')
    expect(parseAudioProperty('master.gain')?.kind).toBe('master')
    expect(parseAudioProperty('layers[1].gain')).toMatchObject({ kind: 'layer', index: 1, section: 'root', field: 'gain' })
    expect(parseAudioProperty('layers[0].pitch.start')).toMatchObject({ kind: 'layer', index: 0, section: 'pitch', field: 'start' })
  })

  it('refuses what it does not know rather than guessing', () => {
    for (const path of ['', 'nope', 'layers[0]', 'layers[0].pitch', 'layers[0].pitch.nope', 'layers[9].gain', 'layers[-1].gain', 'fx.nope', 'master', 'layers[0].nope.start']) {
      expect(parseAudioProperty(path)).toBeNull()
    }
  })

  /** The docs page is generated from these, so a row that does not parse is a lie in the manual. */
  it('parses every path it publishes', () => {
    expect(AUDIO_PROPERTY_PATHS.length).toBeGreaterThan(30)
    for (const row of AUDIO_PROPERTY_PATHS) {
      const property = row.property.replace('[i]', '[0]')
      const parsed = parseAudioProperty(property)
      expect(parsed, `${row.property} should parse`).not.toBeNull()
      expect(parsed?.spec.type).toBe(row.type)
    }
  })
})

describe('applyAudioBinding', () => {
  const bind = (property: string) => ({ id: 'b', property, parameterId: 'p' })

  it('writes a number into the branch it names and leaves the rest alone', () => {
    const before = defaultPatch()
    const after = applyAudioBinding(before, bind('layers[0].pitch.start'), 880, () => 0)
    expect(after.layers[0]?.pitch.start).toBe(880)
    expect(after.layers[1]).toBe(before.layers[1])
    expect(after.fx).toBe(before.fx)
  })

  it('holds a value to the range its field admits', () => {
    const wild = applyAudioBinding(defaultPatch(), bind('layers[0].filter.cutoff'), 900000, () => 0)
    expect(wild.layers[0]?.filter.cutoff).toBe(20000)
    const low = applyAudioBinding(defaultPatch(), bind('master.gain'), -50, () => 0)
    expect(low.master.gain).toBe(0)
  })

  it('leaves the patch alone when the value is the wrong shape', () => {
    const before = defaultPatch()
    expect(applyAudioBinding(before, bind('layers[0].source.wave'), 'accordion', () => 0)).toBe(before)
    expect(applyAudioBinding(before, bind('layers[0].pitch.start'), 'loud', () => 0)).toBe(before)
    expect(applyAudioBinding(before, bind('nope'), 1, () => 0)).toBe(before)
  })

  it('accepts an option the field declares', () => {
    const after = applyAudioBinding(defaultPatch(), bind('layers[0].filter.kind'), 'bandpass', () => 0)
    expect(after.layers[0]?.filter.kind).toBe('bandpass')
  })
})

describe('resolveAudioValues', () => {
  const rig = {
    groups: [{ id: 'main', label: 'Main' }],
    parameters: [{ kind: 'number' as const, id: 'pitch', label: 'Pitch', group: 'main', min: 20, max: 4000, step: 1, defaultValue: 440 }],
    bindings: [{ id: 'b1', property: 'layers[0].pitch.start', parameterId: 'pitch' }],
  }

  it('returns the patch untouched when nothing is bound', () => {
    const document = doc()
    expect(resolveAudioValues(document, {})).toBe(document.patch)
  })

  it('writes the controls onto the patch without mutating it', () => {
    clearAudioRigCache()
    const document = doc(defaultPatch(), rig)
    const resolved = resolveAudioValues(document, { pitch: 1200 })
    expect(resolved.layers[0]?.pitch.start).toBe(1200)
    expect(document.patch.layers[0]?.pitch.start).not.toBe(1200)
  })

  it('ignores a binding whose control the rig no longer declares', () => {
    clearAudioRigCache()
    const orphan = { ...rig, bindings: [{ id: 'b2', property: 'master.gain', parameterId: 'gone' }] }
    const document = doc(defaultPatch(), orphan)
    expect(resolveAudioValues(document, {}).master.gain).toBe(defaultPatch().master.gain)
  })

  it('hands back the same object for the same values, since a drag asks many times a second', () => {
    clearAudioRigCache()
    const document = doc(defaultPatch(), rig)
    expect(resolveAudioValues(document, { pitch: 900 })).toBe(resolveAudioValues(document, { pitch: 900 }))
  })
})

describe('currentAudioValue', () => {
  it('reads what the patch says today', () => {
    const patch = coin()
    expect(currentAudioValue(patch, 'layers[0].pitch.start')).toBe(988)
    expect(currentAudioValue(patch, 'duration')).toBe(0.45)
    expect(currentAudioValue(patch, 'layers[0].source.wave')).toBe('square')
    expect(currentAudioValue(patch, 'nope')).toBeNull()
  })
})

describe('parameterForAudioProperty', () => {
  const build = (property: string) =>
    parameterForAudioProperty({ id: 'c', label: 'Control', group: 'main', property, patch: coin() })

  /** The point of the field table: exposing a cutoff gives a control a musician can use. */
  it('gives a frequency a logarithmic scale and its unit', () => {
    expect(build('layers[0].filter.cutoff')).toMatchObject({ kind: 'number', min: 20, max: 20000, scale: 'log', unit: 'Hz' })
  })

  it('gives a time control milliseconds to read in', () => {
    const parameter = build('layers[0].amp.decay')
    expect(parameter).toMatchObject({ kind: 'number', unit: 'ms' })
    expect(parameter && 'units' in parameter ? parameter.units?.map((unit) => unit.value) : []).toEqual(['ms', 's'])
  })

  it('builds a switch, a select and a curve where the field asks for one', () => {
    expect(build('layers[0].enabled')?.kind).toBe('switch')
    expect(build('layers[0].source.wave')).toMatchObject({ kind: 'select', defaultValue: 'square' })
    expect(build('layers[0].pitch.slideCurve')?.kind).toBe('curve')
  })

  it('starts a control where the patch already is', () => {
    expect(build('layers[0].pitch.start')).toMatchObject({ defaultValue: 988 })
  })

  it('refuses a property that does not exist', () => {
    expect(build('nope')).toBeNull()
  })
})

describe('audioPropertyLabel', () => {
  it('says which layer a field belongs to', () => {
    expect(audioPropertyLabel('layers[2].filter.cutoff')).toBe('Layer 3 · Cutoff')
    expect(audioPropertyLabel('master.gain')).toBe('Master gain')
    expect(audioPropertyLabel('nope')).toBe('nope')
  })
})

describe('sanitizeAudioRig', () => {
  const rig = {
    groups: [{ id: 'main', label: 'Main' }],
    parameters: [{ kind: 'number', id: 'pitch', label: 'Pitch', group: 'main', min: 20, max: 4000, step: 1, defaultValue: 440 }],
    bindings: [{ id: 'b1', property: 'layers[0].pitch.start', parameterId: 'pitch' }],
  }

  it('keeps a rig that names things which exist', () => {
    const clean = sanitizeAudioRig(rig)
    expect(clean?.parameters).toHaveLength(1)
    expect(clean?.bindings).toHaveLength(1)
  })

  it('drops a binding whose control is not declared', () => {
    const clean = sanitizeAudioRig({ ...rig, bindings: [{ id: 'b', property: 'master.gain', parameterId: 'ghost' }] })
    expect(clean?.bindings).toHaveLength(0)
  })

  it('drops a binding to a property the synthesiser does not have', () => {
    const clean = sanitizeAudioRig({ ...rig, bindings: [{ id: 'b', property: 'layers[0].pitch.warp', parameterId: 'pitch' }] })
    expect(clean?.bindings).toHaveLength(0)
  })

  it('is no rig at all without a group to put controls in', () => {
    expect(sanitizeAudioRig({ ...rig, groups: [] })).toBeUndefined()
    expect(sanitizeAudioRig(null)).toBeUndefined()
    expect(sanitizeAudioRig('a rig, honest')).toBeUndefined()
  })
})

describe('the performers on the rig', () => {
  it('parse their fields and refuse what is not there, and the scene is a field of the patch', () => {
    expect(parseAudioProperty('performers[2].depth')).toMatchObject({ kind: 'performer', index: 2, field: 'depth' })
    expect(parseAudioProperty('performers[3].depth')).toBeNull()
    expect(parseAudioProperty('performers[0].patterns')).toBeNull()
    expect(parseAudioProperty('scene')).toMatchObject({ kind: 'patch', field: 'scene' })
    expect(AUDIO_PROPERTY_PATHS.some((entry) => entry.property === 'performers[i].target')).toBe(true)
  })
})

describe('the modulation slots on the rig', () => {
  it('parse their fields and refuse an index the patch does not have', () => {
    expect(parseAudioProperty('mods[7].depth')).toMatchObject({ kind: 'mod', index: 7, field: 'depth' })
    expect(parseAudioProperty('mods[8].depth')).toBeNull()
    expect(parseAudioProperty('mods[0].nothing')).toBeNull()
    expect(parseAudioProperty('mods[1].kind')).toMatchObject({ kind: 'mod', field: 'kind' })
    expect(AUDIO_PROPERTY_PATHS.some((entry) => entry.property === 'mods[i].target')).toBe(true)
  })

  it('read and write through the same path a binding uses', () => {
    const patch = defaultPatch()
    const binding = { id: 'b', property: 'mods[0].depth', parameterId: 'p' }
    const written = applyAudioBinding(patch, binding, -0.25, () => 0)
    expect(currentAudioValue(written, 'mods[0].depth')).toBe(-0.25)
    expect(currentAudioValue(patch, 'mods[0].depth')).toBe(patch.mods[0]?.depth)
  })
})

