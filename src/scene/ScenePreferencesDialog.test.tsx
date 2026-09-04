import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '@/scene/prefs'
import { ScenePreferencesDialog } from '@/scene/ScenePreferencesDialog'

/**
 * The preferences dialog is a form over one object, so what is worth testing is the wiring: that a
 * control reports the setting it names, and that the keymap section is the keymap rather than a
 * copy of it.
 */

function show(patch: Partial<typeof DEFAULT_PREFERENCES> = {}) {
  const onChange = vi.fn()
  render(
    <ScenePreferencesDialog
      open
      onClose={vi.fn()}
      preferences={{ ...DEFAULT_PREFERENCES, ...patch }}
      onChange={onChange}
    />,
  )
  return onChange
}

describe('Edit · Preferences', () => {
  it('opens on Navigation and offers every section', () => {
    show()
    for (const name of ['Navigation', 'Input', 'Editing', 'Interface', 'Themes', 'Keymap']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy()
    }
    expect(screen.getByRole('tab', { name: 'Navigation' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Orbit around selection')).toBeTruthy()
  })

  it('reports the setting a control names', async () => {
    const onChange = show()
    await userEvent.click(screen.getByRole('switch', { name: 'Zoom to mouse position' }))
    expect(onChange).toHaveBeenCalledWith({ zoomToMouse: false })
  })

  it('offers the selection palette and the default matcap', async () => {
    show({ theme: 'high-contrast' })
    await userEvent.click(screen.getByRole('tab', { name: 'Themes' }))
    // Three long labels are past the segmented control's limit, so both of these are selects.
    expect(screen.getByRole('combobox', { name: 'Selection colours' }).textContent).toContain('High contrast')
    expect(screen.getByRole('combobox', { name: 'Default matcap' })).toBeTruthy()
  })

  it('changes the orbit method, which is a choice of two', async () => {
    const onChange = show()
    await userEvent.click(screen.getByRole('radio', { name: 'Trackball' }))
    expect(onChange).toHaveBeenCalledWith({ orbitStyle: 'trackball' })
  })

  it('says what the space bar does', async () => {
    const onChange = show()
    await userEvent.click(screen.getByRole('tab', { name: 'Keymap' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Search' }))
    expect(onChange).toHaveBeenCalledWith({ spacebarAction: 'search' })
  })

  it('shows the keymap and searches it', async () => {
    show()
    await userEvent.click(screen.getByRole('tab', { name: 'Keymap' }))
    // Twice over: the numpad's dot and Home both frame the selection.
    expect(screen.getAllByText('Frame selected').length).toBeGreaterThan(0)
    await userEvent.type(screen.getByLabelText('Search the keymap'), 'extrude')
    expect(screen.queryByText('Frame selected')).toBeNull()
    expect(screen.getAllByText(/Extrude/).length).toBeGreaterThan(0)
    await userEvent.type(screen.getByLabelText('Search the keymap'), 'zzz')
    expect(screen.getByText('No shortcut matches that.')).toBeTruthy()
  })

  it('leaves out the chords a preference has turned off', async () => {
    show({ numpadEmulation: false })
    await userEvent.click(screen.getByRole('tab', { name: 'Keymap' }))
    const panel = screen.getByRole('tabpanel', { name: 'Keymap' })
    // With the emulation off there is no plain `1` for the front view: only the numpad's own.
    expect(within(panel).queryByText('Front view')).toBeTruthy()
    expect(within(panel).getAllByText('Front view')).toHaveLength(1)
  })
})
