import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ControlsPage } from '@/docs/ControlsPage'
import { DocsChrome } from '@/docs/DocsChrome'
import { controllerCategories, controllerDefinitions, controllerExamples } from '@/rigs/controller-catalog'

/*
 * The catalogue's family and search live in the URL.
 *
 * paramrig.com lists every controller and links each family to the cards it
 * names, which only works while `?family=` is read. A link that silently falls
 * back to Numbers looks like a working link, so the fallback is asserted too.
 */
const open = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/docs/controls${search}`]}>
      <ControlsPage />
    </MemoryRouter>,
  )

const cards = () => screen.getAllByRole('article').length

describe('the controller catalogue reads its filter from the URL', () => {
  it('shows the examples rather than every declaration', () => {
    // One definition is hidden, so the catalogue shows 66 of 67. The site says 66.
    expect(controllerExamples.length).toBe(controllerDefinitions.length - 1)
    expect(controllerExamples.length).toBe(66)
  })

  it('opens the family a link asks for', () => {
    const curves = controllerExamples.filter((entry) => entry.group === 'curves').length
    open('?family=curves')
    expect(cards()).toBe(curves)
  })

  it('opens every controller when the family is all', () => {
    open('?family=all')
    expect(cards()).toBe(controllerExamples.length)
  })

  it('applies a search, across every family', () => {
    open('?family=all&q=knob')
    expect(cards()).toBe(controllerExamples.filter((entry) => /knob/i.test(entry.label)).length)
  })

  it('falls back to Numbers rather than showing nothing for a family that does not exist', () => {
    const numbers = controllerExamples.filter((entry) => entry.group === 'numbers').length
    open('?family=bogus')
    expect(cards()).toBe(numbers)
  })

  it('drops the workbench shell when the site embeds the page', () => {
    // The site frames this page; its own header and navigation are already around
    // the frame. A rail inside it repeats them and eats a quarter of the width.
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/controls?family=all&embed=1']}>
        <DocsChrome><ControlsPage /></DocsChrome>
      </MemoryRouter>,
    )
    expect(container.querySelector('.nav-rail')).toBeNull()
    expect(container.querySelector('.shell')?.getAttribute('data-nav')).toBe('off')
    expect(screen.getAllByRole('article').length).toBe(controllerExamples.length)
  })

  it('names every family the site can link to', () => {
    // The site's slugs are these ids; a rename here breaks a link there.
    expect(controllerCategories.map((category) => category.id)).toEqual([
      'numbers', 'spatial', 'appearance', 'choices', 'type', 'curves',
      'resources', 'instruments', 'actions', 'collections', 'motion',
    ])
  })
})
