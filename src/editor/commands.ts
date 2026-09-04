/** Everything a command needs to show itself: the palette, the context menu and tooltips share it. */
export type EditorCommand = {
  id: string
  label: string
  section: string
  shortcut?: string
  disabled?: boolean
  /** Why the command is unavailable, shown in its tooltip rather than left to guess. */
  reason?: string
  run: () => void
}

/**
 * Ranked matches for the command palette.
 *
 * The tiers are in the order a person expects to find things: a name that starts with what was
 * typed, then a word of it, then anywhere in it, then the section, then the chord — and last, the
 * letters in order but not together, which is how "sml" finds "Shade smooth by angle". The loose
 * tier is worth having and worth keeping last: on a registry of two hundred operators it matches
 * a great deal, and anything it turns up should sit below a match somebody could have meant.
 *
 * `recent` is what was run from the palette before, most recent first. Within a tier it lifts what
 * has been chosen already, so a palette used twice for the same thing opens on it the second time.
 */
export function filterCommands<Command extends EditorCommand>(
  commands: Command[],
  query: string,
  recent: string[] = [],
): Command[] {
  const rank = (id: string) => {
    const index = recent.indexOf(id)
    return index === -1 ? recent.length : index
  }
  const needle = query.trim().toLowerCase()
  if (!needle) {
    // Nothing typed: what was used lately, then the registry's own order.
    return [...commands].sort((a, b) => rank(a.id) - rank(b.id))
  }
  const scored = commands.flatMap((command) => {
    const label = command.label.toLowerCase()
    const section = command.section.toLowerCase()
    const shortcut = (command.shortcut ?? '').toLowerCase()
    if (label.startsWith(needle)) return [{ command, score: 0 }]
    if (wordStart(label, needle)) return [{ command, score: 1 }]
    if (label.includes(needle)) return [{ command, score: 2 }]
    // Sections match from the start only: a bare letter should not drag in every "Object" command.
    if (section.startsWith(needle)) return [{ command, score: 3 }]
    if (shortcut.includes(needle)) return [{ command, score: 4 }]
    if (subsequence(label, needle)) return [{ command, score: 5 }]
    return []
  })
  return scored
    .sort((a, b) => a.score - b.score || rank(a.command.id) - rank(b.command.id))
    .map((entry) => entry.command)
}

/** Whether the query starts a word of the label: "sm" finds "Shade smooth". */
function wordStart(label: string, needle: string): boolean {
  return label.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))
}

/** Whether the query's letters appear in the label in order, with anything between them. */
function subsequence(label: string, needle: string): boolean {
  let at = 0
  for (const letter of needle) {
    at = label.indexOf(letter, at)
    if (at === -1) return false
    at += 1
  }
  return true
}

/** The last twelve commands run from a palette, most recent first and each named once. */
export function withRecentCommand(recent: string[], id: string, limit = 12): string[] {
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, limit)
}
