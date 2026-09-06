import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { tooltipDelay } from '@/ui/tooltipDelay'
import { createPortal } from 'react-dom'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

type TooltipProps = {
  content: ReactNode
  children: ReactNode
  side?: TooltipSide
  instant?: boolean
  block?: boolean
  disabled?: boolean
}

const GAP = 8
const VIEWPORT_PAD = 8
const ARROW_INSET = 14
const FOLLOW_DELAY = 60
const GROUP_IDLE = 300
const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const SIDES: readonly TooltipSide[] = ['top', 'bottom', 'right', 'left']
const FOCUSABLE = 'button, [href], input, textarea, [tabindex], [role="button"], [role="combobox"], [role="slider"]'

let groupWarmUntil = 0
const groupIsWarm = () => Date.now() < groupWarmUntil
const warmGroup = () => {
  groupWarmUntil = Number.POSITIVE_INFINITY
}
const coolGroup = () => {
  groupWarmUntil = Date.now() + GROUP_IDLE
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/*
 * Focus handed back by a closing overlay is not a request for a tooltip.
 *
 * Escape closes a popover or a menu, the browser returns focus to the trigger, and the trigger is
 * `:focus-visible` because the gesture was a key — so the tooltip opened over the very control the
 * person had just dismissed something from. Only a focus that arrives without a recent Escape is
 * treated as a keyboard arrival.
 */
const ESCAPE_GRACE = 400
let escapedAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') escapedAt = Date.now() }, true)
}

type Coords = { top: number; left: number; side: TooltipSide; arrow: number }

export function Tooltip({ content, children, side = 'top', instant = false, block = false, disabled = false }: TooltipProps) {
  const id = `${useId()}-tip`
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)
  const [mounted, setMounted] = useState(false)
  const off = disabled || content === null || content === undefined || content === ''

  useEffect(() => setMounted(true), [])

  const cancel = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }, [])

  const hide = useCallback(() => {
    cancel()
    if (openRef.current) coolGroup()
    openRef.current = false
    setOpen(false)
    setCoords(null)
  }, [cancel])

  const show = useCallback(
    (delay: number) => {
      cancel()
      timer.current = setTimeout(() => {
        warmGroup()
        openRef.current = true
        setOpen(true)
      }, delay)
    },
    [cancel],
  )

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
      if (openRef.current) coolGroup()
      openRef.current = false
    },
    [],
  )

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const tip = tipRef.current
    if (!anchor || !tip) return
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const a = anchor.getBoundingClientRect()
    if (a.bottom < 0 || a.top > vh || a.right < 0 || a.left > vw) {
      hide()
      return
    }
    const t = tip.getBoundingClientRect()
    const room: Record<TooltipSide, number> = {
      top: a.top - VIEWPORT_PAD,
      bottom: vh - a.bottom - VIEWPORT_PAD,
      left: a.left - VIEWPORT_PAD,
      right: vw - a.right - VIEWPORT_PAD,
    }
    const need = (s: TooltipSide) => (s === 'top' || s === 'bottom' ? t.height : t.width) + GAP
    const order: TooltipSide[] = [side, OPPOSITE[side], ...SIDES]
    const resolved =
      order.find((s) => room[s] >= need(s)) ??
      SIDES.reduce((best, s) => (room[s] - need(s) > room[best] - need(best) ? s : best), side)
    const vertical = resolved === 'top' || resolved === 'bottom'
    const rawTop = vertical
      ? resolved === 'top'
        ? a.top - t.height - GAP
        : a.bottom + GAP
      : a.top + a.height / 2 - t.height / 2
    const rawLeft = vertical
      ? a.left + a.width / 2 - t.width / 2
      : resolved === 'left'
        ? a.left - t.width - GAP
        : a.right + GAP
    const top = clamp(rawTop, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vh - t.height - VIEWPORT_PAD))
    const left = clamp(rawLeft, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vw - t.width - VIEWPORT_PAD))
    const arrow = vertical
      ? clamp(a.left + a.width / 2 - left, ARROW_INSET, Math.max(ARROW_INSET, t.width - ARROW_INSET))
      : clamp(a.top + a.height / 2 - top, ARROW_INSET, Math.max(ARROW_INSET, t.height - ARROW_INSET))
    setCoords({ top, left, side: resolved, arrow })
  }, [side, hide])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, content])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      hide()
      const el = anchorRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? anchorRef.current
      el?.focus()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place, hide])

  useEffect(() => {
    if (!open) return
    const el = anchorRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? anchorRef.current
    if (!el) return
    const prev = el.getAttribute('aria-describedby')
    el.setAttribute('aria-describedby', prev ? `${prev} ${id}` : id)
    return () => {
      if (prev) el.setAttribute('aria-describedby', prev)
      else el.removeAttribute('aria-describedby')
    }
  }, [open, id])

  useEffect(() => {
    if (off) return
    const el = anchorRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? anchorRef.current
    if (!el) return
    if (el.hasAttribute('title')) el.removeAttribute('title')
  }, [off])

  const onPointerEnter = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === 'touch') return
    show(instant ? 0 : groupIsWarm() ? FOLLOW_DELAY : tooltipDelay())
  }

  const onFocus = (e: ReactFocusEvent<HTMLSpanElement>) => {
    if (Date.now() - escapedAt < ESCAPE_GRACE) return
    if (e.target instanceof HTMLElement && isKeyboardFocus(e.target)) show(0)
  }

  const style = { top: coords?.top ?? 0, left: coords?.left ?? 0, '--tt-arrow': `${coords?.arrow ?? 0}px` } as CSSProperties

  return (
    <>
      <span
        ref={anchorRef}
        className={`tt__anchor${block ? ' is-block' : ''}`}
        onPointerEnter={off ? undefined : onPointerEnter}
        onPointerLeave={off ? undefined : hide}
        onPointerDown={off ? undefined : hide}
        onFocus={off ? undefined : onFocus}
        onBlur={off ? undefined : hide}
      >
        {children}
      </span>
      {mounted && open
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              className="tt"
              data-side={coords?.side ?? side}
              data-placed={coords ? '' : undefined}
              style={style}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
