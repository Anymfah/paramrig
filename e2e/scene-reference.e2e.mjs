import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, BASE } from './lib.mjs'

/**
 * The reference record of the 3D editor: the five captures the roadmap asks for, and the numbers
 * that say whether it is still fast enough to use.
 *
 * Every measurement is also a check against the budget of section 7 of the plan — 16 ms mean and
 * 33 ms p95 on a gesture, under 4 ms on a hover pick, the first frame under 1.5 s, a hundred
 * history steps under 200 MB — so a regression fails the run instead of being written quietly into
 * a file that nobody diffs.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'reference', 'scene')

const ORBIT_MOVES = 200
const PICK_SAMPLES = 100
const HISTORY_STEPS = 100

/* --------------------------------------------------------------- the scene */

/**
 * A heightfield of quads, built inside the page because it is far too large to hand across the
 * bridge. 224 quads a side is 50 176 quads, which is 100 352 triangles once the renderer splits
 * them. Positions are sixteenths and quarters: a binary fraction prints as four digits, where a
 * tenth would print as 0.30000000000000004 and treble the size of the stored document.
 */
const buildHeavyScene = (stored) => {
  const side = 224
  const span = side + 1
  const vertices = []
  const vertexIds = []
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      vertices.push((column - side / 2) / 16, (row - side / 2) / 16, ((column * 7 + row * 13) % 5) / 4)
      vertexIds.push(row * span + column)
    }
  }
  const edges = []
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      const slot = row * span + column
      if (column + 1 < span) edges.push([slot, slot + 1])
      if (row + 1 < span) edges.push([slot, slot + span])
    }
  }
  const faces = []
  const faceIds = []
  const smooth = []
  const material = []
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const slot = row * span + column
      // Wound counter-clockwise seen from +Z, which is the outside of a floor.
      faces.push([slot, slot + 1, slot + span + 1, slot + span])
      faceIds.push(faceIds.length)
      smooth.push(false)
      material.push(0)
    }
  }
  return {
    objects: [
      ...stored.objects,
      {
        id: 'object-heavy-grid',
        name: 'Heavy grid',
        kind: 'mesh',
        collectionId: stored.collections[0].id,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-heavy-grid' },
        modifiers: [],
        materialSlots: [],
      },
    ],
    meshes: {
      ...stored.meshes,
      'mesh-heavy-grid': {
        vertices,
        vertexIds,
        nextVertexId: span * span,
        edges,
        faces,
        faceIds,
        nextFaceId: faces.length,
        attributes: { face: { smooth, material }, edge: {}, vertex: {} },
      },
    },
  }
}

/* ---------------------------------------------------------------- numbers */

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length

/** The nearest-rank percentile: with 200 samples the 95th is the 190th smallest, not an average. */
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]
}

