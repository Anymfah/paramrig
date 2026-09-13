import { configureOutlineFonts } from './curve/font'
import { loadOutlineFont } from '@/typography/outline'
import { appFontResolver } from '@/typography/appFontResources'

/** Application-only deployment resources; never part of the scene package. */
export function initializeSceneResources(): void {
  configureOutlineFonts((family, signal) => loadOutlineFont(family, [], appFontResolver, signal))
}
