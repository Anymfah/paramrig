import { booleanOperation, flattenElement, outlineStroke, type BooleanOperation } from '@/vector/booleans'
import { booleanLabel } from '@/vector/booleanGroups'
import { createVectorElement } from '@/vector/model'
import { mergeNetworks, normalizeWorld, worldNetwork } from '@/vector/network'
import type { VectorElement } from '@/vector/types'

type ElementPatch = { id: string; patch: Partial<VectorElement> }

export type GeometryOpsContext = {
  elements: VectorElement[]
  selected: VectorElement[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean, label?: string) => void
  onSelectIds: (ids: string[]) => void
  onBooleanGroup?: (operation: BooleanOperation, ids: string[]) => void
}

/**
 * The operations that turn one set of shapes into another. They live here rather than in a panel
 * because the inspector, the command palette and the selection bar all ask for the same thing, and
 * a command should not have to reach into the inspector's markup to find a button to click.
 */
export function geometryOps(context: GeometryOpsContext) {
  const { elements, selected, onUpdate, onEditElements, onSelectIds, onBooleanGroup } = context
  const combinable = selected.filter((element) => element.kind !== 'group')
  const single = selected.length === 1 ? selected[0]! : null
  const ordered = () => [...combinable].sort((a, b) => elements.indexOf(a) - elements.indexOf(b))

  const replaceWithPath = (sources: VectorElement[], geometry: ReturnType<typeof booleanOperation>, name: string) => {
    if (!geometry) return
    const first = sources[0]!
    const result: VectorElement = {
      ...createVectorElement('path', geometry, { name, fill: first.fill, stroke: first.stroke, strokeWidth: first.strokeWidth, network: geometry.network }),
      opacity: first.opacity,
      ...(first.fills ? { fills: first.fills } : {}),
      ...(first.strokes ? { strokes: first.strokes } : {}),
      ...(first.strokeAlign ? { strokeAlign: first.strokeAlign } : {}),
      ...(first.strokeCap ? { strokeCap: first.strokeCap } : {}),
      ...(first.strokeJoin ? { strokeJoin: first.strokeJoin } : {}),
      ...(first.strokeDash ? { strokeDash: first.strokeDash } : {}),
      ...(first.parentId ? { parentId: first.parentId } : {}),
    }
    spliceOver(sources, result)
  }

  const spliceOver = (sources: VectorElement[], result: VectorElement) => {
    const ids = new Set(sources.map((element) => element.id))
    onEditElements((all) => {
      const anchor = Math.max(...sources.map((element) => all.findIndex((item) => item.id === element.id)))
      const rest = all.filter((element) => !ids.has(element.id))
      const at = rest.findIndex((element) => all.indexOf(element) > anchor)
      const index = at < 0 ? rest.length : at
      return [...rest.slice(0, index), result, ...rest.slice(index)]
    })
    onSelectIds([result.id])
  }

  return {
    combinable,
    canCombine: combinable.length > 1,
    canOutline: !!single && single.kind !== 'group' && single.strokeWidth > 0 && single.stroke !== 'none',
    canFlatten: combinable.length > 1 || !!combinable[0]?.network,

    /** Wraps the selection in a boolean group, which keeps every shape editable underneath. */
    runBoolean: (operation: BooleanOperation) => {
      if (combinable.length < 2) return
      onBooleanGroup?.(operation, ordered().map((element) => element.id))
    },

    flattenBoolean: (operation: BooleanOperation) => {
      if (combinable.length < 2) return
      const sources = ordered()
      replaceWithPath(sources, booleanOperation(operation, sources), booleanLabel(operation))
    },

    flatten: () => {
      const target = combinable[0]
      if (!target) return
      if (combinable.length > 1) {
        const sources = ordered()
        replaceWithPath(sources, booleanOperation('unite', sources), 'Flattened')
        return
      }
      const geometry = flattenElement(target)
      if (!geometry) return
      onUpdate(target.id, { ...geometry, kind: 'path', rotation: 0, regionsOff: undefined }, true, 'Flatten')
    },

    outline: () => {
      if (!single || single.kind === 'group' || single.strokeWidth <= 0) return
      const geometry = outlineStroke(single)
      if (!geometry) return
      onUpdate(single.id, {
        ...geometry,
        kind: 'path',
        rotation: 0,
        fill: single.stroke,
        fills: single.strokes ?? undefined,
        stroke: 'none',
        strokes: undefined,
        strokeWidth: 0,
        strokeAlign: undefined,
        strokeDash: undefined,
        strokeArrowStart: undefined,
        strokeArrowEnd: undefined,
        strokeSides: undefined,
        cornerRadius: undefined,
        regionsOff: undefined,
      }, true, 'Outline stroke')
    },

    combine: () => {
      if (combinable.length < 2) return
      const merged = normalizeWorld(mergeNetworks(combinable.map((element) => worldNetwork(element))))
      const first = combinable[0]!
      spliceOver(combinable, {
        ...createVectorElement('path', merged, { name: 'Path', fill: first.fill, stroke: first.stroke, strokeWidth: first.strokeWidth, network: merged.network }),
        opacity: first.opacity,
        ...(first.parentId ? { parentId: first.parentId } : {}),
      })
    },
  }
}

export type GeometryOps = ReturnType<typeof geometryOps>
export type { ElementPatch }
