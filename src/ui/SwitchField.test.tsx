import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SwitchField } from '@/ui/SwitchField'

describe('SwitchField', () => {
  it('toggles from a click on the label row', () => {
    const onChange = vi.fn()
    render(<SwitchField label="Grain" checked={true} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Grain' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
