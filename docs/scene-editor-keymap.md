# The scene editor’s keymap

> Generated. `keymapMarkdown()` in `src/scene/keymapDoc.ts` writes this whole file from the table
> in `src/scene/keymap.ts`. Edit the table, never the page.

The scene editor answers to Blender’s keys. Someone who models in Blender should be able to open a
viewport in a browser tab, press G, and watch the object under the pointer move. Every chord in the
tables below is Blender’s own unless the notes under the table say otherwise, and those notes are
why this page exists: a departure nobody wrote down is a departure found by pressing something and
watching the editor do the wrong thing.

## Why a chord ever differs

**The browser is served first.** ⌘W, ⌘T, ⌘N, ⌘Q and ⌃W never reach the page: the tab closes, a tab
opens, a window opens or the browser quits before the keystroke is offered to anything. They are
not bound, and they have to stay unbound, because a shortcut that closes the tab is worse than no
shortcut at all. The chords a browser gives up under protest are a different matter: ⌃S, ⌃O, ⌃P,
⌃A, ⌃C, ⌃V, ⌃J, F1 and F3 are taken for the document, and taken only while the viewport has the
keyboard. A focused text field keeps every one of them — the keymap ignores everything but Escape
while a field has focus — so typing a name is still typing a name.

**macOS spells undo ⌘Z and Blender spells it ⌃Z.** Both are bound, and so are ⇧⌘Z and ⇧⌃Z for redo,
so neither habit has to be unlearned. The clipboard is the one place where the two are not both
honoured: ⌃C and ⌃V copy and paste objects, while ⌘C and ⌘V are left alone, so a colour or a number
can still be pasted into a field on a Mac.

**Not every keyboard has a numeric keypad.** Blender puts the axis views on it and a laptop has
none, so the top row stands in: ⌥1 front, ⌥3 right, ⌥7 top, each with ⌃ added for the opposite
view, then ⌥5 for the projection, ⌥0 for the camera and ⌥. to frame the selection. This is
Blender’s own “Emulate Numpad” preference, on by default here and switchable in the sidebar. Turn
it off and those rows leave the editor and this page together, because a sheet listing a chord the
editor will not answer to is worse than a short sheet. The ⌃⌥ pairs carry a warning of their own:
⌃⌥ is AltGr on Windows, where some layouts use it to type a character.

**AZERTY types `&`, `é`, `"` and `'` where QWERTY types 1, 2, 3 and 4.** So a chord resolves on
`event.code`, the physical position of the key, and never on `event.key`. `Digit1` is `Digit1` on
every layout, which is what keeps the axis views under the digits Blender put them under, whoever
is typing. The one exception is numeric entry during a modal transform — `G X 2 ↵` — where the
character actually typed is the whole point, and `src/scene/transform/numeric.ts` reads
`event.key` for it.

## What is not bound yet

This first prompt is the object mode: the viewport, navigation, selection, the modal transforms,
the gizmos, the outliner, the properties, the history and the files. Tab is bound and the mode pie
is bound, but both answer that edit mode arrives with the mesh editing prompt, and that is where
the greater part of Blender’s keyboard lives. The absences below are large, and every one of them
is deliberate.

- **Mesh editing**, with `docs/scene-editor-roadmap-2-prompt.md`: 1 / 2 / 3 for vertices, edges and
  faces and ⌃Tab’s pie; ⌥ click for an edge loop, ⌃⌥ click for a ring, ⌃ click for the shortest
  path, L / ⇧L / ⌃L for linked, ⌃+ and ⌃- to grow and shrink; E and ⌥E extrude, I inset, ⌃B and
  ⇧⌃B bevel, ⌃R and ⇧⌃R loop cut, K and ⇧K knife; ⌃T triangulate and ⌥J tris to quads; M merge,
  ⌥M split, V rip, ⌃V vertex slide, G G edge slide, ⌥S shrink and fatten; F fill, ⌥F beauty fill,
  ⌃E the edge menu, ⌃F the face menu; ⌃N and ⇧N for the normals, ⇧E crease, ⌃M mirror, P separate,
  O proportional editing. Several of those collide with an object-mode chord that is already bound
  — M, ⌃V and ⇧D all mean something else on a mesh — which is why a binding may name the mode it
  belongs to, and why the table below marks the ones that do.
- **Modifiers, materials, lights, cameras and shading**, with `-3-`: ⌥Z for X-ray, F12 to render an
  image, ⌃⌥0 to align the active camera to the view. Z already opens the shading pie.
- **Quad view**, with `-4-`: ⌃⌥Q. The rest of that prompt is the rig side of the editor, which adds
  panels rather than chords.
- **UV, sculpt, shape keys, curves and text**, with `-5-`: U and the UV editor’s own keys, the
  sculpt brushes with their F and ⇧F sizing, and whatever the curve and text objects bring.

Two object-mode chords are missing rather than deferred. ⌃L, Blender’s Link / Transfer Data, has no
operator behind it and no entry in the Object menu. U, Make Single User, has its operator —
`object.makeSingleUser` — and the command palette lists it, but no chord runs it.

