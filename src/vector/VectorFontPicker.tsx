import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/ui/Button'
import { StatusMessage } from '@/ui/StatusMessage'
import { TEXT_FACES } from '@/vector/text'
import { MAX_FONT_BYTES, readFontFile, searchGoogleFamilies } from '@/vector/fonts'
import type { VectorFont } from '@/vector/types'

const ROW_HEIGHT = 34
const VIEWPORT_ROWS = 9
const OVERSCAN = 3

type Row =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'font'; key: string; family: string; note: string; source: VectorFont['source'] | 'app' }

/**
 * The font list.
 *
 * A select would have to hold the app's faces, the document's own, and thirty Google families,
 * each previewed in its own face — so this is a list rather than a menu, and it renders only the
 * rows in view. Picking a Google family adds it to the document and loads it; picking a file
 * imports it, with its bytes, so the document carries it wherever it goes.
 */
export function VectorFontPicker({ value, fonts, onPick, onImport, label = 'Font' }: {
  label?: string
  value: string
  fonts: VectorFont[]
  onPick: (family: string, source: VectorFont['source'] | 'app') => void
  onImport: (font: VectorFont) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scroll, setScroll] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [active, setActive] = useState(-1)
  // Loading a Google face adds it to the document. Keep the browsing order
  // stable until the next opening so held arrow keys cannot jump backwards.
  const [openedFonts, setOpenedFonts] = useState(fonts)
  const library = open ? openedFonts : fonts

  const rows = useMemo((): Row[] => {
    const needle = query.trim().toLowerCase()
    const matches = (family: string) => !needle || family.toLowerCase().includes(needle)
    const mine = library.filter((font) => matches(font.family))
    const app = TEXT_FACES.filter((face) => matches(face.label))
    const google = searchGoogleFamilies(query).filter((family) => !library.some((font) => font.family === family))
    return [
      ...(mine.length ? [{ kind: 'heading', key: 'h-doc', label: 'In this document' } as Row] : []),
      ...mine.map((font): Row => ({ kind: 'font', key: `doc-${font.family}`, family: font.family, note: font.source === 'file' ? 'Imported' : 'Google', source: font.source })),
      ...(app.length ? [{ kind: 'heading', key: 'h-app', label: 'Available here' } as Row] : []),
      ...app.map((face): Row => ({ kind: 'font', key: `app-${face.value}`, family: face.value, note: face.outline ? 'Ships with the app' : 'System', source: 'app' })),
      ...(google.length ? [{ kind: 'heading', key: 'h-google', label: 'Google Fonts' } as Row] : []),
      ...google.map((family): Row => ({ kind: 'font', key: `google-${family}`, family, note: 'Loads on demand', source: 'google' })),
      ...(!mine.length && !app.length && !google.length && query.trim() ? [{ kind: 'font', key: 'google-exact', family: query.trim(), note: 'Try Google Fonts', source: 'google' } as Row] : []),
    ]
  }, [library, query])

  const changeOpen = (next: boolean) => {
    if (next) {
      setOpenedFonts(fonts)
      setActive(rows.findIndex(row => row.kind === 'font' && row.family === value))
    } else { setQuery(''); setScroll(0); setError(null); setActive(-1) }
    setOpen(next)
  }

  const move = (direction: 1 | -1) => {
    const indices = rows.flatMap((row, index) => row.kind === 'font' ? [index] : [])
    const current = active >= 0 ? active : rows.findIndex(row => row.kind === 'font' && row.family === value)
    const position = indices.indexOf(current)
    const next = indices[position < 0 ? (direction === 1 ? 0 : indices.length - 1) : (position + direction + indices.length) % indices.length]
    const row = next === undefined ? undefined : rows[next]
    if (row?.kind !== 'font') return
    setActive(next!)
    onPick(row.family, row.source)
  }

  useEffect(() => {
    const viewport = list.current
    if (!open || active < 0 || !viewport) return
    const top = active * ROW_HEIGHT
    if (top < viewport.scrollTop) viewport.scrollTop = top
    else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + ROW_HEIGHT - viewport.clientHeight
    setScroll(viewport.scrollTop)
  }, [active, open])

  const start = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(rows.length, start + VIEWPORT_ROWS + OVERSCAN * 2)
  const visible = rows.slice(start, end)

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const result = await readFontFile(file)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    onImport(result.font)
    changeOpen(false)
  }

  return (
    <div className="control control--field vector-font">
      <span className="control__label">{label}</span>
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger className="vector-font__trigger" aria-label={`${label}: ${value}`}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault(); event.stopPropagation()
            if (!open) changeOpen(true)
            move(event.key === 'ArrowDown' ? 1 : -1)
          }}>
          <span style={{ fontFamily: `'${value}', ui-sans-serif, sans-serif` }}>{value}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover vector-font__popover" sideOffset={8} align="end" aria-label="Fonts">
            <input
              className="vector-palette__input"
              value={query}
              placeholder="Search fonts"
              spellCheck={false}
              autoComplete="off"
              aria-label="Search fonts"
              role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={active >= start && active < end ? `${listId}-${active}` : undefined}
              onChange={(event) => { setQuery(event.target.value); setActive(-1); setScroll(0); if (list.current) list.current.scrollTop = 0 }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && rows[active]?.kind === 'font') {
                  event.preventDefault(); event.stopPropagation(); const row = rows[active]; onPick(row.family, row.source); changeOpen(false)
                }
                if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
                event.preventDefault(); event.stopPropagation()
                move(event.key === 'ArrowDown' ? 1 : -1)
              }}
            />
            <div
              ref={list}
              id={listId}
              className="vector-font__list"
              role="listbox"
              aria-label="Fonts"
              style={{ height: ROW_HEIGHT * VIEWPORT_ROWS }}
              onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
            >
              <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
                {visible.map((row, index) => (
                  <div key={row.key} className="vector-font__row" style={{ position: 'absolute', top: (start + index) * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}>
                    {row.kind === 'heading' ? (
                      <span className="vector-font__heading">{row.label}</span>
                    ) : (
                      <button
                        type="button"
                        id={`${listId}-${start + index}`}
                        tabIndex={-1}
                        data-active={start + index === active || undefined}
                        role="option"
                        aria-selected={row.family === value}
                        data-selected={row.family === value || undefined}
                        className="vector-font__option"
                        onClick={() => { onPick(row.family, row.source); changeOpen(false) }}
                      >
                        <span className="vector-font__name" style={{ fontFamily: `'${row.family}', ui-sans-serif, sans-serif` }}>{row.family}</span>
                        <span className="vector-font__note">{row.note}</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {rows.length === 0 ? <p className="vector-empty">No fonts match “{query}”. Try another name</p> : null}
            {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
            <div className="vector-font__actions">
              <Button variant="quiet" size="sm" data-action="import-font" onClick={() => fileInput.current?.click()}>Import font file…</Button>
              <span className="vector-font__hint">.woff2, .ttf or .otf, up to {Math.round(MAX_FONT_BYTES / 1024)} KB</span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".woff2,.ttf,.otf,font/woff2,font/ttf,font/otf"
              className="visually-hidden"
              tabIndex={-1}
              onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
