import { buildTree, descendantIds, type TreeNode } from './tree'
import type { VectorDocument, VectorElement, VectorColorSpace } from './types'
import { defsToSvg, layersToSvg, renderModel } from './render'
import { cssColor } from './colorSpace'
import { backdropBlur } from './filters'
import { selectionBounds } from './geometry'
import { arcProperties, isFullEllipse } from './shapes'
export function serializeVectorDocument(document: VectorDocument): string {
  return serializeVectorMarkup(document.elements, { x: 0, y: 0, width: document.width, height: document.height }, undefined, document.colorSpace)
}

/** SVG for a subset of a document over an arbitrary box, with an optional painted background. */
export function serializeVectorMarkup(
  elements: VectorElement[],
  viewBox: { x: number; y: number; width: number; height: number },
  background?: string,
  space?: VectorColorSpace,
): string {
  const defs: string[] = []
  const lines = serializeNodes(buildTree(elements), 1, defs, elements, space)
  const body = lines.join('\n')
  // A baked backdrop repeats the defs of what it copies; the same string twice is the same def.
  const unique = [...new Set(defs)]
  const defsMarkup = unique.length ? `  <defs>${unique.join('')}</defs>\n` : ''
  const width = round(viewBox.width)
  const height = round(viewBox.height)
  const paint = background
    ? `  <rect x="${round(viewBox.x)}" y="${round(viewBox.y)}" width="${width}" height="${height}" fill="${escapeXml(background)}"/>\n`
    : ''
  // A profiled stroke has no SVG equivalent: it leaves as the shape it sweeps, and the file says so.
  const flattened = elements.some((element) => element.strokeProfile || element.brush)
    ? '  <!-- Variable-width and brushed strokes are flattened to filled paths: SVG has no equivalent. -->\n'
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(viewBox.x)} ${round(viewBox.y)} ${width} ${height}" width="${width}" height="${height}">\n${flattened}${defsMarkup}${paint}${body}${body ? '\n' : ''}</svg>\n`
}

/** Markup for one element's paint layers plus the defs it needs; used by exports and thumbnails. */
export function elementMarkup(element: VectorElement, prefix: string, scene: VectorElement[] = [], space?: VectorColorSpace): { defs: string; body: string } {
  const model = renderModel(element, prefix, scene)
  return { defs: defsToSvg(model.defs), body: layersToSvg(model, element.id, space) }
}

/**
 * Inline SVG markup for a document preview: the same serialisation the export uses, without the
 * `<svg>` wrapper. Sharing the one path is what keeps a thumbnail honest — frames clip, masks cut,
 * effects paint and a frosted pane frosts, instead of a flat pile of leaves that shows none of it.
 */
export function documentThumbnail(document: Pick<VectorDocument, 'id' | 'elements'>): string {
  const defs: string[] = []
  const body = serializeNodes(buildTree(document.elements), 0, defs, document.elements).join('')
  const unique = [...new Set(defs)]
  return `${unique.length ? `<defs>${unique.join('')}</defs>` : ''}${body}`
}

/** Inline markup for one component's own subtree, for the assets list. */
export function componentThumbnail(elements: VectorElement[], componentId: string): string {
  const wanted = new Set(descendantIds(elements, componentId))
  const subtree = elements.filter((element) => wanted.has(element.id))
  const defs: string[] = []
  const body = serializeNodes(buildTree(subtree.map((element) => element.parentId === componentId ? { ...element, parentId: undefined } : element)), 0, defs, elements).join('')
  const unique = [...new Set(defs)]
  return `${unique.length ? `<defs>${unique.join('')}</defs>` : ''}${body}`
}