Some of Blender’s keys will never appear here, because what they drive is out of scope: armatures
and skinning, grease pencil, the video sequencer, physics, Python and the Cycles render. Section 10
of `docs/scene-editor-plan.md` is the full inventory, feature by feature, with the prompt each one
lands in.

## How to regenerate this page

`keymapMarkdown()` writes every line of the file from `describeKeymap()`, and
`src/scene/keymapDoc.test.ts` compares its output with the file, so a binding that moves takes the
page with it or fails the suite:

```sh
docker compose run --rm app npx vitest run src/scene/keymapDoc.test.ts      # check
docker compose run --rm app npx vitest run src/scene/keymapDoc.test.ts -u   # rewrite
```

Bindings that a preference switches off are left out of both the editor and the page; the page is
generated with the preferences at their defaults, which is where “Emulate Numpad” is on.

---

## View

| Chord | Action |
| --- | --- |
| `Numpad .` | Frame selected |
| `Home` | Frame all |
| `Numpad 1` | Front view |
| `⌃Numpad 1` | Back view |
| `Numpad 3` | Right view |
| `⌃Numpad 3` | Left view |
| `Numpad 7` | Top view |
| `⌃Numpad 7` | Bottom view |
| `Numpad 9` | Opposite view |
| `Numpad 5` | Toggle perspective |
| `Numpad 8` | Orbit up |
| `Numpad 2` | Orbit down |
| `Numpad 4` | Orbit left |
| `Numpad 6` | Orbit right |
| `Numpad 0` | Camera view |
| `Numpad /` | Toggle local view |
| `⌥1` | Front view |
| `⌃⌥1` | Back view |
| `⌥3` | Right view |
| `⌃⌥3` | Left view |
| `⌥7` | Top view |
| `⌃⌥7` | Bottom view |
| `⌥5` | Toggle perspective |
| `⌥0` | Camera view |
| `⌥.` | Frame selected |
| `⌥Z` | X-ray |

Where this differs from Blender:

- `⌥1`, `⌥3`, `⌥7`, `⌥5`, `⌥0`, `⌥.` — A keyboard without a numeric keypad reaches the axis views on the top row, the way Blender’s “Emulate Numpad” preference does.
- `⌃⌥1`, `⌃⌥3`, `⌃⌥7` — ⌃⌥ is AltGr on Windows, where some layouts type a character with it. Keys are ignored while a field has focus, so typing is left alone.

## Modes

| Chord | Action |
| --- | --- |
| `Tab` | Toggle edit mode |
| `⌃Tab` | Mode pie |
| `1` | Vertex select (edit mode) |
| `2` | Edge select (edit mode) |
| `3` | Face select (edit mode) |
| `⇧1` | Add vertex select (edit mode) |
| `⇧2` | Add edge select (edit mode) |
| `⇧3` | Add face select (edit mode) |

Where this differs from Blender:

- `Tab` — Tab changes mode instead of moving focus, so the viewport takes the event before the page does. A focused field keeps it.
- `⌃Tab` — Some browsers keep ⌃Tab for their own tabs. The mode selector in the header does the same job where they do.

## Select

| Chord | Action |
| --- | --- |
| `A` | Select all (object mode) |
| `⌥A` | Select none (object mode) |
| `⌃I` | Invert selection (object mode) |
| `B` | Box select |
| `C` | Circle select |
| `W` | Cycle the select tool |
| `⇧G` | Select similar (object mode) |
| `L` | Select linked under the pointer (edit mode) |
| `K` | Knife (edit mode) |

Every chord in this section is Blender’s own.

## Add and object

| Chord | Action |
| --- | --- |
| `⇧A` | Add |
| `⇧D` | Duplicate (object mode) |
| `⌥D` | Duplicate linked (object mode) |
| `X` | Delete, with confirmation (object mode) |
| `Delete` | Delete (object mode) |
| `⌃J` | Join (object mode) |
| `⌃A` | Apply (object mode) |
| `⌃P` | Parent (object mode) |
| `⌥P` | Clear parent (object mode) |
| `M` | Move to collection (object mode) |
| `⇧M` | Link to collection (object mode) |
| `H` | Hide selected (object mode) |
| `⌥H` | Reveal hidden (object mode) |
| `⇧H` | Hide unselected (object mode) |
| `F2` | Rename |
| `⌃C` | Copy objects (object mode) |
| `⌃V` | Paste objects (object mode) |
| `⌥G` | Clear location (object mode) |
| `⌥R` | Clear rotation (object mode) |
| `⌥S` | Clear scale (object mode) |

Where this differs from Blender:

- `⌃J` — ⌃J opens the downloads list in some browsers. The editor takes it, and the Object menu carries Join for where it cannot.
- `⌃A` — ⌃A selects the whole page in a browser. The editor takes it in the viewport; a focused field keeps it.
- `⌃P` — ⌃P prints in every browser. The editor takes it, and Object → Parent is the way round it.
- `⌃C`, `⌃V` — The browser’s own clipboard chord. The editor takes it for objects when no field has focus, and only on ⌃, never ⌘, so the system clipboard stays reachable on macOS.

