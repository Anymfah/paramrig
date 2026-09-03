import { useSyncExternalStore } from 'react'
import { EditorChip } from '@/editor/EditorChip'
import type { HudChannel } from '@/scene/viewport/hud'

/**
 * The transform readout, and the line of keys a modal tool offers.
 *
 * This is the only component that re-renders while a drag is running, and it renders one chip and
 * one sentence. It sits 24 pixels from the pointer on whichever side has room, so it never covers
 * the thing being moved, and it disappears the moment the gesture ends.
 */
export function SceneHud({ channel }: { channel: HudChannel }) {
  const state = useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot)
  if (!state.visible) return null
  return (
    <>
      <EditorChip
        className="scene-hud"
        role="status"
        live="polite"
        style={{
          left: state.side === 'right' ? state.x + 24 : undefined,
          right: state.side === 'left' ? undefined : undefined,
          top: state.y + 24,
          transform: state.side === 'left' ? 'translateX(calc(-100% - 48px))' : undefined,
        }}
      >
        {state.text}
      </EditorChip>
      {state.header ? <p className="scene-modal-header">{state.header}</p> : null}
    </>
  )
}
