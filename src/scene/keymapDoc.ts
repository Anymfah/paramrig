import { describeKeymap, type KeymapEntry, type KeymapSection } from '@/scene/keymap'

/**
 * `docs/scene-editor-keymap.md`, written from the keymap rather than typed out beside it.
 *
 * The page exists for its notes: the chords that are not Blender’s, and the reason each one is not.
 * A page kept by hand is a page that goes stale the first time a binding moves, and a stale note is
 * worse than no note, so every line of the file is this module’s output — the preamble included —
 * and `keymapDoc.test.ts` fails the moment the file on disk and this function disagree.
 */

/**
 * The prose, written once, here, so that a change to the reasoning is a change to the code and is
 * reviewed beside whatever caused it. The apostrophes and the quotation marks are the typographic
 * ones the keymap’s own notes use, so the two halves of the page read as one document.
 */
const PREAMBLE: string[] = [
  '# The scene editor’s keymap',
  '',
  '> Generated. `keymapMarkdown()` in `src/scene/keymapDoc.ts` writes this whole file from the table',
  '> in `src/scene/keymap.ts`. Edit the table, never the page.',
  '',
  'The scene editor answers to Blender’s keys. Someone who models in Blender should be able to open a',
  'viewport in a browser tab, press G, and watch the object under the pointer move. Every chord in the',
  'tables below is Blender’s own unless the notes under the table say otherwise, and those notes are',
  'why this page exists: a departure nobody wrote down is a departure found by pressing something and',
  'watching the editor do the wrong thing.',
  '',
  '## Why a chord ever differs',
  '',
  '**The browser is served first.** ⌘W, ⌘T, ⌘N, ⌘Q and ⌃W never reach the page: the tab closes, a tab',
  'opens, a window opens or the browser quits before the keystroke is offered to anything. They are',
  'not bound, and they have to stay unbound, because a shortcut that closes the tab is worse than no',
  'shortcut at all. The chords a browser gives up under protest are a different matter: ⌃S, ⌃O, ⌃P,',
  '⌃A, ⌃C, ⌃V, ⌃J, F1 and F3 are taken for the document, and taken only while the viewport has the',
  'keyboard. A focused text field keeps every one of them — the keymap ignores everything but Escape',
  'while a field has focus — so typing a name is still typing a name.',
  '',
  '**macOS spells undo ⌘Z and Blender spells it ⌃Z.** Both are bound, and so are ⇧⌘Z and ⇧⌃Z for redo,',
  'so neither habit has to be unlearned. The clipboard is the one place where the two are not both',
  'honoured: ⌃C and ⌃V copy and paste objects, while ⌘C and ⌘V are left alone, so a colour or a number',
  'can still be pasted into a field on a Mac.',
  '',
  '**Not every keyboard has a numeric keypad.** Blender puts the axis views on it and a laptop has',
  'none, so the top row stands in: ⌥1 front, ⌥3 right, ⌥7 top, each with ⌃ added for the opposite',
  'view, then ⌥5 for the projection, ⌥0 for the camera and ⌥. to frame the selection. This is',
  'Blender’s own “Emulate Numpad” preference, on by default here and switchable in the sidebar. Turn',
  'it off and those rows leave the editor and this page together, because a sheet listing a chord the',
  'editor will not answer to is worse than a short sheet. The ⌃⌥ pairs carry a warning of their own:',
  '⌃⌥ is AltGr on Windows, where some layouts use it to type a character.',
  '',
  '**AZERTY types `&`, `é`, `"` and `\'` where QWERTY types 1, 2, 3 and 4.** So a chord resolves on',
  '`event.code`, the physical position of the key, and never on `event.key`. `Digit1` is `Digit1` on',
  'every layout, which is what keeps the axis views under the digits Blender put them under, whoever',
  'is typing. The one exception is numeric entry during a modal transform — `G X 2 ↵` — where the',
  'character actually typed is the whole point, and `src/scene/transform/numeric.ts` reads',
  '`event.key` for it.',
  '',
  '## What is not bound yet',
  '',
  'This first prompt is the object mode: the viewport, navigation, selection, the modal transforms,',
  'the gizmos, the outliner, the properties, the history and the files. Tab is bound and the mode pie',
  'is bound, but both answer that edit mode arrives with the mesh editing prompt, and that is where',
  'the greater part of Blender’s keyboard lives. The absences below are large, and every one of them',
  'is deliberate.',
  '',
  '- **Mesh editing**, with `docs/scene-editor-roadmap-2-prompt.md`: 1 / 2 / 3 for vertices, edges and',
  '  faces and ⌃Tab’s pie; ⌥ click for an edge loop, ⌃⌥ click for a ring, ⌃ click for the shortest',
  '  path, L / ⇧L / ⌃L for linked, ⌃+ and ⌃- to grow and shrink; E and ⌥E extrude, I inset, ⌃B and',
  '  ⇧⌃B bevel, ⌃R and ⇧⌃R loop cut, K and ⇧K knife; ⌃T triangulate and ⌥J tris to quads; M merge,',
  '  ⌥M split, V rip, ⌃V vertex slide, G G edge slide, ⌥S shrink and fatten; F fill, ⌥F beauty fill,',
  '  ⌃E the edge menu, ⌃F the face menu; ⌃N and ⇧N for the normals, ⇧E crease, ⌃M mirror, P separate,',
  '  O proportional editing. Several of those collide with an object-mode chord that is already bound',
  '  — M, ⌃V and ⇧D all mean something else on a mesh — which is why a binding may name the mode it',
  '  belongs to, and why the table below marks the ones that do.',
  '- **Modifiers, materials, lights, cameras and shading**, with `-3-`: ⌥Z for X-ray, F12 to render an',
  '  image, ⌃⌥0 to align the active camera to the view. Z already opens the shading pie.',
  '- **Quad view**, with `-4-`: ⌃⌥Q. The rest of that prompt is the rig side of the editor, which adds',
  '  panels rather than chords.',
  '- **UV, sculpt, shape keys, curves and text**, with `-5-`: U and the UV editor’s own keys, the',
  '  sculpt brushes with their F and ⇧F sizing, and whatever the curve and text objects bring.',
  '',
  'Two object-mode chords are missing rather than deferred. ⌃L, Blender’s Link / Transfer Data, has no',
  'operator behind it and no entry in the Object menu. U, Make Single User, has its operator —',
  '`object.makeSingleUser` — and the command palette lists it, but no chord runs it.',
  '',
  'Some of Blender’s keys will never appear here, because what they drive is out of scope: armatures',
  'and skinning, grease pencil, the video sequencer, physics, Python and the Cycles render. Section 10',
  'of `docs/scene-editor-plan.md` is the full inventory, feature by feature, with the prompt each one',
  'lands in.',
  '',
  '## How to regenerate this page',
  '',
  '`keymapMarkdown()` writes every line of the file from `describeKeymap()`, and',
  '`src/scene/keymapDoc.test.ts` compares its output with the file, so a binding that moves takes the',
  'page with it or fails the suite:',
  '',
  '```sh',
  'docker compose run --rm app npx vitest run src/scene/keymapDoc.test.ts      # check',
  'docker compose run --rm app npx vitest run src/scene/keymapDoc.test.ts -u   # rewrite',
  '```',
  '',
  'Bindings that a preference switches off are left out of both the editor and the page; the page is',
  'generated with the preferences at their defaults, which is where “Emulate Numpad” is on.',
  '',
  '---',
]

