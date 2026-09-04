/**
 * A modal gesture takes the keyboard.
 *
 * G, R and S can be pressed while the focus is anywhere — a row of the outliner, a field of the
 * properties — and whatever holds it keeps answering to the arrows, which are exactly the keys the
 * gesture needs. So the gesture takes the focus off it. The viewport surface itself is not
 * focusable, and does not need to be: with nothing focused the keys reach the page's own listener,
 * which is where every chord of the keymap is read.
 */
export function takeKeyboard(element: HTMLElement | null): void {
  if (typeof window === 'undefined') return
  const active = window.document.activeElement
  if (!(active instanceof HTMLElement) || active === window.document.body) return
  if (element && element.contains(active)) return
  active.blur()
}
