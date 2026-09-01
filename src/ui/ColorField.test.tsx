import { render, screen } from '@testing-library/react'
import { ColorField } from '@/ui/ColorField'

describe('ColorField', () => {
  it('puts the field label inside the color chip', () => {
    render(<ColorField label="Color 1" value="#4A7C59" onChange={() => undefined} />)
    const chip = document.querySelector('.color-field')
    expect(chip?.querySelector('.color-field__label')).toHaveTextContent('Color 1')
    expect(screen.getByLabelText('Color 1')).toBeInstanceOf(HTMLInputElement)
    expect(document.querySelector('.control__label')).toBeNull()
  })
})
