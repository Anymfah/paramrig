import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AudioRigsPage } from '@/docs/AudioRigsPage'
import { AUDIO_PROPERTY_PATHS, parseAudioProperty } from '@/audio/rig'

/**
 * The page is generated from the synthesiser's own field tables, so what it needs testing for is
 * not its prose: it is that the table is the truth. A row nobody can bind is a row that sends
 * whoever is reading — a person or a model — to write a file the app will refuse.
 */

const open = () => render(<MemoryRouter><AudioRigsPage /></MemoryRouter>)

/** A documented path is written with an `i` where an index goes; a real one carries a number. */
const real = (property: string) => property.replace(/\[i\]/g, '[0]')

describe('the audio rigs page', () => {
  it('publishes a row for every path, and every one of them parses', () => {
    open()
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    // One row a path, plus the head.
    expect(rows).toHaveLength(AUDIO_PROPERTY_PATHS.length + 1)
    for (const { property } of AUDIO_PROPERTY_PATHS) {
      expect(parseAudioProperty(real(property)), property).not.toBeNull()
    }
  })

  it('carries an example whose every binding names a path that exists', () => {
    open()
    const example = screen.getByText(/"format": "paramrig.audio"/)
    const file = JSON.parse(example.textContent ?? '{}') as {
      document: { rig: { bindings: { property: string; parameterId: string }[]; parameters: { id: string }[] } }
    }
    const named = new Set(file.document.rig.parameters.map((one) => one.id))
    for (const binding of file.document.rig.bindings) {
      expect(parseAudioProperty(binding.property), binding.property).not.toBeNull()
      expect(named.has(binding.parameterId), binding.parameterId).toBe(true)
    }
  })

  it('says how to reach the other three pages, since a reader arrives on one of the four', () => {
    open()
    for (const name of ['Vector rigs', 'Scene rigs', 'Live controller catalog']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
  })
})
