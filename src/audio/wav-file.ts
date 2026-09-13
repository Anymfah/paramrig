import { renderPatch } from '@/audio/dsp/render'
import { encodeWav } from '@/audio/dsp/wav'
import type { AudioPatch } from '@/audio/types'

/**
 * The rate a file is written at, whatever the machine happens to play at.
 *
 * 44.1 kHz is the rate a bounced file is expected at. Playing live at the device's native rate
 * is a different job.
 */
export const EXPORT_RATE = 44100

/** A file name from a sound's name: lower case, words joined by hyphens, nothing else. */
const fileName = (name: string) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound'}.wav`

export function saveWav(patch: AudioPatch, name: string): void {
  const blob = new Blob([encodeWav(renderPatch(patch, EXPORT_RATE), EXPORT_RATE) as BlobPart], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName(name)
  link.click()
  // Freed on the next turn of the loop: revoking it in the same one races the click in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