function serializeNodes(nodes: TreeNode[], depth: number, defs: string[], scene: VectorElement[], space?: VectorColorSpace): string[] {
  const indent = '  '.repeat(depth)
  return nodes.flatMap((node) => {
    const element = node.element
    if (!element.visible) return []
    const backdrop = backdropMarkup(scene, element, depth, defs)
    if (element.kind === 'frame') {
      const model = renderModel(element, 'svg', scene)
      const background = defsToSvg(model.defs)
      if (background) defs.push(background)
      const children = serializeNodes(node.children, depth + 1, defs, scene, space)
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      const body = layersToSvg(model, element.id, space)
      if (element.clipContent && children.length) {
        const clipId = `frame-clip-${element.id}`
        defs.push(`<clipPath id="${escapeXml(clipId)}"><path d="${model.d}" transform="${model.transform}"/></clipPath>`)
        return [
          ...backdrop,
          `${indent}<g id="${escapeXml(element.id)}"${opacity}>`,
          ...(body ? [`${indent}  ${body}`] : []),
          `${indent}  <g clip-path="url(#${escapeXml(clipId)})">`,
          ...children,
          `${indent}  </g>`,
          `${indent}</g>`,
        ]
      }
      return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}${effectAttributes(element, scene)}>`, ...(body ? [`${indent}  ${body}`] : []), ...children, `${indent}</g>`]
    }
    // A component and an instance serialise like a group: the shapes they hold, expanded.
    if (element.kind === 'group' || element.kind === 'component' || element.kind === 'instance') {
      const maskNode = node.children[0]?.element.mask ? node.children[0]! : null
      const children = serializeNodes(maskNode ? node.children.slice(1) : node.children, depth + 1, defs, scene, space)
      if (children.length === 0) return []
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      if (maskNode) {
        const model = renderModel(maskNode.element, 'svg', scene)
        const clipId = `mask-${element.id}`
        defs.push(`<clipPath id="${escapeXml(clipId)}"><path d="${model.fillD || model.d}" transform="${model.transform}" clip-rule="evenodd"/></clipPath>`)
        return [
          ...backdrop,
          `${indent}<g id="${escapeXml(element.id)}"${opacity} clip-path="url(#${escapeXml(clipId)})">`,
          ...children,
          `${indent}</g>`,
        ]
      }
      return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}>`, ...children, `${indent}</g>`]
    }
    if (element.kind === 'boolean') {
      // The combined shape is what the file carries; its members are not exported.
      const markup = elementMarkup(element, 'svg', scene, space)
      if (markup.defs) defs.push(markup.defs)
      if (!markup.body) return []
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}${effectAttributes(element, scene)}>${markup.body}</g>`]
    }
    // Only a plain box or a whole ellipse takes the short export path.
    const sliced = element.kind === 'ellipse' && !isFullEllipse(arcProperties(element))
    const simple = !element.effects?.length && !element.blendMode && !element.strokeProfile && !element.brush && element.kind !== 'text' && element.kind !== 'image' && element.kind !== 'polygon' && !sliced && !element.network && !element.fills && !element.strokes && !element.strokeAlign && !element.strokeCap && !element.strokeJoin && !element.strokeDash
      && !element.strokeArrowStart && !element.strokeArrowEnd && !element.strokeSides && !element.cornerRadius
    const transform = `rotate(${element.rotation} ${round(element.x + element.width / 2)} ${round(element.y + element.height / 2)})`
    if (simple) {
      // On a wide-gamut document the same colours are stated again in CSS, as everywhere else.
      const wide = space === 'display-p3'
        ? [element.fill, element.stroke].some((color) => color.startsWith('#'))
          ? ` style="${[
            element.fill.startsWith('#') ? `fill:${cssColor(element.fill, space)}` : '',
            element.stroke.startsWith('#') ? `stroke:${cssColor(element.stroke, space)}` : '',
          ].filter(Boolean).join(';')}"`
          : ''
        : ''
      const common = [
        `fill="${escapeXml(element.fill)}"`,
        `stroke="${escapeXml(element.stroke)}"`,
        `stroke-width="${element.strokeWidth}"`,
        `opacity="${element.opacity}"`,
        `transform="${transform}"`,
      ].join(' ') + wide
      if (element.kind === 'ellipse') {
        return [...backdrop, `${indent}<ellipse id="${escapeXml(element.id)}" cx="${round(element.x + element.width / 2)}" cy="${round(element.y + element.height / 2)}" rx="${round(element.width / 2)}" ry="${round(element.height / 2)}" ${common}/>`]
      }
      return [...backdrop, `${indent}<rect id="${escapeXml(element.id)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" ${common}/>`]
    }
    const markup = elementMarkup(element, 'svg', scene, space)
    if (markup.defs) defs.push(markup.defs)
    if (!markup.body) return []
    const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
    return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}${effectAttributes(element, scene)}>${markup.body}</g>`]
  })
}

/**
 * A background blur has nothing to sample in SVG: the format has no backdrop. At export it is
 * baked instead — everything painted under the element is copied, blurred as a whole and clipped
 * to the element's own shape, then dropped in just below it. The copies lose their own background
 * blurs, so a stack of frosted panes flattens rather than multiplying the file.
 */
function backdropMarkup(scene: VectorElement[], element: VectorElement, depth: number, defs: string[]): string[] {
  const blur = backdropBlur(element)
  if (!blur || !element.visible) return []
  const index = scene.findIndex((item) => item.id === element.id)
  if (index <= 0) return []
  const own = new Set([element.id, ...descendantIds(scene, element.id)])
  const below = scene.slice(0, index).filter((item) => item.visible && !own.has(item.id))
  if (below.length === 0) return []
  const kept = new Set(below.map((item) => item.id))
  // The copies are renamed, so the file never carries the same id — or the same def — twice.
  const copyId = (id: string) => `bd-${element.id}-${id}`
  const copies = below.map((item) => {
    const effects = item.effects?.filter((effect) => effect.kind !== 'backgroundBlur')
    const parentId = item.parentId && kept.has(item.parentId) ? copyId(item.parentId) : undefined
    return { ...item, id: copyId(item.id), ...(effects?.length ? { effects } : { effects: undefined }), parentId }
  })
  const model = renderModel(element, 'svg')
  const clipId = `backdrop-clip-${element.id}`
  const filterId = `backdrop-blur-${element.id}`
  // The region reaches past the shape by three sigma so the blur inside it samples what it should.
  const box = selectionBounds([element])
  const margin = blur * 3
  defs.push(`<clipPath id="${escapeXml(clipId)}"><path d="${model.fillD || model.d}" transform="${model.transform}" clip-rule="evenodd"/></clipPath>`)
  defs.push(`<filter id="${escapeXml(filterId)}" filterUnits="userSpaceOnUse" x="${round(box.x - margin)}" y="${round(box.y - margin)}" width="${round(box.width + margin * 2)}" height="${round(box.height + margin * 2)}"><feGaussianBlur stdDeviation="${round(blur / 2)}"/></filter>`)
  const indent = '  '.repeat(depth)
  return [
    `${indent}<g clip-path="url(#${escapeXml(clipId)})" filter="url(#${escapeXml(filterId)})" aria-hidden="true">`,
    ...serializeNodes(buildTree(copies), depth + 1, defs, copies),
    `${indent}</g>`,
  ]
}

/** The filter and blend attributes an element's effects put on its wrapper. */
function effectAttributes(element: VectorElement, scene: VectorElement[], prefix = 'svg'): string {
  const model = renderModel(element, prefix, scene)
  const blend = model.blend ? ` style="mix-blend-mode:${model.blend}"` : ''
  return `${model.filter ? ` filter="${escapeXml(model.filter)}"` : ''}${blend}`
}

/** What an instance is allowed to remember about its copies, and nothing else. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