## Transform

| Chord | Action |
| --- | --- |
| `G` | Move |
| `R` | Rotate |
| `S` | Scale |

Every chord in this section is Blender’s own.

## 3D cursor

| Chord | Action |
| --- | --- |
| `⇧C` | Cursor to world origin and frame all |
| `⇧S` | Snap pie |

Every chord in this section is Blender’s own.

## Pie menus

| Chord | Action |
| --- | --- |
| `.` | Pivot point pie |
| `,` | Transform orientation pie |
| `Z` | Shading pie |

Every chord in this section is Blender’s own.

## Editor

| Chord | Action |
| --- | --- |
| `A` | Select all (edit mode) |
| `⌥A` | Select none (edit mode) |
| `⌃I` | Invert selection (edit mode) |
| `⌃L` | Select linked (edit mode) |
| `⇧G` | Select similar (edit mode) |
| `⌃Numpad +` | Select more (edit mode) |
| `⌃Numpad -` | Select less (edit mode) |
| `⌃=` | Select more (edit mode) |
| `⌃-` | Select less (edit mode) |
| `⌃0` | Subdivision level 0 (object mode) |
| `⌃1` | Subdivision level 1 (object mode) |
| `⌃2` | Subdivision level 2 (object mode) |
| `⌃3` | Subdivision level 3 (object mode) |
| `⌃4` | Subdivision level 4 (object mode) |
| `⌃5` | Subdivision level 5 (object mode) |
| `E` | Extrude region (edit mode) |
| `⌥E` | Extrude menu (edit mode) |
| `I` | Inset faces (edit mode) |
| `⌃B` | Bevel edges (edit mode) |
| `⇧⌃B` | Bevel vertices (edit mode) |
| `⌃R` | Loop cut (edit mode) |
| `⇧⌃R` | Offset edge loop (edit mode) |
| `⇧K` | Knife project (edit mode) |
| `M` | Merge menu (edit mode) |
| `⌥M` | Split menu (edit mode) |
| `⌃M` | Mirror (edit mode) |
| `X` | Delete menu (edit mode) |
| `Delete` | Delete menu (edit mode) |
| `F` | Make edge or face (edit mode) |
| `⌥F` | Beauty fill (edit mode) |
| `P` | Separate (edit mode) |
| `V` | Rip (edit mode) |
| `⌥V` | Rip fill (edit mode) |
| `⇧V` | Vertex slide (edit mode) |
| `⇧N` | Recalculate normals outside (edit mode) |
| `⇧⌃N` | Recalculate normals inside (edit mode) |
| `⇧E` | Edge crease (edit mode) |
| `⇧⌃E` | Edge bevel weight (edit mode) |
| `⌃T` | Triangulate faces (edit mode) |
| `⌥J` | Tris to quads (edit mode) |
| `⌥S` | Shrink or fatten (edit mode) |
| `⇧⌥S` | To sphere (edit mode) |
| `⇧⌃⌥S` | Shear (edit mode) |
| `⌃V` | Vertex menu (edit mode) |
| `⌃E` | Edge menu (edit mode) |
| `⌃F` | Face menu (edit mode) |
| `⇧D` | Duplicate (edit mode) |
| `O` | Proportional editing (edit mode) |
| `⇧O` | Proportional falloff pie (edit mode) |
| `⌥O` | Proportional, connected only (edit mode) |
| `⇧Tab` | Snapping |
| `F3` | Command palette |
| `⌃/` | Command palette |
| `⌘/` | Command palette |
| `F9` | Adjust last operation |
| `F1` | Keymap sheet |
| `T` | Toolbar |
| `N` | Sidebar |
| `⇧R` | Repeat last |
| `⌃Z` | Undo |
| `⌘Z` | Undo |
| `⇧⌃Z` | Redo |
| `⇧⌘Z` | Redo |
| `Esc` | Cancel |

Where this differs from Blender:

- `⌃=`, `⌃-` — Blender grows and shrinks a selection with the keypad’s + and −. The top row’s own + and − are bound as well, for a keyboard that has no keypad.
- `⌃0` — Level nought takes the subdivision modifier off again, so the chords are a round trip rather than a one-way street.
- `F3` — F3 is the browser’s own find on Windows and Linux, so ⌃/ and ⌘/ open the palette as well.
- `F1` — Blender’s F1 opens the manual in a browser. The editor is already in one, so F1 shows the keymap itself.
- `⌘Z`, `⇧⌘Z` — macOS spells undo ⌘Z and Blender spells it ⌃Z. Both are bound, so neither habit has to be unlearned.

## File

| Chord | Action |
| --- | --- |
| `⌃S` | Save |
| `⌘S` | Save |
| `⇧⌃S` | Save as |
| `⇧⌘S` | Save as |
| `⌃O` | Open |
| `⌘O` | Open |

Where this differs from Blender:

- `⌃S`, `⌘S`, `⇧⌃S`, `⇧⌘S`, `⌃O`, `⌘O` — The browser would save or open a page of its own. The editor takes the chord for the document and stops it there.
