import { appFontUrl } from './appFontResources'
import { serializeVectorMarkup } from '@/vector/serialization'
import { DEFAULT_EXPORT, embedFonts, exportMarkup, rasterize } from '@/vector/export'
import { ensureFonts } from '@/vector/fontLoader'
import { checkBrand } from '@/vector/brandChecks'
import { zipFiles, type ZipFile } from '@/vector/zip'
import { brandApplications, faviconIco } from '@/vector/brandApplications'
import { variationSettings } from '@/vector/fontCapabilities'
import { TEXT_FACES } from '@/vector/text'
import type { VectorDocument, VectorElement } from '@/vector/types'

export const isBrandDocument = (document: VectorDocument | null) => !!document?.rig?.parameters.some(param => param.id === 'body-font-family') && !!document.elements.find(element => element.id === 'cover-mark')

/** Actual resolved artwork is the source of the kit, never default parameter values. */
export async function brandKitFiles(document: VectorDocument): Promise<Array<{ name: string; content: string }>> {
  if (!isBrandDocument(document)) throw new Error('This document does not contain a brand system.')
  await ensureFonts(document.fonts)
  await globalThis.document?.fonts?.ready
  const files: Array<{ name: string; content: string }> = []
  const find = (id: string) => {
    const element = document.elements.find(item => item.id === id)
    if (!element) throw new Error(`The brand kit needs the ${id} element. Restore it before exporting.`)
    return element
  }
  for (const frame of document.elements.filter(element => element.kind === 'frame' && element.visible)) {
    const markup = exportMarkup(document, { ...DEFAULT_EXPORT, target: 'frame' }, { frameId: frame.id, selectedIds: [] })!
    files.push({ name: `guidelines/${frame.id}.svg`, content: await embedFonts(markup, document.fonts, true) })
  }
  const colors = Object.fromEntries(['paper', 'ink', 'field', 'lime'].map(name => [name, find(`${name}-swatch`).fill]))
  const symbol = find('cover-mark')
  for (const name of ['ink', 'paper', 'field']) {
    const element = { ...symbol, id: 'symbol', parentId: undefined, x: 0, y: 0, width: 200, height: 200, fill: colors[name]!, fills: undefined }
    files.push({ name: `logos/symbol-${name}.svg`, content: serializeVectorMarkup([element], { x: 0, y: 0, width: 200, height: 200 }) })
  }
  for (const name of ['ink', 'paper']) {
    const original = find('lockup-positive'), wordmark = find('lockup-name')
    const elements: VectorElement[] = [original, wordmark].map(element => ({ ...element, parentId: undefined, x: element.x - original.x, y: element.y - original.y, fill: colors[name]!, fills: undefined }))
    const width = Math.max(...elements.map(element => element.x + element.width)), height = Math.max(...elements.map(element => element.y + element.height))
    files.push({ name: `logos/lockup-${name}.svg`, content: await embedFonts(serializeVectorMarkup(elements, { x: 0, y: 0, width, height }), document.fonts, true) })
  }
  const type = (id: string) => {
    const element = find(id)
    return { family: element.fontFamily, weight: element.fontWeight, size: element.fontSize, lineHeight: element.lineHeight, letterSpacing: element.letterSpacing, ...(element.fontVariations ? { variations: element.fontVariations } : {}) }
  }
  const typography = { display: type('type-display-sample'), heading: type('type-heading-sample'), body: type('type-body-sample'), caption: type('type-caption-sample') }
  const tokens = { name: find('cover-wordmark').text, colorSpace: document.colorSpace ?? 'srgb', colors, typography }
  files.push({ name: 'tokens.json', content: JSON.stringify(tokens, null, 2) })
  const cssString = (value: string | undefined) => JSON.stringify(value ?? '').replaceAll('<', '\\3c ').replaceAll('>', '\\3e ')
  files.push({ name: 'tokens.css', content: `:root {\n${Object.entries(colors).map(([name, color]) => `  --brand-${name}: ${color};`).join('\n')}\n${Object.entries(typography).map(([role, value]) => `  --brand-${role}-font: ${cssString(value.family)};\n  --brand-${role}-weight: ${value.weight};\n  --brand-${role}-size: ${value.size}px;\n  --brand-${role}-leading: ${value.lineHeight};\n  --brand-${role}-tracking: ${value.letterSpacing}px;\n  --brand-${role}-variations: ${variationSettings(value.variations) ?? 'normal'};`).join('\n')}\n}\n` })
  files.push({ name: 'checks.json', content: JSON.stringify(checkBrand(document), null, 2) })
  const usedFamilies = new Set(document.elements.filter(element => element.kind === 'text' && element.visible).map(element => element.fontFamily))
  for (const face of TEXT_FACES.filter(face => face.webFont && usedFamilies.has(face.value))) {
    const licenseUrl = appFontUrl(face.value, 'license')
    const response = await fetch(licenseUrl)
    if (!response.ok) throw new Error(`Could not include the ${face.label} font licence. Retry before distributing the kit.`)
    files.push({ name: `licenses/${licenseUrl.split('/').at(-1)!}`, content: await response.text() })
  }
  for (const application of brandApplications(document)) files.push({ name: `applications/${application.name}.svg`, content: await embedFonts(application.markup, document.fonts, true) })
  for (const font of document.fonts ?? []) if (font.license && usedFamilies.has(font.family)) files.push({ name: `licenses/${font.family.replace(/[^a-z0-9]+/gi, '-')}-LICENSE.txt`, content: font.license })
  files.push({ name: 'README.md', content: `# ${tokens.name}\n\nCurrent brand kit exported from ParamRig.\n\n- guidelines/: current visible guideline pages, in SVG.\n- logos/: three symbol colours and two horizontal lockups, on transparent backgrounds.\n- applications/: favicon (SVG, 16/32 px PNG, ICO), avatar (1024 square), social square (1080), story (1080 × 1920) and landscape (1200 × 630). Avatar and social artwork are included in SVG and PNG.\n- tokens.json / tokens.css: current colours and type roles. CSS tokens reference fonts; they do not install them.\n- checks.json: advisory overflow, contrast and font-portability notices. Review before distributing.\n\nApplications use your current brand name, campaign, event details, colours and typography. Long copy is fitted to each format. Story copy leaves 240 px at the top and bottom; check the destination's overlays before publishing.\n\nSVG files embed shipped and imported fonts, and downloaded Google font data, including variable axes. Weights are limited to the selected font's available range. System font capabilities cannot be verified: import a licensed font file for predictable delivery. Some SVG applications ignore embedded fonts; check in your delivery application.\n\nFont licences remain applicable; verify embedding and redistribution rights for imported files. Convert colours with the printer's ICC profile and approve a physical proof. No Pantone or CMYK equivalence is implied.\n` })
  return files
}

export async function brandKitArchive(document: VectorDocument): Promise<Uint8Array<ArrayBuffer>> {
  const files: ZipFile[] = await brandKitFiles(document)
  const icons: Array<{ size: number; bytes: Uint8Array }> = []
  for (const application of brandApplications(document)) {
    const markup = files.find(file => file.name === `applications/${application.name}.svg`)!.content as string
    for (const size of application.name === 'favicon' ? [16, 32] : [application.width]) {
      const blob = await rasterize(markup, { x: 0, y: 0, width: application.width, height: application.height }, size / application.width, 'image/png', document.colorSpace)
      if (!blob) throw new Error(`Could not render ${application.name}. Retry before distributing the kit.`)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      files.push({ name: `applications/${application.name}${application.name === 'favicon' ? `-${size}` : ''}.png`, content: bytes })
      if (application.name === 'favicon') icons.push({ size, bytes })
    }
  }
  files.push({ name: 'applications/favicon.ico', content: faviconIco(icons) })
  return zipFiles(files)
}

export async function downloadBrandKit(document: VectorDocument): Promise<void> {
  const archive = await brandKitArchive(document)
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }))
  const anchor = globalThis.document.createElement('a')
  anchor.href = url; anchor.download = `${document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-brand-kit.zip`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
