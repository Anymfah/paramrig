import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { APERTURE_MARK_ID } from '@/rigs/examples/aperture-mark'
import { RigSession } from '@/state/session'
import { getRig } from '@/rigs/registry'
import { VectorRigPreview } from '@/renderers/vector/VectorRigPreview'

describe('the vector renderer in the workbench', () => {
  it('draws the document as a session says', () => {
    const session = new RigSession(getRig(APERTURE_MARK_ID)!)
    session.setValue('ink', '#FF0000')
    render(<VectorRigPreview documentId={APERTURE_MARK_ID} values={session.previewValues()} name="Aperture mark" />)
    const svg = screen.getByRole('img', { name: 'Aperture mark preview' })
    expect(svg.innerHTML).toContain('#FF0000')
    expect(svg.getAttribute('viewBox')).toBe('0 0 400 400')
  })

  it('says so plainly when the document is not in this browser', () => {
    render(<VectorRigPreview documentId="vector-nowhere" values={{}} name="Gone" />)
    expect(screen.getByText(/not in this browser/)).toBeInTheDocument()
  })
})
