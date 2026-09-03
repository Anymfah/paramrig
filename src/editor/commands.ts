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

/** Ranked matches for the command palette: a name that starts with the query comes first. */
export function filterCommands<Command extends EditorCommand>(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return commands
  const scored = commands.flatMap((command) => {
    const label = command.label.toLowerCase()
    const section = command.section.toLowerCase()
    const shortcut = (command.shortcut ?? '').toLowerCase()
    if (label.startsWith(needle)) return [{ command, score: 0 }]
    if (label.includes(needle)) return [{ command, score: 1 }]
    // Sections match from the start only: a bare letter should not drag in every "Object" command.
    if (section.startsWith(needle)) return [{ command, score: 2 }]
    if (shortcut.includes(needle)) return [{ command, score: 3 }]
    return []
  })
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.command)
}
