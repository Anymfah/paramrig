# Browser QA

These scripts drive the editor in a real browser and check what it actually does. They are the
counterpart to the unit tests: anything that depends on layout, pointer behaviour, filters or the
rendered SVG is checked here rather than in jsdom.

## Running them

```sh
docker compose run --rm app npm run e2e
docker compose run --rm app npm run e2e -- chantier-d
```

Each script prints one `PASS`/`FAIL` line per check and writes the same lines to
`e2e/output/<name>.txt`, alongside any screenshots it takes. The runner exits non-zero if a check
fails, so it can gate a commit.

## What it connects to

- **The page** is served by the `app` service on `http://localhost:5174`. That URL is resolved by
  the browser, which runs on the host, so it stays `localhost` even when the script itself runs in
  the container.
- **The browser** is the persistent headless GPU Chrome on the host, reached over CDP at
  `http://host.docker.internal:9223`. The scripts connect to it; they never launch one, which is
  what keeps a window from appearing on the user's desktop.

Both addresses can be overridden — `PARAMRIG_CDP` and `PARAMRIG_BASE` — for a run straight from
macOS:

```sh
PARAMRIG_CDP=http://127.0.0.1:9223 node e2e/run.mjs
```

## Writing one

```js
import { run } from './lib.mjs'

export default run('chantier-x', async ({ page, check, helpers }) => {
  await helpers.newDocument()
  await page.keyboard.press('r')
  await helpers.drag({ x: 100, y: 100 }, { x: 300, y: 220 })

  check('a drag draws a rectangle', (await helpers.doc()).elements.length === 1)
})
```

`run` opens the page, collects console errors, adds a final check that there were none, and writes
the log. `helpers` carries the moves every script makes: `newDocument`, `drag`, `clickAt`,
`toClient` / `toDocument` for the canvas transform, `doc` for the stored document, `seed` for
scenes too tedious to draw by hand, and `captureExport` for reading an export without writing a
file.

Conventions worth keeping:

- Start a gesture away from the centre of a selection: the pivot handle sits there, and the corner
  handles sit inside the corners. A drag that starts on either moves the handle, not the object.
- Nothing is written to storage while a gesture is open, so read the live DOM mid-drag and the
  stored document only after the pointer comes up.
- `page.mouse.dblclick`, never `click({ clickCount: 2 })`; modifiers through `keyboard.down` /
  `keyboard.up`; focus `#main` before pressing a tool key.

## The scene scripts

`scene-*.e2e.mjs` drive the 3D editor. A viewport cannot be checked with selectors alone — a script
that wants to click a corner of the cube has to know where that corner landed — so these lean on a
hatch the viewport opens for them, and on a second set of helpers.

Listed in the order the runner takes them, which is the order they are named in.

- **`scene-colours`** — the palette measured in the picture rather than read off the stylesheet.
  What is selected has to be legible in a screenshot in both themes, and only a screenshot can say
  so, since the outline is painted by a shader over a ground the renderer paints too. The PNG is
  decoded in the script — `sharp` is not a dependency — and the pixels are counted.
- **`scene-gizmos`** — the gizmos are grabbable. The X arrow is in the id buffer at a fixed distance
  from the pivot, dragging it moves along X and nowhere else, that drag is one history entry, and
  the gizmo keeps its size on screen at every zoom.
- **`scene-library`** — a scene is a document like any other. New scene opens a route of its own,
  the startup scene is Blender's cube, light and camera, the cube is eight corners, twelve edges and
  six quads, and the library lists the scene with a drawn card picture beside the examples.
- **`scene-mobile`** — the editor at 320 × 720 under a finger: the dock, the sheets, the toolbar
  along the foot of the viewport and the navigation ball keeping clear of it. The touch is real
  rather than a mouse in costume — `Emulation.setTouchEmulationEnabled` over CDP, and every tap an
  `Input.dispatchTouchEvent`, because `page.touchscreen` needs a context created with `hasTouch` and
  the harness attaches to a browser that already exists.
- **`scene-navigation`** — the view moves the way Blender's does. A middle drag orbits, ⌥1 and ⌥7
  land exactly on the front and the top view, an axis view drops perspective and leaving one brings
  it back, ⌥ with the left button orbits as well, framing the selection centres the cube, and the
  wheel zooms towards the pointer rather than in steps.
- **`scene-object-mode`** — adding, duplicating, joining, parenting, hiding, and the walk back
  through the history. The Add menu filters as the letters arrive, F9 re-runs the last operation
  with different parameters without adding a second step, ⇧D hands over to a move, and undo walks
  all the way back to the startup scene.
- **`scene-panels`** — the outliner, the header menus, the properties, the adjust panel and the
  palette. A row selects and renames, Add · Cylinder puts Blender's cylinder in the scene, F9 opens
  the last operation's parameters, and F1 shows the keymap generated from the table.
