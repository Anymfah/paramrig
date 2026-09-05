import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSceneDocument, sceneCounts } from '@/scene/document'
import { SceneStatusBar } from '@/scene/SceneStatusBar'
import { EMPTY_SELECTION } from '@/scene/types'

function bar(props: { message?: string | null; alert?: string | null } = {}) {
  const document = createSceneDocument()
  return render(
    <SceneStatusBar
      document={document}
      selection={EMPTY_SELECTION}
      counts={sceneCounts(document)}
      message={props.message ?? null}
      alert={props.alert ?? null}
    />,
  )
}

/**
 * A scene bigger than browser storage stops being saved, and until this the editor said nothing:
 * the refusal was computed, handed back, and never rendered anywhere in the 3D editor.
 */
describe('the line along the bottom', () => {
  it('says nothing when there is nothing wrong', () => {
    bar({ message: 'Extruded 4 faces' })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Extruded 4 faces')).toBeTruthy()
  })

  it('carries a storage failure, and announces it', () => {
    bar({ alert: 'Browser storage is full. Save this project to a file to keep your changes.' })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Browser storage is full')
    // The way out is the half of the sentence that matters, so it has to be there too.
    expect(alert.textContent).toContain('Save this project to a file')
  })

  it('stands the gesture hints down, so the whole sentence fits', () => {
    const { container } = bar({ alert: 'Browser storage is full. Save this project to a file to keep your changes.' })

    expect(container.querySelector('.scene-status__hints')).toBeNull()
    // Measured in the browser: with them up the sentence ellipsised at "Browser storage is fu…",
    // which loses the half that says what to do.
    expect(screen.getByRole('alert').textContent).toContain('to keep your changes')
  })

  it('keeps saying it while the operators come and go', () => {
    const { rerender } = bar({ alert: 'Browser storage is full.', message: 'Extruded 4 faces' })
    const document = createSceneDocument()
    rerender(
      <SceneStatusBar
        document={document}
        selection={EMPTY_SELECTION}
        counts={sceneCounts(document)}
        message="Merged 8 vertices"
        alert="Browser storage is full."
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe('Browser storage is full.')
    expect(screen.getByText('Merged 8 vertices')).toBeTruthy()
  })
})
