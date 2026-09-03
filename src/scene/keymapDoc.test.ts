import { describe, expect, it } from 'vitest'
import { KEYMAP, describeKeymap, shortcutLabel, type KeyBinding } from '@/scene/keymap'
import { keymapMarkdown } from '@/scene/keymapDoc'

/**
 * The page is a build product, so what is worth asserting is that nothing falls out of it on the
 * way: every binding, every note, every section, and none of the chords the browser keeps.
 */

/** The rows of every table on the page, as the chord and the action they print. */
function tableRows(page: string): Array<{ chord: string; action: string }> {
  return page
    .split('\n')
    .flatMap((line) => {
      const [, chord, action] = /^\| `(.+)` \| (.+) \|$/.exec(line) ?? []
      return chord && action ? [{ chord, action }] : []
    })
}

/** The prose above the rule, which is where the reasoning lives rather than the reference. */
function preamble(page: string): string {
  return page.split('\n---\n')[0] ?? ''
}

/** One section of the page, from its heading to the next one. */
function sectionOf(page: string, title: string): string {
  return (page.split(`\n## ${title}\n`)[1] ?? '').split('\n## ')[0] ?? ''
}

/** What the table should print for a binding, mode and all. */
function expectedAction(binding: KeyBinding): string {
  return binding.mode ? `${binding.label} (${binding.mode} mode)` : binding.label
}

describe('the generated keymap page', () => {
  it('opens with the reasons a chord ever departs from Blender', () => {
    const page = keymapMarkdown()
    const prose = preamble(page)

    expect(page.startsWith('# The scene editor’s keymap\n')).toBe(true)
    expect(prose).toContain('## Why a chord ever differs')
    expect(prose).toContain('## What is not bound yet')
    expect(prose).toContain('## How to regenerate this page')
    // The four departures the editor is built around, each named where a reader will look for it.
    expect(prose).toContain('Emulate Numpad')
    expect(prose).toContain('`event.code`')
    expect(prose).toContain('macOS spells undo ⌘Z')
    // The absences are dated, so a reader knows which prompt to wait for rather than guessing.
    for (const prompt of ['docs/scene-editor-roadmap-2-prompt.md', '`-3-`', '`-4-`', '`-5-`']) {
      expect(prose, prompt).toContain(prompt)
    }
  })

  it('carries one section per section of the table, in the table’s order', () => {
    const page = keymapMarkdown()
    const sections = describeKeymap()

    const headings = page.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3))
    for (const section of sections) expect(headings).toContain(section.title)
    // Each section opens exactly one table, and no section opens two.
    expect(page.split('| Chord | Action |')).toHaveLength(sections.length + 1)
    const order = headings.filter((heading) => sections.some((section) => section.title === heading))
    expect(order).toEqual(sections.map((section) => section.title))
  })

  it('prints every binding of the table exactly once', () => {
    const rows = tableRows(keymapMarkdown())

    for (const binding of KEYMAP) {
      const chord = shortcutLabel(binding)
      const matches = rows.filter((row) => row.chord === chord && row.action === expectedAction(binding))
      expect(matches, `${chord} · ${binding.label}`).toHaveLength(1)
    }
    expect(rows).toHaveLength(KEYMAP.length)
  })

  it('lists none of the chords the browser keeps for itself, and says why', () => {
    const page = keymapMarkdown()
    const chords = tableRows(page).map((row) => row.chord)

    for (const owned of ['⌘W', '⌘T', '⌘N', '⌘Q', '⌃W']) {
      expect(chords, owned).not.toContain(owned)
      // Absent from the table but named in the preamble: unbound on purpose, not by oversight.
      expect(preamble(page), owned).toContain(owned)
    }
  })

  it('brings every note in the table down under its section', () => {
    const page = keymapMarkdown()

    const notes = new Set(KEYMAP.flatMap((binding) => (binding.note ? [binding.note] : [])))
    expect(notes.size).toBeGreaterThan(0)
    for (const note of notes) expect(page, note.slice(0, 40)).toContain(note)
    // And under its own section, where the chord it explains is, rather than anywhere on the page.
    for (const section of describeKeymap()) {
      const body = sectionOf(page, section.title)
      for (const entry of section.entries) {
        if (entry.note) expect(body, `${section.title} · ${entry.shortcut}`).toContain(entry.note)
      }
    }
    // A note shared by several chords is printed once, with the chords gathered in front of it.
    expect(page).toContain('- `⌃S`, `⌘S`, `⇧⌃S`, `⇧⌘S`, `⌃O`, `⌘O` — ')
  })

  it('says so when a section has nothing to explain', () => {
    const page = keymapMarkdown()

    expect(sectionOf(page, 'Transform')).toContain('Every chord in this section is Blender’s own.')
    expect(sectionOf(page, 'File')).toContain('Where this differs from Blender:')
  })

  /**
   * The page on disk, checked against the generator and rewritten by `vitest -u`. This is what
   * stops `docs/scene-editor-keymap.md` from drifting: a binding that moves without the page being
   * regenerated fails here rather than misleading a reader for a month.
   */
  it('matches the page committed to the repository', async () => {
    await expect(keymapMarkdown()).toMatchFileSnapshot('../../docs/scene-editor-keymap.md')
  })
})
