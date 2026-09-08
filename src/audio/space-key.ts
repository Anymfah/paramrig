/**
 * Whether the space bar should start playback, or belongs to whatever has focus.
 *
 * Space is the transport key, and it stops being one the moment it only works when nothing has
 * focus — which, in a workspace made of controls, is almost never. Clicking a field to read it or
 * tabbing to a switch should not cost you the transport.
 *
 * So it is taken from everything, and the exceptions are only the two places where taking it would
 * remove something that cannot be done another way:
 *
 * - Text being typed. A patch called `Door chime` needs its space. Numeric fields are not this:
 *   a space is never part of a number, and the expressions they accept do not need one.
 * - A native checkbox or radio, where space is the only key that toggles it. This workspace has
 *   none — its switches and segments are buttons, which Enter activates, and its radio groups
 *   select with the arrow keys — but the rule is about what the element is, not about what this
 *   application happens to contain.
 *
 * A focused button therefore loses space and keeps Enter. That is the trade this file makes, and
 * it is the right way round for a tool whose whole job is to make a sound.
 */

/** Numeric entry: a space is never part of a number, and only ever optional inside an expression. */
function isNumericEntry(element: HTMLInputElement): boolean {
  const mode = element.inputMode || element.getAttribute('inputmode') || ''
  if (mode === 'decimal' || mode === 'numeric') return true
  return element.type === 'number' || element.getAttribute('role') === 'spinbutton'
}

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox'])

export function playsOnSpace(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  // The attribute as well as the property: focus can sit on a child of the editable host, and
  // not every environment implements `isContentEditable` (jsdom does not).
  if (target.closest('[contenteditable=""], [contenteditable="true"]')) return false
  if (target instanceof HTMLElement && target.isContentEditable) return false

  const tag = target.tagName
  if (tag === 'TEXTAREA') return false
  if (tag === 'INPUT') {
    const input = target as HTMLInputElement
    if (input.type === 'checkbox' || input.type === 'radio') return false
    if (input.type === 'range') return true
    return isNumericEntry(input)
  }
  const role = target.getAttribute('role')
  if (role && TEXT_ROLES.has(role)) return false
  return true
}
