import { beforeAll } from 'vitest'
import { loadModule } from '@/modules/registry'
beforeAll(async () => { await loadModule('vector') })
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('consumes pinch in the workspace, preserves the view while tuning and can fit again', () => {
    const values = new RigSession(getRig(APERTURE_MARK_ID)!).previewValues()
    const view = render(<VectorRigPreview documentId={APERTURE_MARK_ID} values={values} name="Aperture mark" />)
    const region = screen.getByRole('region', { name: 'Vector workspace' })
    const transform = () => region.querySelector('[data-preview-camera]')!.getAttribute('transform')
    const initial = transform()
    const wheel = new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true })
    fireEvent(region, wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(transform()).not.toBe(initial)
    const zoomed = transform()
    view.rerender(<VectorRigPreview documentId={APERTURE_MARK_ID} values={{ ...values, ink: '#FF0000' }} name="Aperture mark" />)
    expect(transform()).toBe(zoomed)
    fireEvent.click(screen.getByRole('button', { name: 'Fit all pages' }))
    expect(transform()).toBe(initial)
    fireEvent(region, new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }))
    expect(transform()).not.toBe(initial)
    fireEvent.keyDown(region, { key: 'Home' })
    expect(transform()).toBe(initial)
  })

  it('handles WebKit gesture events without allowing browser zoom', () => {
    render(<VectorRigPreview documentId={APERTURE_MARK_ID} values={{}} name="Aperture mark" />)
    const region = screen.getByRole('region', { name: 'Vector workspace' })
    const gesture = (type: string, scale = 1) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { scale, clientX: 0, clientY: 0 })
      fireEvent(region, event)
      expect(event.defaultPrevented).toBe(true)
    }
    gesture('gesturestart')
    gesture('gesturechange', 2)
    gesture('gesturechange', 3)
    gesture('gestureend', 3)
    expect(region.querySelector('[data-preview-camera]')!.getAttribute('transform')).toContain('scale(3)')
  })
})
