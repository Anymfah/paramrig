import { loadOutlineFont as load, outlineText as outline } from './outlineRuntime'
import { appFontResolver } from './appFontResources'
import type { VectorElement, VectorFont } from './types'
export * from './outlineRuntime'
export const loadOutlineFont = (family: string, fonts: VectorFont[] = []) => load(family, fonts, appFontResolver)
export const outlineText = (element: VectorElement, fonts: VectorFont[] = []) => outline(element, fonts, appFontResolver)
