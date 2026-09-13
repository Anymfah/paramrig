export type ColorSpace = 'srgb' | 'display-p3'

/**
 * Colour spaces.
 *
 * Colours are stored as sRGB hex, always: it is what every file format here reads and writes, and
 * what a document opened anywhere else will understand. A document marked Display P3 is a
 * statement about how those numbers should be shown — the same components read in the wider
 * space, which is what `color(display-p3 …)` says — with the hex kept as a fallback for anything
 * that has never heard of it.
 */
export function sanitizeColorSpace(value: unknown): ColorSpace | undefined {
  return value === 'display-p3' ? 'display-p3' : undefined
}

export function isColorSpace(value: unknown): value is ColorSpace {
  return value === 'srgb' || value === 'display-p3'
}

/** The CSS colour for a hex in a given space: wider on a P3 document, plain sRGB otherwise. */
export function cssColor(hex: string, space: ColorSpace | undefined): string {
  if (space !== 'display-p3' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const [r, g, b] = channels(hex)
  return `color(display-p3 ${round(r)} ${round(g)} ${round(b)})`
}

/** Whether a colour asks for more than sRGB can show, once it is read in the wider space. */
export function outOfSrgbGamut(hex: string, space: ColorSpace | undefined): boolean {
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

/** An sRGB hex colour as the three numbers PDF wants, 0 to 1. */
export function rgbChannels(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const channel = (at: number) => (Number.parseInt(clean.slice(at, at + 2), 16) || 0) / 255
  return [channel(0), channel(2), channel(4)]
}

/**
 * A naive sRGB to CMYK conversion, for a print-minded read-out and an optional DeviceCMYK
 * export. There is no ICC profile behind it: it is indicative, not colour-managed.
 */
export function cmykOf(hex: string): [number, number, number, number] {
  const [r, g, b] = rgbChannels(hex)
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return [0, 0, 0, 1]
  return [
    round((1 - r - k) / (1 - k)),
    round((1 - g - k) / (1 - k)),
    round((1 - b - k) / (1 - k)),
    round(k),
  ]
}
