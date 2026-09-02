import { cmykOf } from '@/vector/pdf'
import type { VectorColorSpace } from '@/vector/types'

/**
 * Colour spaces.
 *
 * Colours are stored as sRGB hex, always: it is what every file format here reads and writes, and
 * what a document opened anywhere else will understand. A document marked Display P3 is a
 * statement about how those numbers should be shown — the same components read in the wider
 * space, which is what `color(display-p3 …)` says — with the hex kept as a fallback for anything
 * that has never heard of it.
 */
export function sanitizeColorSpace(value: unknown): VectorColorSpace | undefined {
  return value === 'display-p3' ? 'display-p3' : undefined
}

export function isColorSpace(value: unknown): value is VectorColorSpace {
  return value === 'srgb' || value === 'display-p3'
}

/** The CSS colour for a hex in a given space: wider on a P3 document, plain sRGB otherwise. */
export function cssColor(hex: string, space: VectorColorSpace | undefined): string {
  if (space !== 'display-p3' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const [r, g, b] = channels(hex)
  return `color(display-p3 ${round(r)} ${round(g)} ${round(b)})`
}

/** Whether a colour asks for more than sRGB can show, once it is read in the wider space. */
export function outOfSrgbGamut(hex: string, space: VectorColorSpace | undefined): boolean {
  if (space !== 'display-p3') return false
  // Read in P3, a fully saturated component reaches past what an sRGB screen can show.
  const [r, g, b] = channels(hex)
  return Math.max(r, g, b) > 0.98 && Math.min(r, g, b) < 0.5
}

/** A print-minded read-out of a colour. Naive, unmanaged, and labelled as such wherever it shows. */
export function cmykLabel(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '—'
  return cmykOf(hex).map((value) => `${Math.round(value * 100)}`).join(' / ')
}

function channels(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const channel = (at: number) => (Number.parseInt(clean.slice(at, at + 2), 16) || 0) / 255
  return [channel(0), channel(2), channel(4)]
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
