import { monoSum, renderPatch } from '@paramrig/audio'
import { waveformBands } from './waveform'
import type { AudioPatch } from './types'
export function audioThumbnail(patch: AudioPatch): string {
  const bands = waveformBands(monoSum(renderPatch(patch, 44100)), 96)
  const top = bands.map((band, index) => `${index ? 'L' : 'M'}${index},${(1 - band.max) * 50}`).join('')
  const bottom = [...bands].reverse().map((band, index) => `L${95 - index},${(1 - band.min) * 50}`).join('')
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 95 100" preserveAspectRatio="none"><path d="${top}${bottom}Z" fill="#9cae9a"/><path d="M0 50H95" stroke="#788477" stroke-width="0.3"/></svg>`)}`
}
