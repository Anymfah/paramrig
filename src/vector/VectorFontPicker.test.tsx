import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VectorFontPicker } from './VectorFontPicker'
import type { VectorFont } from './types'

afterEach(cleanup)

function Picker({ initial = 'Public Sans' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const [fonts, setFonts] = useState<VectorFont[]>([])
  return <VectorFontPicker label="Headline font" value={value} fonts={fonts} onImport={() => {}}
    onPick={(family, source) => {
      setValue(family)
      if (source === 'google') setFonts(current => [...current.filter(font => font.family !== family), { family, source, weights: [400] }])
    }} />
}

describe('font picker keyboard browsing', () => {
  it('opens from the trigger and applies successive fonts without closing', () => {
    render(<Picker />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Headline font: Public Sans' }), { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Headline font: Space Grotesk' })).toBeInTheDocument()
    const search = screen.getByRole('combobox', { name: 'Search fonts' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Headline font: Source Serif 4' })).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Headline font: Space Grotesk' })).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('uses the last filtered result for Up when nothing is selected', () => {
    const onPick = vi.fn()
    render(<VectorFontPicker value="Public Sans" fonts={[]} onPick={onPick} onImport={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Font: Public Sans' }))
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'serif' } })
    const options = screen.getAllByRole('option')
    const lastFamily = options.at(-1)!.querySelector('.vector-font__name')!.textContent
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(onPick).toHaveBeenLastCalledWith(lastFamily, expect.any(String))
    expect(document.getElementById(search.getAttribute('aria-activedescendant')!)?.textContent).toContain(lastFamily)
  })

  it('keeps the browsing order when chosen Google fonts join the document', () => {
    render(<Picker initial="Menlo" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Headline font: Menlo' }), { key: 'ArrowDown' })
    const search = screen.getByRole('combobox')
    const first = screen.getByRole('button', { name: /^Headline font:/ }).textContent
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: /^Headline font:/ }).textContent).not.toBe(first)
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: /^Headline font:/ }).textContent).toBe(first)
  })

  it('does not consume composition arrows or leak browsing keys to the editor', () => {
    const parent = vi.fn(), pick = vi.fn()
    render(<div onKeyDown={parent}><VectorFontPicker value="Public Sans" fonts={[]} onPick={pick} onImport={() => {}} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Font: Public Sans' }))
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown', isComposing: true })
    expect(pick).not.toHaveBeenCalled()
    parent.mockClear()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    expect(pick).toHaveBeenCalledOnce()
    expect(parent).not.toHaveBeenCalled()
  })
})
