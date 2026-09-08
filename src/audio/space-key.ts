/**
 * Whether the space bar should start playback, or belongs to whatever has focus.
 *
 * Space is the transport key in every tool that makes a sound, and it stops being one the moment
 * it only works when nothing is focused — which, in a workspace made of controls, is almost never.
 * Clicking a field to read it should not cost you the transport.
 *
 * So the question is not "is something focused" but "is this keystroke already spoken for":
 *
 * - Typing text. A patch called `Door chime` needs its space. Numeric fields are not this: they
 *   take expressions, and `2*3` needs no space to work.
 * - A control reached by keyboard. Space activates a focused button, and taking that away breaks
 *   the keyboard entirely. A button reached by *clicking* is a different matter — the pointer has
 *   already done what it came to do, and the focus left behind is a leftover, not an intention.
 *   `:focus-visible` is exactly that distinction, which is why the caller passes it in.
 */

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox'])

/** Numeric entry: a space is never part of a number, and only ever optional inside an expression. */
function isNumericEntry(element: HTMLInputElement): boolean {
  const mode = element.inputMode || element.getAttribute('inputmode') || ''
  if (mode === 'decimal' || mode === 'numeric') return true
  return element.type === 'number' || element.getAttribute('role') === 'spinbutton'
}

/** Keys a control claims for itself: a button is pressed with space, a checkbox is toggled. */
function claimsSpace(element: Element): boolean {
  const tag = element.tagName
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'SUMMARY') return true
  const role = element.getAttribute('role')
  if (role && ['button', 'tab', 'switch', 'checkbox', 'radio', 'option', 'menuitem'].includes(role)) return true
  if (tag === 'A' && element.hasAttribute('href')) return true
  return false
}

export function playsOnSpace(target: EventTarget | null, keyboardFocus: boolean): boolean {
  if (!(target instanceof Element)) return true
  // The attribute as well as the property: focus can sit on a child of the editable host, and
  // not every environment implements `isContentEditable` (jsdom does not).
  if (target.closest('[contenteditable=""], [contenteditable="true"]')) return false
  if (target instanceof HTMLElement && target.isContentEditable) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA') return false
  if (tag === 'INPUT') {
    const input = target as HTMLInputElement
    if (input.type === 'checkbox' || input.type === 'radio') return !keyboardFocus
    if (input.type === 'range') return true
    return isNumericEntry(input)
  }
  const role = target.getAttribute('role')
  if (role && TEXT_ROLES.has(role)) return false
  // A control reached by keyboard keeps the key; one left focused by a click does not.
  if (claimsSpace(target)) return !keyboardFocus
  return true
}

/** Whether the focus ring is showing, which is the browser's own answer to "did a key put it there". */
export function hasKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    // A browser that cannot answer is treated as though the keyboard put it there, which keeps
    // the control usable at the cost of the transport rather than the other way round.
    return true
  }
}