const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export default run('scene-reference', async ({ page, check, log, helpers }) => {
  mkdirSync(DIR, { recursive: true })
  const shot = (file) => page.screenshot({ path: join(DIR, file) })

  /*
   * An editor with an autosave still pending asks before it is navigated away from, and the two
   * fresh scenes below navigate away from one. Playwright dismisses such a dialog on its own, but
   * its answer races the dialog closing itself and the loser throws out of an event handler, past
   * the harness's try, and takes the process with it. Answering it here is what stops that.
   */
  page.on('dialog', (dialog) => { dialog.accept().catch(() => undefined) })

  /** Long enough for the 800 ms autosave to have written, so that nothing asks on the way out. */
  const settle = () => page.waitForTimeout(1400)

  const measures = []
  const record = (label, value) => {
    measures.push(`${label}: ${value}`)
    log(`MEASURE ${label}: ${value}`)
  }

  /**
   * A control is one thing a person can press. A menu trigger, a toggle and a chevron each count
   * once; the popover a trigger opens is not in the bar, so it is not counted with it. The width
   * and the fold come back with the count because they are what explains it: under 720 px the
   * header puts every view setting behind one button, and the count drops accordingly.
   */
  const headerControls = () => page.evaluate(() => {
    const bar = document.querySelector('.scene-header')
    if (!bar) return { controls: 0, width: 0, folded: false }
    const room = document.documentElement.clientWidth
    const drawn = [...bar.querySelectorAll('button, [role="button"], input:not([type="file"])')]
      .filter((node) => node.offsetParent !== null && node.getBoundingClientRect().width > 0)
    return {
      controls: drawn.length,
      onScreen: drawn.filter((node) => node.getBoundingClientRect().right <= room).length,
      width: Math.round(bar.getBoundingClientRect().width),
      folded: !!bar.querySelector('[aria-label="View settings"]'),
    }
  })

  const propertiesBody = () => page.evaluate(() => {
    const body = document.querySelector('.scene-properties__body')
    if (!body) return { content: 0, visible: 0, sections: 0 }
    return {
      content: Math.round(body.scrollHeight),
      visible: Math.round(body.clientHeight),
      sections: body.querySelectorAll('.scene-section').length,
    }
  })

  /** The theme is a stored preference, so a capture that must be dark says so rather than hoping. */
  const useTheme = async (theme) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((value) => {
      localStorage.setItem('paramrig.theme', value)
      document.documentElement.dataset.theme = value
      document.documentElement.style.colorScheme = value
    }, theme)
    await page.waitForTimeout(400)
  }

  const selectCube = async () => {
    const box = await helpers.viewportBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(350)
  }

  /** The tab is a remembered preference, so every capture chooses it rather than inheriting it. */
  const openTab = async (name) => {
    await page.locator(`.scene-properties__tab[aria-label="${name}"]`).click()
    await page.waitForTimeout(300)
  }

  /* ------------------------------------------------------- the empty scene */

  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 20000 })
  await page.waitForFunction(() => window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await useTheme('dark')

  const firstFrame = await page.evaluate(() => window.__paramrigScene.firstFrame())
  record('time to the first frame', firstFrame === null ? 'not reported' : `${firstFrame.toFixed(0)} ms`)
  check('the first frame is drawn inside the 1.5 s budget', firstFrame !== null && firstFrame < 1500,
    firstFrame === null ? 'the viewport never marked a first frame' : `${firstFrame.toFixed(0)} ms`)

  const wide = await headerControls()
  record('header controls at 1440', wide.controls)
  record('header controls within the window at 1440', wide.onScreen)
  record('header width at 1440', `${wide.width}px`)
  record('header view settings folded at 1440', wide.folded ? 'yes' : 'no')
  check('the header at 1440 was measured', wide.controls > 0, `${wide.controls} controls in ${wide.width}px`)

  const startupStats = await page.evaluate(() => window.__paramrigScene.stats())
  record('startup scene draw calls', startupStats.drawCalls)
  record('startup scene triangles', startupStats.triangles)
  check('the startup scene reports its draw calls and triangles',
    startupStats.drawCalls > 0 && startupStats.triangles > 0,
    `${startupStats.drawCalls} calls, ${startupStats.triangles} triangles`)

  await openTab('Object')
  await shot('empty-1440.png')

  /* ----------------------------------------------------- the selected cube */

  await selectCube()
  const counted = await page.locator('.scene-status__stats').textContent()
  check('the cube is selected for the reference captures', counted.includes('Objects 1/3'), counted)

  await openTab('Object')
  const properties = await propertiesBody()
  record('object properties content height', `${properties.content}px`)
  record('object properties visible height', `${properties.visible}px`)
  record('object properties sections', properties.sections)
  check('the Object tab has content for a selected cube', properties.content > 0 && properties.sections > 0,
    `${properties.content}px over ${properties.sections} sections`)

  await shot('cube-selected-1440.png')

  /* ---------------------------------------------------------- the hover pick */

  const cubeAt = await page.evaluate(() => window.__paramrigScene.project([0, 0, 0]))
  const picks = await page.evaluate(([origin, samples]) => {
    const durations = []
    let hits = 0
    for (let index = 0; index < samples; index += 1) {
      // A small ring over the cube's near face, so every sample lands on geometry rather than sky.
      const angle = (index / samples) * Math.PI * 2
      const x = origin[0] + Math.cos(angle) * 24
      const y = origin[1] + Math.sin(angle) * 24
      const started = performance.now()
      const picked = window.__paramrigScene.pick(x, y)
      durations.push(performance.now() - started)
      if (picked) hits += 1
    }
    return { durations, hits }
  }, [cubeAt, PICK_SAMPLES])
  const pickMean = mean(picks.durations)
  record('hover pick mean over 100 picks', `${pickMean.toFixed(2)} ms`)
  record('hover pick p95 over 100 picks', `${percentile(picks.durations, 0.95).toFixed(2)} ms`)
  record('hover picks that landed on the cube', `${picks.hits}/${PICK_SAMPLES}`)
  check('a hover pick stays under the 4 ms budget', pickMean < 4, `${pickMean.toFixed(2)} ms mean`)
  check('and every pick landed on something', picks.hits === PICK_SAMPLES, `${picks.hits}/${PICK_SAMPLES}`)

  /* ------------------------------------------------------------ the themes */

  await useTheme('light')
  await shot('cube-selected-1440-light.png')
  check('the light theme was captured',
    await page.evaluate(() => document.documentElement.dataset.theme) === 'light',
    await page.evaluate(() => document.documentElement.dataset.theme))
  await useTheme('dark')

  /* ------------------------------------------------------------ the narrow */

  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(600)
  await shot('cube-selected-320.png')
  const narrow = await headerControls()
  record('header controls at 320', narrow.controls)
  record('header controls within the window at 320', narrow.onScreen)
  record('header width at 320', `${narrow.width}px`)
  record('header view settings folded at 320', narrow.folded ? 'yes' : 'no')
  check('the narrow header was measured', narrow.controls > 0, `${narrow.controls} controls in ${narrow.width}px`)
  check('and it folds rather than overflowing', narrow.controls <= wide.controls && narrow.folded,
    `${narrow.controls} at 320 against ${wide.controls} at 1440`)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  /* ------------------------------------------------------------ the gizmos */

  await helpers.seedScene((stored) => ({
    view: { ...stored.view, gizmos: { ...stored.view.gizmos, move: true } },
  }))
  await useTheme('dark')
  await selectCube()
  await shot('gizmos-1440.png')
  const gizmos = (await helpers.scene()).view.gizmos
  check('the move gizmo is on for its capture', gizmos.move === true, JSON.stringify(gizmos))

  /* ------------------------------------------------- a hundred history steps */

  await settle()
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await useTheme('dark')
  await selectCube()
  const heapBefore = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null))

  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.locator('#main').focus()
  await page.mouse.move(centre.x, centre.y)
  for (let step = 0; step < HISTORY_STEPS; step += 1) {
    /*
     * G X 1 ↵ is one move of exactly a metre, and one named entry in the history. The HUD is
     * waited on either side of it: a key sent before the session has opened, or a G sent while
     * the last one is still closing, is a keystroke the editor never sees, and the run would
     * quietly end up with ninety-nine edits.
     */
    await page.keyboard.press('KeyG')
    await page.waitForSelector('.scene-hud', { state: 'attached' })
    await page.keyboard.press('KeyX')
    await page.keyboard.press('Digit1')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.scene-hud', { state: 'detached' })
  }
  await page.waitForTimeout(1200)
  const heapAfter = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null))

  await openTab('History')
  const steps = await page.locator('.scene-history__step').count()
  record('history steps after a hundred moves', steps)
  const movedTo = (await helpers.scene()).objects.find((object) => object.name === 'Cube')
  check('a hundred moves leave a hundred history steps', steps >= HISTORY_STEPS, `${steps} steps`)
  check('and the cube has travelled a hundred metres',
    Math.abs(movedTo.transform.position[0] - HISTORY_STEPS) < 1e-6,
    JSON.stringify(movedTo.transform.position))

  if (heapBefore === null || heapAfter === null) {
    const line = 'this browser does not report performance.memory'
    record('heap before a hundred history steps', line)
    record('heap after a hundred history steps', line)
    record('heap growth over a hundred history steps', line)
    check('the heap over a hundred history steps was reported', false, line)
  } else {
    const growth = heapAfter - heapBefore
    record('heap before a hundred history steps', megabytes(heapBefore))
    record('heap after a hundred history steps', megabytes(heapAfter))
    record('heap growth over a hundred history steps', megabytes(growth))
    check('a hundred history steps stay inside the 200 MB budget', growth < 200 * 1024 * 1024, megabytes(growth))
  }

  /* --------------------------------------------------- the orbit under load */

  await settle()
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await useTheme('dark')
  await helpers.seedScene(buildHeavyScene)
  const heavyStats = await page.evaluate(() => window.__paramrigScene.stats())
  record('heavy scene triangles', heavyStats.triangles)
  record('heavy scene draw calls', heavyStats.drawCalls)
  check('the heavy scene really is about a hundred thousand triangles',
    heavyStats.triangles > 95000 && heavyStats.triangles < 105000, `${heavyStats.triangles} triangles`)

  const heavyBox = await helpers.viewportBox()
  const heavyCentre = { x: heavyBox.x + heavyBox.width / 2, y: heavyBox.y + heavyBox.height / 2 }
  const radius = Math.min(heavyBox.width, heavyBox.height) / 6

  /*
   * Three clocks, because one would lie.
   *
   * `work` is what the roadmap budgets: how long the page spends inside a frame callback, which is
   * where the viewport draws. `marks` is the cadence the frames actually came at, which says
   * whether 60 frames a second held. The wall clock around each `page.mouse.move`, taken below,
   * is the gesture end to end, and carries the CDP round trip and Chrome's own input pipeline on
   * top of the other two — which is why it is read last and read against the frame time.
   */
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window)
    window.__orbit = { work: [], marks: [], stop: false }
    window.__orbitRestore = () => {
      window.__orbit.stop = true
      window.requestAnimationFrame = original
    }
    window.requestAnimationFrame = (callback) => original((time) => {
      const started = performance.now()
      callback(time)
      window.__orbit.work.push(performance.now() - started)
    })
    // Driven through the untouched original, so the cadence probe never times itself.
    const tick = (time) => {
      window.__orbit.marks.push(time)
      if (!window.__orbit.stop) original(tick)
    }
    original(tick)
  })

  const moveTimes = []
  await page.mouse.move(heavyCentre.x + radius, heavyCentre.y)
  await page.mouse.down({ button: 'middle' })
  for (let index = 1; index <= ORBIT_MOVES; index += 1) {
    // Two turns of an ellipse: yaw and pitch both change on every move, as they do in a real orbit.
    const angle = (index / ORBIT_MOVES) * Math.PI * 4
    const started = performance.now()
    await page.mouse.move(heavyCentre.x + Math.cos(angle) * radius, heavyCentre.y + Math.sin(angle) * radius * 0.5)
    moveTimes.push(performance.now() - started)
  }
  await page.mouse.up({ button: 'middle' })
  const orbit = await page.evaluate(() => {
    window.__orbitRestore()
    const { work, marks } = window.__orbit
    delete window.__orbit
    delete window.__orbitRestore
    const intervals = []
    for (let index = 1; index < marks.length; index += 1) intervals.push(marks[index] - marks[index - 1])
    return { work, intervals }
  })

  check('the orbit actually drew frames', orbit.work.length > 0, `${orbit.work.length} frames`)
  const workMean = mean(orbit.work)
  const workP95 = percentile(orbit.work, 0.95)
  record('orbit frames drawn over 200 moves', orbit.work.length)
  record('orbit frame time mean', `${workMean.toFixed(2)} ms`)
  record('orbit frame time p95', `${workP95.toFixed(2)} ms`)
  check('an orbit over a hundred thousand triangles holds a 16 ms mean frame', workMean <= 16, `${workMean.toFixed(2)} ms`)
  check('and a 33 ms p95 frame', workP95 <= 33, `${workP95.toFixed(2)} ms`)

  const cadenceMean = mean(orbit.intervals)
  record('orbit frame interval mean', `${cadenceMean.toFixed(2)} ms`)
  record('orbit frame interval p95', `${percentile(orbit.intervals, 0.95).toFixed(2)} ms`)
  check('and the frames keep coming at the display’s own rate', cadenceMean <= 33, `${cadenceMean.toFixed(2)} ms`)

  const moveMean = mean(moveTimes)
  const moveP95 = percentile(moveTimes, 0.95)
  record('orbit move-to-move mean over 200 moves', `${moveMean.toFixed(2)} ms`)
  record('orbit move-to-move p95 over 200 moves', `${moveP95.toFixed(2)} ms`)
  // The noisiest of the three, and the only one measured from outside: a busy host shows up here
  // first. A failure worth acting on is one the frame time above agrees with.
  check('the whole gesture, round trip included, holds the 16 ms mean', moveMean <= 16, `${moveMean.toFixed(2)} ms`)
  check('and its 33 ms p95', moveP95 <= 33, `${moveP95.toFixed(2)} ms`)

  writeFileSync(join(DIR, 'measurements.txt'), `${measures.join('\n')}\n`)
  log(`Saved to e2e/reference/scene from ${BASE}`)
})
