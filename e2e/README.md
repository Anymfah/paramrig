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
