import { DURATION_MAX, DURATION_MIN, LAB_AVOID, LAB_WEIGHTS, LAB_MODES, LAB_AMOUNTS, CONTRIBUTIONS, type LabCriteria, type LabRequest } from './model'
import { SDK_CHARACTERS, SDK_FAMILIES, SDK_MATERIALS, SDK_MOTIONS } from './catalog'
import { validateSelections } from './selections'

/** Strict request validation, distinct from tolerant saved-document migration. */
export function validateLabCriteria(value: unknown): asserts value is LabCriteria {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sound criteria must be an object.')
  const source = value as Record<string, unknown>
  for (const [key, options] of [['type', SDK_FAMILIES], ['material', SDK_MATERIALS], ['character', SDK_CHARACTERS], ['motion', SDK_MOTIONS], ['weight', LAB_WEIGHTS]] as const) {
    if (!(options as readonly unknown[]).includes(source[key])) throw new Error(`Unknown ${key} selection.`)
  }
  for (const key of ['minMs', 'maxMs'] as const) {
    const ms = source[key]
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < DURATION_MIN || ms > DURATION_MAX) throw new Error(`Duration must be a whole number between ${DURATION_MIN} and ${DURATION_MAX} ms.`)
  }
  if ((source.minMs as number) > (source.maxMs as number)) throw new Error('Minimum duration must not exceed maximum duration.')
  if (!Array.isArray(source.avoid) || !source.avoid.every((item) => LAB_AVOID.includes(item))) throw new Error('Unknown sound exclusion.')
  validateSelections(value as LabCriteria)
}

export function validateLabSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer.')
}

export function validateLabSampleRate(rate: number): void {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error('Sample rate must be an integer between 8000 and 192000 Hz.')
}

/** Validate before constructing or rendering candidates; malformed requests never silently change mode. */
export function validateLabRequest(request: LabRequest, rate: number): void {
  if (!request || typeof request !== 'object') throw new Error('A Labs request is required.')
  validateLabCriteria(request.criteria); validateLabSeed(request.seed); validateLabSampleRate(rate)
  if (!LAB_MODES.includes(request.mode)) throw new Error('Unknown Labs operation.')
  if (request.count !== undefined && (!Number.isInteger(request.count) || request.count < 1 || request.count > 4)) throw new Error('Request between one and four candidates.')
  if (request.recentRecipes !== undefined && (!Array.isArray(request.recentRecipes) || !request.recentRecipes.every((r) => typeof r === 'string' && r.length <= 512))) throw new Error('Recent recipes must be recipe strings.')
  if (request.values !== undefined && (!Array.isArray(request.values) || request.values.length !== 4 || !request.values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1))) throw new Error('Provide four macro values between zero and one.')
  if (request.locks !== undefined && (!Array.isArray(request.locks) || request.locks.length !== 4 || !request.locks.every((v) => typeof v === 'boolean'))) throw new Error('Provide four macro lock states.')
  if (request.amount !== undefined && !LAB_AMOUNTS.includes(request.amount)) throw new Error('Unknown variation amount.')
  if (request.contribution !== undefined && !CONTRIBUTIONS.includes(request.contribution)) throw new Error('Unknown fusion contribution.')
  if (request.influence !== undefined && (!Number.isFinite(request.influence) || request.influence < 0 || request.influence > 1)) throw new Error('Fusion influence must be between zero and one.')
  if (request.varyDuration !== undefined && typeof request.varyDuration !== 'boolean') throw new Error('Duration variation must be a boolean.')
}
