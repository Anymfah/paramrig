import { useSyncExternalStore } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GradientField } from '@/ui/GradientField'
import { RigSession } from '@/state/session'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import type { GradientStop } from '@/rigs/types'

function Editor({ session }: { session: RigSession }) {
  useSyncExternalStore(session.subscribe, () => session.getRevision())
  return <GradientField label="Palette" value={session.storedValue('terrainPalette') as GradientStop[]}
    onChange={value => session.setValue('terrainPalette', value)}
    onGestureStart={() => session.beginGesture('Move color stop')}
    onGestureEnd={() => session.endGesture()}
    onGestureCancel={() => session.cancelGesture()} />
}

describe('gradient stop transactions', () => {
  it('moves an unselected stop, commits outside it and undoes in one step', () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    const bar = screen.getByRole('group', { name: 'Palette color stops' })
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Select stop 4 at 42 percent' }), { button: 0, pointerId: 1, clientX: 84 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect((session.storedValue('terrainPalette') as GradientStop[])[3]!.t).toBe(0.6)
    expect(session.isGesturing()).toBe(false)
    expect(session.history().labels).toEqual(['Session start', 'Move color stop'])
    act(() => session.undo())
    expect((session.storedValue('terrainPalette') as GradientStop[])[3]!.t).toBe(0.42)
  })

  it('inserts a stop where the bar is clicked', () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    const bar = screen.getByRole('group', { name: 'Palette color stops' })
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200, top: 0, height: 24 } as DOMRect)
    fireEvent.pointerDown(bar, { button: 0, clientX: 50, clientY: 12 })
    fireEvent.pointerUp(bar, { button: 0, clientX: 50, clientY: 12 })
    expect((session.storedValue('terrainPalette') as GradientStop[]).map((stop) => stop.t)).toEqual([0, 0.1, 0.13, 0.25, 0.42, 0.72, 1])
  })
})
