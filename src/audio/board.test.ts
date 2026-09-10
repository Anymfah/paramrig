import { describe, expect, it } from 'vitest'
import { BOARD_CATEGORIES, MODULATION_CATEGORIES, boardGroups, boardParameters, boardPaths, boardValues, setBoardValue } from '@/audio/board'
import { AUDIO_PROPERTY_PATHS, parseAudioProperty } from '@/audio/rig'
import { defaultPatch } from '@/audio/patch'
import { coin } from '@/audio/presets'

describe('the board', () => {
  it('shows every field the synthesiser has, and only real ones', () => {
    const paths = boardPaths()
    expect(paths.length).toBeGreaterThan(60)
    for (const { property } of paths) expect(parseAudioProperty(property), property).not.toBeNull()
  })

  it('puts every field in a group that exists', () => {
    const groups = new Set(boardGroups().map((group) => group.id))
    for (const { group } of boardPaths()) expect(groups.has(group), group).toBe(true)
  })

  /** The board spans two views now: the layers and the modulators, each with its own columns. */
  it('puts every group under a category that exists, in one view or the other', () => {
    const categories = new Set([...BOARD_CATEGORIES, ...MODULATION_CATEGORIES].map((category) => category.id))
    for (const group of boardGroups()) expect(categories.has(group.tab ?? ''), group.id).toBe(true)
  })

  it('builds one control a field, keyed by its own path', () => {
    const parameters = boardParameters()
    // Every path but the handful the engine never reads: a control for one of those would turn,
    // be saved, be published in the docs, and change no sound.
    const editorOnly = boardPaths().filter(({ property }) => parseAudioProperty(property)?.spec.editorOnly).length
    expect(editorOnly).toBeGreaterThan(0)
    expect(parameters).toHaveLength(boardPaths().length - editorOnly)
    expect(new Set(parameters.map((parameter) => parameter.id)).size).toBe(parameters.length)
    expect(parameters.every((parameter) => parameter.label.length > 0)).toBe(true)
  })

  /** Defaults come from a blank patch, so resetting a field means something rather than nothing. */
  it('takes its defaults from a new patch, not from the one open', () => {
    const cutoff = boardParameters().find((parameter) => parameter.id === 'layers[0].filterA.cutoff')
    expect(cutoff).toMatchObject({ defaultValue: defaultPatch().layers[0]?.filterA.cutoff })
  })

  it('reads the values of the patch it is given', () => {
    const values = boardValues(coin())
    expect(values['layers[0].pitch.start']).toBe(988)
    expect(values['duration']).toBe(0.45)
  })

  it('writes one field and clamps it', () => {
    const after = setBoardValue(defaultPatch(), 'layers[0].amp.decay', 99)
    expect(after.layers[0]?.amp.decay).toBe(2)
  })

  it('ignores a write to a field that does not exist', () => {
    const before = defaultPatch()
    expect(setBoardValue(before, 'layers[0].nope', 1)).toBe(before)
  })
})

describe('the performers on the board', () => {
  it('have their fields on the board, in their own groups, in front of the envelopes', () => {
    const paths = boardPaths()
    expect(paths.some((entry) => entry.property === 'performers[0].target' && entry.group === 'per0.all')).toBe(true)
    expect(paths.findIndex((entry) => entry.property === 'performers[0].depth')).toBeLessThan(paths.findIndex((entry) => entry.property === 'mods[0].depth'))
    expect(boardGroups().some((group) => group.id === 'per2.all')).toBe(true)
  })
})

describe('the modulation slots on the board', () => {
  it('have their fields on the board, in one group each', () => {
    const paths = boardPaths()
    expect(paths.some((entry) => entry.property === 'mods[0].target' && entry.group === 'mod0.all')).toBe(true)
    expect(paths.some((entry) => entry.property === 'mods[7].kind')).toBe(true)
    expect(boardGroups().some((group) => group.id === 'mod7.all')).toBe(true)
  })
})


/**
 * Two promises the board makes about what it hands out.
 *
 * A control the engine never reads is a dial that turns and changes no sound, which is the one
 * thing `parseAudioProperty` says this layer exists to prevent — and the seed is a number you
 * replace rather than one you sweep, which the board has always had an exception for and never
 * managed to apply, because nothing ever set the view it looked for.
 */
describe('what the board will and will not expose', () => {
  it('keeps a performer’s grid off the board: it snaps the drawing, not the sound', () => {
    expect(boardParameters().some((parameter) => /^performers\[\d+\]\.grid$/.test(parameter.id))).toBe(false)
    expect(AUDIO_PROPERTY_PATHS.some((path) => path.property === 'performers[i].grid')).toBe(false)
    // Still stored and still readable, because the plate edits it like anything else.
    expect(Object.keys(boardValues(defaultPatch()))).toContain('performers[0].grid')
  })

  it('gives the seed a stepper and a dice rather than a ten-thousand-step dial', () => {
    const seed = boardParameters().find((parameter) => parameter.id === 'seed')
    expect(seed?.kind).toBe('number')
    expect(seed && 'view' in seed ? seed.view : undefined).toBe('seed')
  })
})