- **`scene-reference`** — the reference record: the captures the roadmap asks for and the numbers
  beside them — first frame, draw calls and triangles, the cost of a hover pick, the heap after a
  hundred history steps. It writes its pictures and `measurements.txt` into `e2e/reference/scene/`
  rather than into `e2e/output/`.
- **`scene-tools`** — the T bar: the region selections, the annotations and the rulers, and the fact
  that a note and a ruler are not edits, so undo leaves them where they are.
- **`scene-transform`** — G, R and S. `G X 2 ↵` moves exactly two metres whatever the pointer did,
  `R Z 90` turns a quarter turn, `S 2` doubles, Escape restores what the session started from, and
  each session leaves exactly one step in the history.
- **`scene-viewport`** — the drawing itself: the first frame under 1.5 s, the counts the renderer
  reports, multisampling, an idle viewport asking for no frames at all, the id buffer finding the
  cube under the middle of the view, and the scene coming back whole after a forced context loss.

Run them together with `docker compose run --rm app npm run e2e -- scene-`; the filter is a
substring of the file name, so `scene-transform` runs the one.

### The helpers a 3D script gets

- `newScene()` — clears the stored scenes, drafts and tabs, reloads, presses **New scene**, waits
  for `.scene-stage` and focuses `#main`. The counterpart of `newDocument()`.
- `scene()` — the stored scene, read from `paramrig.scene-documents.v1` under the route's id.
- `seedScene(build)` — patches the stored scene and reloads, for states too tedious to build by
  hand. `build` is serialised into the page, is handed the stored document and returns the patch;
  it waits for the debug hatch and a first frame before handing the page back, so what follows can
  measure straight away.
- `project3d(point)` — where a world point lands, as `{ x, y, local }`. `x` and `y` are page
  coordinates, ready for `page.mouse`; `local` is the pair the viewport itself answered with.
- `pick(x, y)` — what the id buffer says is under a point, in canvas coordinates.
- `viewportBox()` — the canvas's box on screen, for placing a pointer without guessing at it.

### `window.__paramrigScene`

`src/scene/viewport/debug.ts` installs it, **only in a development build**: a production bundle has
no such object, so nothing here can be pointed at a deployed page. It carries `project`,
`unproject`, `pick`, `pickObject`, `stats`, `frame` (draws one frame and returns what it cost),
`frames`, `invalidateCount`, `bounds`, `firstFrame`, `loseContext` and `restoreContext`.

It also answers the question a selector cannot: whether the viewport is idle. `invalidateCount()`
and `stats().frames` both stand still while nothing happens, which is how `scene-viewport` shows
that a still scene is not quietly burning a GPU.

Wait for it, because it appears when the viewport does, and wait for a frame before measuring:

```js
await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
await page.waitForFunction(() => window.__paramrigScene.frames() > 0, null, { timeout: 15000 })
```

### Traps particular to driving a viewport

- **The middle button is the navigation.** Orbit, pan and zoom are the middle button, plain, with ⇧
  and with ⌃, so a navigation drag is `page.mouse.down({ button: 'middle' })`, a run of `move`s and
  `page.mouse.up({ button: 'middle' })`. `helpers.drag` is the vector editor's: left button, in
  document coordinates, and no use here. ⌥ with the left button orbits as well, which is what a
  script on a machine without a middle button uses — but that emulation is a preference, and the
  navigator remembers having seen a real middle button, so a script that middle-drags first has
  changed the state the ⌥ path is read in.
- **The pointer lock swallows Escape.** A modal transform started from the keyboard locks the
  pointer to `.scene-surface`, so a rotation can pass a full turn; a transform started by dragging a
  gizmo does not. Escape is the browser's own way out of a lock, and the browser keeps the key: the
  editor's handler never sees it. The lock going away *is* the cancel, so Escape still restores the
  transform and a check on the result passes either way — what a script must not assume is that the
  keydown arrived, or that absolute pointer positions mean anything while the lock holds, since the
  moves come through as deltas and the drawn cursor wraps at the edges.
- **A projected point is in canvas coordinates, and the canvas is not the stage.** `project()`
  answers relative to `.scene-viewport`; `.scene-stage` is `#main` and also holds the title bar, the
  header, the toolbar and the status bar — at 1440 × 900 the canvas starts 42 px below the stage and
  stops 32 px above its foot. `helpers.project3d` adds the canvas's origin for you, so its `x` and
  `y` go straight to `page.mouse`; `helpers.pick` and the raw `window.__paramrigScene.pick` want
  canvas coordinates, not page ones.
- **A gesture reaches storage only when it ends.** Nothing is written while a drag or a modal
  transform is open, and the navigator waits a further 120 ms after the input stops before it
  commits the view, so that an intermediate camera position is never the one stored. Read the live
  DOM mid-gesture — the HUD, the modal header, the status bar — and `helpers.scene()` only once the
  pointer is up and a beat has passed.
