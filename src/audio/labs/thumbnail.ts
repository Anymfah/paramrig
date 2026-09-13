import type { Stereo } from '@paramrig/audio'

export const THUMBNAIL_COLUMNS = 384
/** Signed peaks and stereo energy, measured from the rendered audio rather than decorative noise. */
export type LabThumbnail = { version: 1; min: number[]; max: number[]; rms: number[] }

export function measureThumbnail(samples: Stereo): LabThumbnail {
  const detail: LabThumbnail = { version: 1, min: [], max: [], rms: [] }
  const length = Math.min(samples.left.length, samples.right.length)
  const rounded = (value: number) => Math.round(value * 100000) / 100000
  for (let column = 0; column < THUMBNAIL_COLUMNS; column++) {
    const from = Math.floor(column * length / THUMBNAIL_COLUMNS)
    const to = Math.min(length, Math.max(from + 1, Math.floor((column + 1) * length / THUMBNAIL_COLUMNS)))
    let min = 0, max = 0, energy = 0
    for (let i = from; i < to; i++) {
      const left = Number.isFinite(samples.left[i]) ? samples.left[i]! : 0
      const right = Number.isFinite(samples.right[i]) ? samples.right[i]! : 0
      min = Math.min(min, left, right); max = Math.max(max, left, right)
      energy += (left * left + right * right) / 2
    }
    detail.min.push(rounded(Math.max(-1, min)))
    detail.max.push(rounded(Math.min(1, max)))
    detail.rms.push(rounded(Math.min(1, Math.sqrt(energy / Math.max(1, to - from)))))
  }
  return detail
}

export function readThumbnail(value: unknown): LabThumbnail | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<LabThumbnail>
  const valid = (values: unknown, min: number, max: number): values is number[] => Array.isArray(values) && values.length === THUMBNAIL_COLUMNS && values.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max)
  if (source.version !== 1 || !valid(source.min, -1, 0) || !valid(source.max, 0, 1) || !valid(source.rms, 0, 1)) return undefined
  return { version: 1, min: [...source.min], max: [...source.max], rms: [...source.rms] }
}
