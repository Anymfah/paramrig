import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  MAX_FAVORITES,
  parsePreferences,
  parseSceneSettings,
  readSceneSettings,
  SETTINGS_KEY,
  toggleFavorite,
  withSettings,
  writeSceneSettings,
  type SceneSettings,
} from '@/scene/prefs'

/**
 * The settings a person carries between documents.
 *
 * What is worth asserting is that nothing a file says can put the editor into a state it cannot
 * honour — a resolution scale of a thousand, an undo depth of nought — and that the preferences
 * somebody had before the settings moved into a key of their own are still theirs afterwards.
 */

const settings = (patch: Partial<SceneSettings> = {}): SceneSettings => ({
  preferences: { ...DEFAULT_PREFERENCES },
  favorites: [],
  recentCommands: [],
  ...patch,
})

beforeEach(() => {
  localStorage.clear()
})

describe('reading the preferences', () => {
  it('holds every number inside the range the editor can honour', () => {
    const kept = parsePreferences({
      smoothViewMs: 9000,
      undoSteps: 0,
      resolutionScale: 40,
      tooltipDelayMs: -10,
      autoMergeDistance: 12,
    })
    expect(kept.smoothViewMs).toBe(1000)
    expect(kept.undoSteps).toBe(8)
    expect(parsePreferences({ undoSteps: 9000 }).undoSteps).toBe(256)
    expect(kept.resolutionScale).toBe(2)
    expect(kept.tooltipDelayMs).toBe(0)
    expect(kept.autoMergeDistance).toBe(1)
  })

  it('refuses a setting it does not recognise and keeps the default', () => {
    const kept = parsePreferences({ theme: 'neon', orbitStyle: 'gyroscope', spacebarAction: 'sing' })
    expect(kept.theme).toBe('paramrig')
    expect(kept.orbitStyle).toBe('turntable')
    expect(kept.spacebarAction).toBe('play')
  })

  it('takes the three presets and the three spacebar actions that exist', () => {
    expect(parsePreferences({ theme: 'high-contrast' }).theme).toBe('high-contrast')
    expect(parsePreferences({ theme: 'blender-classic' }).theme).toBe('blender-classic')
    expect(parsePreferences({ spacebarAction: 'search' }).spacebarAction).toBe('search')
  })

  it('gives the defaults for anything that is not an object', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('turntable')).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('the settings a person carries', () => {
  it('reads back what was written', () => {
    writeSceneSettings(settings({ favorites: ['mesh.extrudeRegion'], recentCommands: ['add.cube'] }))
    const read = readSceneSettings()
    expect(read.favorites).toEqual(['mesh.extrudeRegion'])
    expect(read.recentCommands).toEqual(['add.cube'])
  })

  it('takes the preferences across from where they used to live', () => {
    // They sat inside the per-document store until this prompt; an update must not reset them.
    localStorage.setItem('paramrig.scene-inspector.v1', JSON.stringify({
      tabs: {}, collapsed: [], modes: {}, preferences: { orbitStyle: 'trackball', theme: 'blender-classic' },
    }))
    const read = readSceneSettings()
    expect(read.preferences.orbitStyle).toBe('trackball')
    expect(read.preferences.theme).toBe('blender-classic')
  })

  it('survives a settings file that is nonsense', () => {
    localStorage.setItem(SETTINGS_KEY, 'not json')
    expect(readSceneSettings().preferences).toEqual(DEFAULT_PREFERENCES)
    expect(parseSceneSettings([1, 2, 3]).favorites).toEqual([])
  })

  it('drops a favourite that is not a name, and never keeps one twice', () => {
    const read = parseSceneSettings({ favorites: ['a', 'a', 42, '', 'b'] })
    expect(read.favorites).toEqual(['a', 'b'])
  })

  it('puts a command on the Q menu and takes it off again', () => {
    const on = toggleFavorite(settings(), 'mesh.inset')
    expect(on.favorites).toEqual(['mesh.inset'])
    expect(toggleFavorite(on, 'mesh.inset').favorites).toEqual([])
  })

  it('keeps the Q menu to a hand’s worth of things', () => {
    let current = settings()
    for (let index = 0; index < MAX_FAVORITES + 4; index += 1) current = toggleFavorite(current, `operator.${index}`)
    expect(current.favorites).toHaveLength(MAX_FAVORITES)
    // The newest survive: adding one past the limit drops the oldest rather than refusing.
    expect(current.favorites.at(-1)).toBe(`operator.${MAX_FAVORITES + 3}`)
  })

  it('changes one preference and leaves the rest alone', () => {
    const next = withSettings(settings({ favorites: ['a'] }), { orbitStyle: 'trackball' })
    expect(next.preferences.orbitStyle).toBe('trackball')
    expect(next.preferences.zoomToMouse).toBe(DEFAULT_PREFERENCES.zoomToMouse)
    expect(next.favorites).toEqual(['a'])
  })
})
