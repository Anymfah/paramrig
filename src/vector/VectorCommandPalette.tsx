import { useEffect, useMemo, useRef, useState } from 'react'
import { filterCommands, type VectorCommand } from '@/vector/commands'
import { VectorModal } from '@/vector/VectorModal'

/** Every command in one filterable list: a way to run them, and the list of what exists. */
export function VectorCommandPalette({ commands, open, onClose }: {
  commands: VectorCommand[]
  open: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const results = useMemo(() => filterCommands(commands, query), [commands, query])

  useEffect(() => {
    if (open) return
    setQuery('')
    setActive(0)
  }, [open])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, results.length - 1)))
  }, [results.length])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: VectorCommand) => {
    if (command.disabled) return
    onClose()
    command.run()
  }

  return (
    <VectorModal label="Commands" open={open} onClose={onClose}>
      <input
        className="vector-palette__input"
        value={query}
        placeholder="Search commands"
        aria-label="Search commands"
        role="combobox"
        aria-expanded="true"
        aria-controls="vector-palette-list"
        aria-activedescendant={results[active] ? `vector-command-${results[active].id}` : undefined}
        spellCheck={false}
        onChange={(event) => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((current) => (results.length ? (current + 1) % results.length : 0))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const command = results[active]
            if (command) run(command)
          }
        }}
      />
      <ul id="vector-palette-list" ref={listRef} className="vector-palette__list" role="listbox" aria-label="Commands">
        {results.length === 0 ? <li className="vector-palette__empty">No command matches that.</li> : null}
        {results.map((command, index) => (
          <li key={command.id}>
            <button
              type="button"
              id={`vector-command-${command.id}`}
              className="vector-palette__item"
              role="option"
              aria-selected={index === active}
              aria-disabled={command.disabled || undefined}
              data-active={index === active || undefined}
              onPointerEnter={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span className="vector-palette__section">{command.section}</span>
              <span className="vector-palette__label">{command.label}</span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          </li>
        ))}
      </ul>
    </VectorModal>
  )
}