/**
 * A cell that cannot break the table it sits in. Nothing in the keymap carries a pipe today, and
 * the escape is here so that the first label which does is a wider column rather than a broken page.
 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/** What a row runs, with the mode it is scoped to when it is scoped to one. */
function actionOf(entry: KeymapEntry): string {
  // A curve and a mesh share edit mode and share Blender's letters; the scope has to say which.
  const scope = entry.editData === 'curve' ? 'editing a curve' : entry.mode ? `${entry.mode.replace('-', ' ')} mode` : ''
  return scope ? `${entry.label} (${scope})` : entry.label
}

function chord(shortcut: string): string {
  // A chord that is itself a backtick needs the doubled fence, with the spaces Markdown eats back.
  const fence = shortcut.includes('`') ? '``' : '`'
  const pad = shortcut.includes('`') ? ' ' : ''
  return `${fence}${pad}${cell(shortcut)}${pad}${fence}`
}

function table(entries: KeymapEntry[]): string[] {
  return [
    '| Chord | Action |',
    '| --- | --- |',
    ...entries.map((entry) => `| ${chord(entry.shortcut)} | ${cell(actionOf(entry))} |`),
  ]
}

/**
 * The departures of one section, one line per distinct note.
 *
 * Chords share a note far more often than not — the six file chords depart for one reason and the
 * emulated axis views for another — and printing the sentence once per row would read as six
 * decisions rather than one. So the chords gather in front of the sentence they share, in the order
 * the table introduces it. A section with nothing to explain says so, because silence there is
 * ambiguous between “all of this is Blender’s” and “nobody has looked”.
 */
function departures(entries: KeymapEntry[]): string[] {
  const notes = new Map<string, string[]>()
  for (const entry of entries) {
    if (!entry.note) continue
    const chords = notes.get(entry.note)
    if (chords) chords.push(entry.shortcut)
    else notes.set(entry.note, [entry.shortcut])
  }
  if (notes.size === 0) return ['', 'Every chord in this section is Blender’s own.']
  return [
    '',
    'Where this differs from Blender:',
    '',
    ...[...notes].map(([note, chords]) => `- ${chords.map(chord).join(', ')} — ${note}`),
  ]
}

function sectionLines(section: KeymapSection): string[] {
  return ['', `## ${section.title}`, '', ...table(section.entries), ...departures(section.entries)]
}

/** The whole of `docs/scene-editor-keymap.md`, ready to be written to disk. */
export function keymapMarkdown(): string {
  return [...PREAMBLE, ...describeKeymap().flatMap(sectionLines), ''].join('\n')
}
