import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { EditorChip } from '@/editor/EditorChip'
import { dismissHint, HINT_TEXT, readHintState, shouldShowHint, writeHintState } from '@/scene/hints'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import { IconButton } from '@/ui/Button'
import { IconClose } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The two affordances a viewport cannot draw for itself: the line of gestures a newcomer is given
 * once, and the pointer to the keymap that stays behind after it.
 *
 * The chip leaves at the first real action rather than after a countdown, because a hint that
 * vanishes while somebody is still reading it teaches nothing, and one that outstays a person who
 * is plainly already working is in the way. Pressing anything is proof of both.
 */

/** How long the chip takes to leave. The stylesheet is handed it, so the two cannot disagree. */
const FADE_MS = 200

type Phase = 'showing' | 'leaving' | 'gone'

export function SceneHints({ onDismiss }: { onDismiss?: () => void }) {
  const [phase, setPhase] = useState<Phase>(() => (shouldShowHint(readHintState()) ? 'showing' : 'gone'))
  const dismissed = useRef(false)
  const notify = useRef(onDismiss)
  notify.current = onDismiss

  /* The sighting is recorded the moment the chip is on screen, so a person who reads it and walks
   * away is told apart from one who has never opened the editor at all. */
  useEffect(() => {
    if (phase !== 'showing') return
    const state = readHintState()
    if (state.seenAt !== null) return
    writeHintState({ ...state, seenAt: new Date().toISOString() })
  }, [phase])

  const dismiss = useCallback(() => {
    if (dismissed.current) return
    dismissed.current = true
    writeHintState(dismissHint(readHintState()))
    notify.current?.()
    setPhase('leaving')
  }, [])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(() => setPhase('gone'), FADE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  /*
   * The editor has one viewport surface and the chip is not inside it, so the surface is found by
   * its class rather than handed over as a ref. Only a press counts: there is deliberately no
   * `pointermove` listener, because a pointer crossing the viewport on its way somewhere else is
   * not somebody who has started work.
   */
  useEffect(() => {
    if (phase !== 'showing') return
    const surface = document.querySelector('.scene-surface')
    const leave = () => dismiss()
    window.addEventListener('keydown', leave)
    surface?.addEventListener('pointerdown', leave)
    return () => {
      window.removeEventListener('keydown', leave)
      surface?.removeEventListener('pointerdown', leave)
    }
  }, [dismiss, phase])

  if (phase === 'gone') return null

  return (
    <EditorChip
      className="scene-hints"
      role="status"
      live="polite"
      style={{ '--scene-hint-fade': `${FADE_MS}ms` } as CSSProperties}
      dataset={{ leaving: phase === 'leaving' ? '' : undefined }}
    >
      <span className="scene-hints__text">{HINT_TEXT}</span>
      <Tooltip content="Dismiss the hint">
        <IconButton label="Dismiss the hint" className="scene-hints__close" onClick={dismiss}>
          <IconClose />
        </IconButton>
      </Tooltip>
    </EditorChip>
  )
}

/**
 * What is left once the chip has gone: one line saying where the rest of the keys are.
 *
 * It is a button and not a sentence with a key drawn in it, because the sheet has to be reachable
 * by somebody who never learnt the shortcut it names. The key comes from the keymap itself, so a
 * rebinding cannot leave the line pointing at a key the editor no longer answers to.
 */
export function SceneKeymapHint({ onOpen }: { onOpen: () => void }) {
  const binding = bindingFor('keymapSheet')
  const key = binding ? shortcutLabel(binding) : 'F1'
  return (
    <Tooltip content={`Keyboard shortcuts · ${key}`}>
      <button type="button" className="scene-hints__keymap" onClick={onOpen}>
        Press <kbd>{key}</kbd> for the keys
      </button>
    </Tooltip>
  )
}
