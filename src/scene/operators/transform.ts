import { registerOperator } from '@/scene/operators/registry'
import type { OperatorContext } from '@/scene/operators/types'

/**
 * G, R and S.
 *
 * These are declared like every other operator so that they appear in the Object menu, in the
 * palette and in the generated keymap — but they are *modal*: the work happens between the key that
 * starts them and the click that ends them, in the viewport, and no pure function of the document
 * can express that. The editor sees `modal` and opens a transform session instead of calling `run`.
 *
 * `run` is still written, and still correct: invoked without a viewport it says so rather than
 * failing silently, which is what the palette does on a page with no scene open.
 */

function needsSelection(context: OperatorContext): true | string {
  if (context.selection.objectIds.length === 0) return 'Select something to move first.'
  return true
}

const NOT_HERE = 'That is a viewport action: press the key with the pointer over the viewport.'

registerOperator({
  id: 'transform.move',
  label: 'Move',
  section: 'Transform',
  shortcut: 'G',
  icon: 'move',
  description: 'Move the selection with the pointer. X, Y or Z constrains it; type a number for an exact distance.',
  params: [],
  defaults: {},
  modal: true,
  available: needsSelection,
  run: () => ({ error: NOT_HERE }),
})

registerOperator({
  id: 'transform.rotate',
  label: 'Rotate',
  section: 'Transform',
  shortcut: 'R',
  icon: 'rotate',
  description: 'Turn the selection around the pivot. Press R again for a trackball turn.',
  params: [],
  defaults: {},
  modal: true,
  available: needsSelection,
  run: () => ({ error: NOT_HERE }),
})

registerOperator({
  id: 'transform.scale',
  label: 'Scale',
  section: 'Transform',
  shortcut: 'S',
  icon: 'scale',
  description: 'Resize the selection about the pivot. A negative number mirrors it.',
  params: [],
  defaults: {},
  modal: true,
  available: needsSelection,
  run: () => ({ error: NOT_HERE }),
})
