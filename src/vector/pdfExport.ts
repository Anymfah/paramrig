import { exportPdf as writePdf } from './pdfRuntime'
import { appFontResolver } from './appFontResources'
export * from './pdfRuntime'
export const exportPdf = (pages: Parameters<typeof writePdf>[0], options: Parameters<typeof writePdf>[1] = {}) => writePdf(pages, { resolveFont: appFontResolver, ...options })
