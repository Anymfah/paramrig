import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import { SceneRedoPanel } from '@/scene/SceneRedoPanel'

/*
 * The panel draws whatever the operator declares, so the case is an operator with one of each kind
 * of field. The registry is per module graph, and vitest gives this file its own, so registering
 * here cannot collide with the families the editor loads.
 */
registerOperator({
  id: 'test.bevel',
  label: 'Bevel',
  section: 'Mesh',
  params: [
    numberParam('width', 'Width', { min: 0, max: 2, step: 0.01, defaultValue: 0.1, unit: 'm' }),
    numberParam('segments', 'Segments', { min: 1, max: 32, step: 1, defaultValue: 1 }),
    switchParam('clamp', 'Clamp overlap', true),
  ],
  defaults: { width: 0.1, segments: 1, clamp: true },
  available: () => true,
  run: () => ({}),
})

registerOperator({
  id: 'test.selectAll',
  label: 'Select all',
  section: 'Select',
  params: [],
  defaults: {},
  available: () => true,
  run: () => ({}),
})

type PanelProps = ComponentProps<typeof SceneRedoPanel>

const BEVEL = { operatorId: 'test.bevel', label: 'Bevel', params: { width: 0.1, segments: 1, clamp: true } }

function setup(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    operation: BEVEL,
    expanded: false,
    onExpanded: vi.fn(),
    onAdjust: vi.fn(),
    ...overrides,
  }
  const view = render(<SceneRedoPanel {...props} />)
  return { ...view, props }
}

afterEach(cleanup)

describe('SceneRedoPanel', () => {
  it('shows nothing at all when nothing has been done', () => {
    const { container } = setup({ operation: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('is one line carrying the name of the operation while it is folded', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Bevel' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Width' })).not.toBeInTheDocument()
  })

  it('asks to be unfolded when the line is clicked', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Bevel' }))
    expect(props.onExpanded).toHaveBeenCalledWith(true)
  })

  it('unfolded, it renders one field per declared parameter', () => {
    setup({ expanded: true })
    expect(screen.getByRole('textbox', { name: 'Width' })).toHaveValue('0.10')
    expect(screen.getByRole('textbox', { name: 'Segments' })).toHaveValue('1')
    expect(screen.getByRole('switch', { name: 'Clamp overlap' })).toBeInTheDocument()
  })

  it('hands back the whole parameter object with the changed value in it', () => {
    const { props } = setup({ expanded: true })
    const width = screen.getByRole('textbox', { name: 'Width' })
    fireEvent.change(width, { target: { value: '0.4' } })
    fireEvent.blur(width)
    expect(props.onAdjust).toHaveBeenCalledWith({ width: 0.4, segments: 1, clamp: true })
  })

  it('carries a switch back the same way, the other parameters untouched', () => {
    const { props } = setup({ expanded: true })
    fireEvent.click(screen.getByRole('switch', { name: 'Clamp overlap' }))
    expect(props.onAdjust).toHaveBeenCalledWith({ width: 0.1, segments: 1, clamp: false })
  })

  it('falls back to the schema default for a parameter the operation did not record', () => {
    const { props } = setup({ expanded: true, operation: { ...BEVEL, params: { width: 0.5 } } })
    expect(screen.getByRole('textbox', { name: 'Segments' })).toHaveValue('1')
    fireEvent.click(screen.getByRole('switch', { name: 'Clamp overlap' }))
    expect(props.onAdjust).toHaveBeenCalledWith({ width: 0.5, clamp: false })
  })

  it('says so rather than showing an empty box when the operation has no settings', () => {
    setup({ expanded: true, operation: { operatorId: 'test.selectAll', label: 'Select all', params: {} } })
    expect(screen.getByText('This operation has no settings.')).toBeInTheDocument()
  })

  it('refuses in words when the operation is not in this build', () => {
    setup({ expanded: true, operation: { operatorId: 'test.missing', label: 'Something else', params: {} } })
    expect(screen.getByText(/not in this build/)).toBeInTheDocument()
  })
})
