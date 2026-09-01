import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectField } from '@/ui/SelectField'

const two = [
  { value: 'fill', label: 'Fill' },
  { value: 'stroke', label: 'Stroke' },
]

describe('SelectField', () => {
  it('uses a segmented radio group for short option lists', () => {
    const onChange = vi.fn()
    render(<SelectField label="Draw" value="fill" options={two} onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'Draw' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Stroke' }))
    expect(onChange).toHaveBeenCalledWith('stroke')
  })

  it('keeps a listbox when there are more than four options', () => {
    const options = ['a', 'b', 'c', 'd', 'e'].map((value) => ({ value, label: value.toUpperCase() }))
    render(<SelectField label="Mode" value="a" options={options} onChange={() => undefined} />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeInTheDocument()
  })
})
