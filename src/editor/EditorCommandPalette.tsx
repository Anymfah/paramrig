import { useEffect, useMemo, useRef, useState } from 'react'
import { filterCommands, type EditorCommand } from '@/editor/commands'
import { EditorModal } from '@/editor/EditorModal'

/** Every command in one filterable list: a way to run them, and the list of what exists. */
export function EditorCommandPalette<Command extends EditorCommand>({ commands, open, onClose, prefix = 'editor', label = 'Commands', recent = [], onRun }: {
  commands: Command[]
  open: boolean
  onClose: () => void
  prefix?: string
  label?: string
  /** What was run from here before, most recent first: it opens on the last choice. */
  recent?: string[]
  /** Told what was run, so the editor can remember it across sessions. */
  onRun?: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const results = useMemo(() => filterCommands(commands, query, recent), [commands, query, recent])

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

  const run = (command: Command) => {
    if (command.disabled) return
    onClose()
    onRun?.(command.id)
    command.run()
  }

  return (
    <EditorModal prefix={prefix} label={label} open={open} onClose={onClose}>
      <input
        className={`${prefix}-palette__input`}
        value={query}
        placeholder="Search commands"
        aria-label="Search commands"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${prefix}-palette-list`}
        aria-activedescendant={results[active] ? `${prefix}-command-${results[active].id}` : undefined}
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
      <ul id={`${prefix}-palette-list`} ref={listRef} className={`${prefix}-palette__list`} role="listbox" aria-label={label}>
        {results.length === 0 ? <li className={`${prefix}-palette__empty`}>No command matches that.</li> : null}
        {results.map((command, index) => (
          <li key={command.id}>
            <button
              type="button"
              id={`${prefix}-command-${command.id}`}
              className={`${prefix}-palette__item`}
              role="option"
              aria-selected={index === active}
              aria-disabled={command.disabled || undefined}
              data-active={index === active || undefined}
              onPointerEnter={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span className={`${prefix}-palette__section`}>{command.section}</span>
              <span className={`${prefix}-palette__label`}>{command.label}</span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          </li>
        ))}
      </ul>
    </EditorModal>
  )
}
