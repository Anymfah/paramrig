import { createFontLoader } from './fontRuntime'
import { appFontResolver } from './appFontResources'
const makeLoader = () => createFontLoader(request => appFontResolver(request).catch(() => null))
let loader = makeLoader()
type Loader = ReturnType<typeof createFontLoader>
export const fontKey: Loader['fontKey'] = (...args) => loader.fontKey(...args)
export const fontBytes: Loader['fontBytes'] = (...args) => loader.fontBytes(...args)
export const ensureFont: Loader['ensureFont'] = (...args) => loader.ensureFont(...args)
export const ensureFonts: Loader['ensureFonts'] = (...args) => loader.ensureFonts(...args)
export const fontData: Loader['fontData'] = (...args) => loader.fontData(...args)
export function disposeAppFonts(): void { loader.destroy(); loader = makeLoader() }
