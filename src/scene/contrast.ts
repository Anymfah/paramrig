/**
 * The colour arithmetic the viewport's palette is judged by.
 *
 * A `--scene-*` token is only worth what it reads as on screen, so the QA measures ratios rather
 * than trusting the eye that chose the hex. This module is that measurement and nothing else: no
 * DOM, no canvas, no three.js, so it can be checked against the WCAG worked examples directly.
 *
 * Two conventions are worth stating. Compositing happens in sRGB, on the byte values, because that
 * is where a browser and a GPU blend a translucent overlay; doing it in linear light would give a
 * number no screenshot can ever show. And luminance follows WCAG 2.x to the letter, including the
 * 0.04045 knee, so a ratio computed here is the ratio an accessibility checker reports.
 */

export type Rgb = { r: number; g: number; b: number }

const HEX = /^#([0-9a-f]+)$/i
const FUNCTIONAL = /^rgba?\(([^)]*)\)$/i

/**
 * Reads the notations a stylesheet actually uses: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and
 * `rgba()`, in the comma form and the space form alike. Alpha is dropped here — `alphaOf` reads
 * it — and anything else, a named colour or a `color-mix()`, comes back as `null` rather than as
 * a guess, because a guessed ground would make every ratio measured against it a fiction.
 */
export function parseColour(value: string): Rgb | null {
  const text = value.trim()
  const hex = HEX.exec(text)
  if (hex) return fromHex(hex[1] ?? '')
  const functional = FUNCTIONAL.exec(text)
  if (!functional) return null
  const parts = splitParts(functional[1] ?? '')
  const r = channel(parts[0])
  const g = channel(parts[1])
  const b = channel(parts[2])
  if (r === null || g === null || b === null) return null
  return { r, g, b }
}

/**
 * The alpha a colour carries, from 0 to 1. A colour written without one is opaque, which is what
 * makes this safe to call on every token before compositing it over the viewport.
 */
export function alphaOf(value: string): number {
  const text = value.trim()
  const hex = HEX.exec(text)
  if (hex) {
    const digits = hex[1] ?? ''
    if (digits.length === 4) return byte(digits.slice(3, 4).repeat(2)) / 255
    if (digits.length === 8) return byte(digits.slice(6, 8)) / 255
    return 1
  }
  const functional = FUNCTIONAL.exec(text)
  if (!functional) return 1
  const parts = splitParts(functional[1] ?? '')
  const alpha = parts[3]
  if (alpha === undefined) return 1
  const fraction = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
  return Number.isFinite(fraction) ? clamp01(fraction) : 1
}

/** WCAG relative luminance, from the sRGB bytes. */
export function relativeLuminance(colour: Rgb): number {
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b)
}

/** WCAG contrast: 1 for two colours of the same luminance, 21 for black against white. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** A colour with alpha, seen against a background. */
export function composite(colour: Rgb, alpha: number, over: Rgb): Rgb {
  const weight = clamp01(alpha)
  return {
    r: mix(colour.r, over.r, weight),
    g: mix(colour.g, over.g, weight),
    b: mix(colour.b, over.b, weight),
  }
}

function fromHex(digits: string): Rgb | null {
  if (digits.length === 3 || digits.length === 4) {
    return {
      r: byte(digits.slice(0, 1).repeat(2)),
      g: byte(digits.slice(1, 2).repeat(2)),
      b: byte(digits.slice(2, 3).repeat(2)),
    }
  }
  if (digits.length === 6 || digits.length === 8) {
    return { r: byte(digits.slice(0, 2)), g: byte(digits.slice(2, 4)), b: byte(digits.slice(4, 6)) }
  }
  return null
}

function splitParts(body: string): string[] {
  return body.split(/[\s,/]+/).filter((part) => part.length > 0)
}

/** One `rgb()` channel, as a byte. A percentage is a percentage of 255, as CSS says. */
function channel(part: string | undefined): number | null {
  if (part === undefined) return null
  const value = part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part)
  return Number.isFinite(value) ? clampByte(value) : null
}

function byte(digits: string): number {
  return parseInt(digits, 16)
}

function linear(value: number): number {
  const channelValue = clampByte(value) / 255
  return channelValue <= 0.04045 ? channelValue / 12.92 : ((channelValue + 0.055) / 1.055) ** 2.4
}

function mix(colour: number, over: number, weight: number): number {
  return clampByte(colour * weight + over * (1 - weight))
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}
