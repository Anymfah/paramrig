import { TEXT_FACES } from '@/vector/text'

/**
 * The outlines a text object is made of, kept where a synchronous evaluator can reach them.
 *
 * Evaluating an object happens while a frame is being drawn: there is nowhere in it to wait for a
 * font file. So the load is asked for once, the answer is kept, and everyone who cares is told when
 * it lands — a text object drawn before its font arrives is empty for one frame and right after.
 *
 * Only the families the app ships an outline file for can be read; that is the vector editor's own
 * limit, for the same reason, and the picker offers exactly those.
 */

export type GlyphCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'Q'; x: number; y: number; x1: number; y1: number }
  | { type: 'Z' }

export type OutlineFont = {
  getPath: (text: string, x: number, y: number, size: number, options?: Record<string, unknown>) => { commands: GlyphCommand[] }
  getAdvanceWidth: (text: string, size: number, options?: Record<string, unknown>) => number
}

/** The families a text object can be set to: the ones with a file whose glyphs can be read. */
export function outlineFamilies(): string[] {
  return TEXT_FACES.filter((face) => face.outlineUrl).map((face) => face.value)
}

const loaded = new Map<string, OutlineFont | null>()
const pending = new Set<string>()
const listeners = new Set<() => void>()

/**
 * The font if it is here, and nothing if it is not — in which case it is asked for, once, and the
 * listeners hear about it. A family with no outline file resolves to null and is never asked twice.
 */
export function outlineFont(family: string): OutlineFont | null {
  const found = loaded.get(family)
  if (found !== undefined) return found
  if (!pending.has(family)) {
    pending.add(family)
    /*
     * The reader is fetched rather than imported. It is the drawing editor's, and it brings that
     * editor's planar network with it — a scene that never shows a letter should not pay for that
     * on the way to its first frame.
     */
    void import('@/vector/textOutline')
      .then((module) => module.loadOutlineFont(family))
      .then((font) => { loaded.set(family, (font as OutlineFont | null) ?? null) })
      .catch(() => { loaded.set(family, null) })
      .finally(() => {
        pending.delete(family)
        for (const listener of listeners) listener()
      })
  }
  return null
}

/** Told whenever a font lands, so what was drawn without it can be drawn again. */
export function onOutlineFont(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Puts a font in the registry without going near the network. Tests and the loader both use it. */
export function registerOutlineFont(family: string, font: OutlineFont | null): void {
  loaded.set(family, font)
  for (const listener of listeners) listener()
}

export function resetOutlineFonts(): void {
  loaded.clear()
  pending.clear()
}
