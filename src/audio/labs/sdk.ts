/** Headless Labs API. No React, DOM, playback side effects or UI wiring. */
export { generateSound, createLabBatch, renderCandidate, measureRender, varySound, fuseSounds, fusionCompatibility, fitDuration } from './generate'
export type { LabRender } from './generate'
export { DEFAULT_CRITERIA, LAB_WEIGHTS, LAB_AVOID, DURATION_MIN, DURATION_MAX, emptyLabSession, currentSound } from './model'
export { SDK_FAMILIES as LAB_TYPES, SDK_MATERIALS as LAB_MATERIALS, SDK_CHARACTERS as LAB_CHARACTERS, SDK_MOTIONS as LAB_MOTIONS,
  SOUND_FAMILIES, LAB_DIVERSITIES, LAB_SCALES, labFamilyCatalog, labMaterialCatalog, labCharacterCatalog } from './catalog'
export type { LabDomain, SoundFamily, LabMaterial, LabCharacter, LabDiversity, LabScale, SynthesisEngine, SearchPool } from './catalog'
export { describeLabRecipe, DISCOVERY_LAYOUTS } from './discovery'
export type { LabRecipe } from './discovery'
export { LAB_SUBTYPES, labSubtypeCatalog } from './subtypes'
export type { LabSubtype, LabSubtypeOption } from './subtypes'
export type { LabSubtypeGroup } from './detail-catalog'
export { LAB_CHORDS, LAB_VOICINGS, labChordCatalog, chordIntervals, supportsChord } from './harmony-catalog'
export type { LabChord, LabVoicing, HarmonySelections } from './harmony-catalog'
export type { LabCriteria, LabType, LabMotion, LabSound, LabSession, LabRequest, LabRole } from './model'
export { LAB_REGISTERS, LAB_TEXTURES, LAB_ENDINGS, LAB_MASSES, LAB_GESTURES, DEFAULT_SELECTIONS, labGestureOptions, labCriteriaKey, minimumGestureMs } from './selections'
export type { LabSelections, LabGesture, LabGestureOption, LabRegister, LabTexture, LabEnding, LabMass } from './selections'
export { validateLabCriteria, validateLabRequest, validateLabSeed, validateLabSampleRate } from './criteria'
export { sanitizeCriteria, sanitizeLabSound, sanitizeLabSession } from './session'

import { DEFAULT_CRITERIA, type LabCriteria } from './model'
/** Broad discovery is opt-in for old callers; importing this default opts into the new engine. */
export const DEFAULT_DISCOVERY_CRITERIA: LabCriteria = {
  ...DEFAULT_CRITERIA, type: 'any', material: 'any', character: 'any', mass: 'balanced',
  diversity: 'balanced', minMs: 100, maxMs: 2400,
}
