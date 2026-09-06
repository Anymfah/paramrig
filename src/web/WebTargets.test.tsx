import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WebTarget } from './contracts'
import { NoControls, TargetStatus } from './WebTargets'

const target = (key: string, label: string, controls: number): WebTarget => ({
  key, label, controls, tag: 'div', pageId: 'home', selector: 'div', fingerprint: 'div',
  rect: { x: 0, y: 0, width: 10, height: 10 }, ancestors: [], status: 'resolved', stable: { id: key },
})

describe('an element that carries no control of its own', () => {
  it('says so, then says where the controls are', () => {
    const pick = vi.fn()
    render(<NoControls ancestors={[target('hero', 'Hero title', 2)]} page={[target('card', 'Story card', 1)]} onPick={pick} />)
    expect(screen.getByText('No controls on this element.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hero title 2 controls' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Story card 1 control' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Story card 1 control' }))
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ key: 'card' }))
  })

  it('tells repeated components apart by the instance they were given', () => {
    const card = (instance: string) => ({ ...target(`card-${instance}`, 'Story card', 1), stable: { id: 'story-card', instance } })
    render(<NoControls ancestors={[]} page={[card('coast'), card('forest')]} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Story card · coast 1 control' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Story card · forest 1 control' })).toBeInTheDocument()
  })

  it('leaves out a list it has nothing to put in', () => {
    render(<NoControls ancestors={[]} page={[]} onPick={() => {}} />)
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByText('On this page')).toBeNull()
  })
})

describe('a target that is not simply there', () => {
  it('says what is wrong in words rather than in contract values', () => {
    const { container, rerender } = render(<TargetStatus status="provisional" />)
    expect(container.textContent).toBe('Not instrumented')
    rerender(<TargetStatus status="missing" />)
    expect(container.textContent).toBe('Missing on this page')
    rerender(<TargetStatus status="ambiguous" />)
    expect(container.textContent).toBe('Several matches')
    rerender(<TargetStatus status="resolved" />)
    expect(container.textContent).toBe('')
  })
})
