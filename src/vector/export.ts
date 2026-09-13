import { embedFonts as embed } from './exportRuntime'
import { appFontResolver } from './appFontResources'
import type { VectorFont } from './types'
export * from './exportRuntime'
export function embedFonts(markup: string, fonts: VectorFont[] = [], strict = false): Promise<string> { return embed(markup, fonts, strict, appFontResolver) }
