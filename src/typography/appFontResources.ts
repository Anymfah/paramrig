import { googleCssUrl, pickFontFileUrl } from './fontSources'
import type { FontResolver } from './resources'

const shipped: Record<string, string> = { 'Public Sans': 'PublicSans', 'Space Grotesk': 'SpaceGrotesk', 'Source Serif 4': 'SourceSerif4' }
export function appFontUrl(family: string, purpose: 'display' | 'outline' | 'license'): string {
  const base = shipped[family]
  return base ? `/fonts/${base}${purpose === 'license' ? '-OFL.txt' : purpose === 'outline' ? '.ttf' : '.woff2'}` : ''
}

/** Application deployment paths and network policy never enter the SDK. */
export const appFontResolver: FontResolver = async ({ font, weight, purpose, signal }) => {
  let url = appFontUrl(font.family, purpose)
  if (!url && font.source === 'google' && purpose !== 'outline') {
    const css = await fetch(googleCssUrl(font.family, [weight]), { signal })
    if (!css.ok) return null
    url = pickFontFileUrl(await css.text(), weight) ?? ''
  }
  if (!url) return null
  const response = await fetch(url, { signal })
  return response.ok ? response.arrayBuffer() : null
}
