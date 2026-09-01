import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContextMenuRoot, ContextTarget } from '@/ui/ContextMenu'

describe('ContextMenu', () => {
  it.each(['touch', 'keyboard'])('opens actions using the %s alternative', async (mode) => {
    const onReset = vi.fn()
    render(<ContextMenuRoot><ContextTarget label="Seed actions" items={[{ label: 'Reset Seed', onSelect: onReset }]}>
      <input aria-label="Seed" defaultValue="10" />
    </ContextTarget></ContextMenuRoot>)
    if (mode === 'touch') fireEvent.click(screen.getByRole('button', { name: 'Seed actions' }))
    else fireEvent.keyDown(screen.getByRole('textbox', { name: 'Seed' }), { key: 'F10', shiftKey: true })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reset Seed' }))
    expect(onReset).toHaveBeenCalledOnce()
  })
  it('opens reset options on right-click', async () => {
    const onReset = vi.fn()
    render(
      <ContextMenuRoot>
        <ContextTarget items={[{ label: 'Reset Amplitude', onSelect: onReset }]}>
          <button type="button">Amplitude</button>
        </ContextTarget>
      </ContextMenuRoot>,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Amplitude' }))
    const item = await screen.findByRole('menuitem', { name: 'Reset Amplitude' })
    fireEvent.click(item)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
  it('closes a controller panel with one Escape press', async () => {
    render(<ContextMenuRoot><ContextTarget label="Amplitude actions" items={[]} controller={<input aria-label="Amplitude" defaultValue="40" />}>
      <button type="button">Amplitude</button>
    </ContextTarget></ContextMenuRoot>)
    fireEvent.contextMenu(screen.getByRole('button',{name:'Amplitude'}))
    const input=await screen.findByRole('textbox',{name:'Amplitude'})
    fireEvent.keyDown(input,{key:'Escape'})
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Amplitude actions'})).not.toBeInTheDocument())
  })
})
