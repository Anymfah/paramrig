import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeTypeInfo } from '@/editor/nodeGraph/types'

/**
 * The add menu, opened where the pointer is.
 *
 * It is a filter and a list rather than a tree of submenus, because a graph editor's node list is
 * long and flat is faster to search than deep: typing three letters is quicker than finding
 * "Converter" and reading down it. The categories are still there as headings, so a person who does
 * not know what they want can browse instead.
 */
export function NodeGraphPalette({ at, registry, onPick, onClose }: {
  at: [number, number]
  registry: NodeTypeInfo[]
  onPick: (type: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => { field.current?.focus() }, [])

  const found = useMemo(() => {
    const wanted = filter.trim().toLowerCase()
    const matches = registry.filter((entry) => (
      !wanted
      || entry.label.toLowerCase().includes(wanted)
      || entry.category.toLowerCase().includes(wanted)
    ))
    return matches
  }, [filter, registry])

  const grouped = useMemo(() => {
    const order: string[] = []
    const byCategory = new Map<string, NodeTypeInfo[]>()
    for (const entry of found) {
      if (!byCategory.has(entry.category)) {
        byCategory.set(entry.category, [])
        order.push(entry.category)
      }
      byCategory.get(entry.category)!.push(entry)
    }
    return order.map((category) => ({ category, entries: byCategory.get(category) ?? [] }))
  }, [found])

  const flat = grouped.flatMap((group) => group.entries)

  return (
    <div className="graph-palette" style={{ left: at[0], top: at[1] }} role="dialog" aria-label="Add node">
      <input
        ref={field}
        className="graph-palette__filter"
        type="text"
        value={filter}
        placeholder="Add a node"
        aria-label="Filter nodes"
        onChange={(event) => {
          setFilter(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((current) => Math.min(flat.length - 1, current + 1))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => Math.max(0, current - 1))
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const chosen = flat[active]
            if (chosen) onPick(chosen.type)
          }
        }}
      />
      <ul className="graph-palette__list scroll-area">
        {grouped.map((group) => (
          <li key={group.category}>
            <p className="graph-palette__heading">{group.category}</p>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.type}>
                  <button
                    type="button"
                    className="graph-palette__entry"
                    data-active={flat[active]?.type === entry.type ? '' : undefined}
                    onClick={() => onPick(entry.type)}
                  >
                    <span className="graph-palette__label">{entry.label}</span>
                    {entry.description ? <span className="graph-palette__note">{entry.description}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {flat.length === 0 ? <li className="graph-palette__empty">Nothing by that name.</li> : null}
      </ul>
    </div>
  )
}
