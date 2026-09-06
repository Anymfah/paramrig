import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest } from './contracts'
import { selectionControls } from './selection'
import { WebSession } from './session'
import { WebControls } from './WebControls'
import type { ScopedControl } from './WebControls'

const manifest = parseManifest(example)
const session = () => new WebSession(manifest)
const controls = (scopes: Record<string, string>): ScopedControl[] =>
  Object.entries(scopes).map(([id, scope]) => ({ param: manifest.parameters.find(p => p.id === id)!, scope }))

const titles = () => screen.getAllByRole('button', { expanded: true }).map(button => button.textContent)

describe('how far a section of controls reaches', () => {
  it('is not repeated on every section when every section reaches the same way', () => {
    render(<WebControls session={session()} disabled={false} controls={controls({ accent: 'Global', paper: 'Global', 'content-width': 'Global' })} />)
    expect(titles()).toEqual(['Identity', 'Page rhythm'])
    expect(screen.queryByText('Global')).toBeNull()
  })

  it('is a badge beside the group name when the sections differ', () => {
    render(<WebControls session={session()} disabled={false} controls={controls({ accent: 'Global', 'hero-size': 'All instances' })} />)
    expect(screen.getByText('Identity')).toBeInTheDocument()
    expect(screen.getByText('Selected element')).toBeInTheDocument()
    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByText('All instances')).toBeInTheDocument()
  })

  it('never repeats the group name as its own badge', () => {
    render(<WebControls session={session()} disabled={false} controls={controls({ accent: 'Global', 'hero-size': 'Selected element' })} />)
    expect(screen.getAllByText('Selected element')).toHaveLength(1)
  })

  it('warns a lone section that it reaches every instance of a repeated component', () => {
    const card = { key: 'card', label: 'Story card', tag: 'article', stable: { id: 'story-card', instance: 'coast' }, pageId: 'home', selector: 'article', fingerprint: 'article', rect: { x: 0, y: 0, width: 10, height: 10 }, ancestors: [], status: 'resolved' as const }
    render(<WebControls session={session()} disabled={false} controls={selectionControls(manifest, [card], 'home')} />)
    expect(titles()).toEqual(['Selected elementAll instances'])
    expect(screen.getByText('All instances')).toBeInTheDocument()
  })
})
