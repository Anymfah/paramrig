import { brushesOf } from '@/vector/brushes'
import { componentsOf, instanceCount } from '@/vector/instances'
import { fillsOf, strokesOf, summaryColor } from '@/vector/paints'
import { styleIdKey } from '@/vector/styles'
import type { VectorBrush, VectorDocument, VectorElement } from '@/vector/types'

export type AssetKind = 'component' | 'style' | 'brush' | 'pattern' | 'font'

/**
 * One reusable thing a document holds. The rail lists them; the inspector only ever applies them,
 * so a name, a colour and the list of objects that follow it are all a line needs.
 */
export type Asset = {
  id: string
  kind: AssetKind
  name: string
  /** What kind of style, what format of font: whatever the line says after the name. */
  detail?: string
  /** A colour for the line's chip, when the asset has one. */
  swatch?: string
  /** The objects that follow this asset, so the rail can select them. */
  userIds: string[]
  /** Assets that ship with the app cannot be renamed or deleted. */
  builtin?: boolean
  /** Components and patterns are dragged onto the canvas; the element they stamp. */
  sourceId?: string
  /** A brush's stamp, so its line can draw it. */
  network?: VectorBrush['network']
}

export type AssetGroup = { id: string; label: string; assets: Asset[] }

const STYLE_DETAIL: Record<string, string> = { fill: 'Fill', stroke: 'Stroke', effect: 'Effects' }

/** Every element a pattern paint stamps, and the objects painted with it. */
export function patternSources(elements: VectorElement[]): Map<string, string[]> {
  const sources = new Map<string, string[]>()
  for (const element of elements) {
    for (const paint of [...fillsOf(element), ...strokesOf(element)]) {
      if (paint.type !== 'pattern' || !paint.sourceId) continue
      sources.set(paint.sourceId, [...(sources.get(paint.sourceId) ?? []), element.id])
    }
  }
  return sources
}

/** The objects whose text is set in a family. */
export function fontUsers(elements: VectorElement[], family: string): string[] {
  return elements.filter((element) => element.kind === 'text' && element.fontFamily === family).map((element) => element.id)
}

/** Everything the document reuses, gathered by family in the order the rail shows them. */
export function documentAssets(document: VectorDocument): AssetGroup[] {
  const elements = document.elements
  const sources = patternSources(elements)
  const byId = new Map(elements.map((element) => [element.id, element]))
  return [
    {
      id: 'components',
      label: 'Components',
      assets: componentsOf(elements).map((component) => ({
        id: component.id,
        kind: 'component' as const,
        name: component.name,
        detail: `${instanceCount(elements, component.id)} used`,
        userIds: elements.filter((element) => element.componentId === component.id).map((element) => element.id),
        sourceId: component.id,
      })),
    },
    {
      id: 'styles',
      label: 'Styles',
      assets: (document.styles ?? []).map((style) => ({
        id: style.id,
        kind: 'style' as const,
        name: style.name,
        detail: STYLE_DETAIL[style.kind] ?? style.kind,
        swatch: style.kind === 'effect' ? undefined : summaryColor(style.paints),
        userIds: elements.filter((element) => element[styleIdKey(style.kind)] === style.id).map((element) => element.id),
      })),
    },
    {
      id: 'brushes',
      label: 'Brushes',
      assets: brushesOf(document).map((brush) => ({
        id: brush.id,
        kind: 'brush' as const,
        name: brush.name,
        network: brush.network,
        builtin: brush.id.startsWith('brush-') && !(document.brushes ?? []).some((item) => item.id === brush.id),
        userIds: elements.filter((element) => element.brush?.id === brush.id).map((element) => element.id),
      })),
    },
    {
      id: 'patterns',
      label: 'Patterns',
      assets: [...sources].flatMap(([sourceId, userIds]) => {
        const source = byId.get(sourceId)
        return source ? [{
          id: sourceId,
          kind: 'pattern' as const,
          name: source.name,
          detail: `${Math.round(source.width)} × ${Math.round(source.height)}`,
          userIds,
          sourceId,
        }] : []
      }),
    },
    {
      id: 'fonts',
      label: 'Fonts',
      assets: (document.fonts ?? []).map((font) => ({
        id: font.family,
        kind: 'font' as const,
        name: font.family,
        detail: font.source === 'file' ? (font.format ?? 'file').toUpperCase() : font.source === 'google' ? 'Google' : 'System',
        userIds: fontUsers(elements, font.family),
      })),
    },
  ]
}

/** How many things the document reuses, for the tab that offers them. */
export function assetCount(groups: AssetGroup[]): number {
  return groups.reduce((total, group) => total + group.assets.length, 0)
}
