import { TEXT_FACES } from '@/typography/faces'
import type { OutlineFont } from '@/typography/outline'
export type { GlyphCommand, OutlineFont } from '@/typography/outline'
export type OutlineFontLookup = (family: string) => OutlineFont | null
export type OutlineFontLoader = (family: string, signal: AbortSignal) => Promise<OutlineFont | null>

export function outlineFamilies(): string[] {
  return TEXT_FACES.filter(face => face.outline).map(face => face.value)
}

/** Owns fonts and in-flight requests for one scene. A lookup never starts network activity. */
export function createOutlineFontRegistry() {
  const loaded = new Map<string, OutlineFont | null>()
  const pending = new Map<string, Promise<OutlineFont | null>>()
  const abort = new AbortController()
  const listeners = new Set<() => void>()
  let disposed = false
  const register = (family: string, font: OutlineFont | null) => {
    if (disposed) return
    loaded.set(family, font)
    for (const listener of listeners) listener()
  }
  return {
    get: (family: string): OutlineFont | null => loaded.get(family) ?? null,
    has: (family: string): boolean => loaded.has(family),
    register,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async ensure(family: string, loader: OutlineFontLoader): Promise<OutlineFont | null> {
      if (disposed) return null
      if (loaded.has(family)) return loaded.get(family) ?? null
      if (!pending.has(family)) pending.set(family, Promise.resolve().then(() => loader(family, abort.signal))
        .then(font => { register(family, font); return disposed ? null : font })
        .finally(() => pending.delete(family)))
      return pending.get(family)!
    },
    clear() { loaded.clear() },
    dispose() { disposed = true; abort.abort(); loaded.clear(); pending.clear(); listeners.clear() },
  }
}

// The editor's compatibility adapter. SDK instances supply their own registry to evaluation.
const editorFonts = createOutlineFontRegistry()
let editorLoader: OutlineFontLoader | undefined
export function configureOutlineFonts(loader: OutlineFontLoader): void { editorLoader = loader }
export function outlineFont(family: string): OutlineFont | null {
  if (!editorFonts.has(family) && editorLoader) void editorFonts.ensure(family, editorLoader).catch(() => editorFonts.register(family, null))
  return editorFonts.get(family)
}
export const onOutlineFont = editorFonts.subscribe
export const registerOutlineFont = editorFonts.register
export const resetOutlineFonts = editorFonts.clear
