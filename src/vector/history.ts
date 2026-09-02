import type { VectorVersion } from '@/vector/types'

/** One reachable state of the document, named after the edit that produced it. */
export type HistoryStep = { index: number; label: string; at: number }

export type HistoryRow =
  | { kind: 'step'; index: number; label: string; at: number; current: boolean; undone: boolean }
  | { kind: 'version'; id: string; label: string; at: number }

export const DEFAULT_STEP_LABEL = 'Edit'
export const START_LABEL = 'Opened'

/**
 * The rows of the history panel: every state the document can be sent back to, newest first, with
 * the named versions dropped in where they were saved.
 */
export function historyRows(steps: HistoryStep[], current: number, versions: VectorVersion[] = []): HistoryRow[] {
  const stepRows: Array<Extract<HistoryRow, { kind: 'step' }>> = steps.map((step) => ({
    kind: 'step',
    index: step.index,
    label: step.label,
    at: step.at,
    current: step.index === current,
    undone: step.index > current,
  }))
  const versionRows: Array<Extract<HistoryRow, { kind: 'version' }>> = versions.map((version) => ({
    kind: 'version',
    id: version.id,
    label: version.name,
    at: Date.parse(version.createdAt) || 0,
  }))
  const rows: HistoryRow[] = []
  for (const step of stepRows) {
    rows.push(step)
    // A version belongs just after the step that was current when it was saved.
    const next = stepRows[step.index + 1]
    for (const version of versionRows) {
      if (version.at < step.at) continue
      if (next && version.at >= next.at) continue
      rows.push(version)
    }
  }
  // Versions older than the first step (a reloaded document) go at the very bottom.
  for (const version of versionRows) {
    if (!rows.includes(version)) rows.unshift(version)
  }
  return rows.reverse()
}

/** How many undo or redo moves it takes to reach a step; negative undoes, positive redoes. */
export function stepDistance(current: number, target: number): number {
  return target - current
}

/** A short, human name for an edit that touched `count` objects. */
export function countedLabel(verb: string, count: number, noun = 'object'): string {
  if (count <= 1) return verb
  return `${verb} ${count} ${noun}s`
}

/**
 * The objects an undo or a redo actually touched: added, removed or changed. Used to put the
 * selection back where the user was working, rather than leaving it on whatever was selected.
 */
export function changedIds(before: Array<{ id: string }>, after: Array<{ id: string }>): string[] {
  const beforeById = new Map(before.map((element) => [element.id, JSON.stringify(element)]))
  const afterById = new Map(after.map((element) => [element.id, JSON.stringify(element)]))
  const ids: string[] = []
  for (const [id, json] of afterById) if (beforeById.get(id) !== json) ids.push(id)
  for (const [id] of beforeById) if (!afterById.has(id) && !ids.includes(id)) ids.push(id)
  return ids
}
