/**
 * What the editor remembers about the line of gestures it offers a newcomer: whether it has been
 * waved away, and when it was first met.
 *
 * A 3D viewport has no visible affordances — nothing on screen says that a middle drag orbits — so
 * the editor says it once and then never again. The memory belongs to the person rather than to the
 * document: the gestures are learnt once, not once per scene, and a hint that returns with every
 * new file is a hint nobody reads the second time.
 */

/** Versioned, so a later shape can be read as never-seen instead of being mistrusted. */
const STORAGE_KEY = 'paramrig.scene-hints.v1'

export type HintState = {
  /** Set once the person has waved the hint away, or acted in a way that shows they did not need it. */
  dismissed: boolean
  /** When the hint was first put in front of this person, as an ISO instant, or null if it never was. */
  seenAt: string | null
}

/** Somebody who has never opened the editor, and what nonsense in storage is read as. */
const UNSEEN: HintState = { dismissed: false, seenAt: null }

/**
 * The four the first minute turns on: the gesture that moves the view, the key that builds, the key
 * that goes inside a mesh, and the one that finds everything else.
 */
export const HINT_TEXT = 'Middle-drag or ⌥-drag to orbit · ⇧A to add · Tab to edit · F3 to search'

export function readHintState(): HintState {
  if (typeof localStorage === 'undefined') return { ...UNSEEN }
  try {
    return parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...UNSEEN }
  }
}

export function writeHintState(state: HintState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* A hint is not worth an editor: storage that is full or blocked leaves the state in memory. */
  }
}

/**
 * Having seen the hint is not the same as having learnt it. Somebody who opened the editor, read
 * the line and closed the tab without touching anything is offered it again; only an action or the
 * close button ends it, and then for good.
 */
export function shouldShowHint(state: HintState): boolean {
  return !state.dismissed
}

/** Dismissal keeps the first sighting, and stamps one for a hint dismissed before it was recorded. */
export function dismissHint(state: HintState): HintState {
  return { dismissed: true, seenAt: state.seenAt ?? new Date().toISOString() }
}

function parse(raw: unknown): HintState {
  if (!raw || typeof raw !== 'object') return { ...UNSEEN }
  const value = raw as Record<string, unknown>
  return {
    dismissed: value.dismissed === true,
    seenAt: typeof value.seenAt === 'string' ? value.seenAt : null,
  }
}
