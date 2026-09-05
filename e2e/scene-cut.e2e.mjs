import { run } from './lib.mjs'

/**
 * Chantier D in the browser: ⌃R with its preview, and the bisect that follows it.
 *
 * The loop cut is the one gesture where what is drawn is not what has happened: nothing is cut
 * while the pointer is choosing a ring, and the lines over the mesh are the whole of the feedback.
 * So the script measures that the preview follows the pointer, that it costs what it should, and
 * that the click after it cuts where the lines were.
 */
export default run('scene-cut', async ({ page, check, log, helpers, shot, witness }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const scene = () => helpers.scene()
  const meshOf = async () => {
    const document = await scene()
    return document.meshes[document.objects.find((object) => object.data.kind === 'mesh').data.meshId]
  }
  const counts = async () => {
    const mesh = await meshOf()
    return { vertices: mesh.vertexIds.length, edges: mesh.edges.length, faces: mesh.faces.length }
  }

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)

  /* ------------------------------------------------------------- the preview */

  // An edge the id buffer answers for, so the pointer is over a real ring.
  const mesh = await meshOf()
  let edgeAt = null
  for (let edge = 0; edge < mesh.edges.length && !edgeAt; edge += 1) {
    const [a, b] = mesh.edges[edge]
    const middle = [0, 1, 2].map((axis) => (mesh.vertices[a * 3 + axis] + mesh.vertices[b * 3 + axis]) / 2)
    const where = await helpers.project3d(middle)
    if (!where) continue
    const found = await page.evaluate(([x, y]) => window.__paramrigScene.pickElements(x, y, 8), where.local)
    if (found.edge) edgeAt = where
  }
  await page.mouse.move(edgeAt.x, edgeAt.y)
  await page.waitForTimeout(150)
  await page.locator('#main').focus()
  await page.keyboard.press('Control+KeyR')
  await page.waitForTimeout(300)
  check('⌃R draws the cut it would make', (await page.locator('.scene-tool-path__line').count()) > 0,
    `${await page.locator('.scene-tool-path__line').count()} lines`)
  check('and nothing has been cut yet', (await counts()).faces === 6, JSON.stringify(await counts()))
  const modal = await page.locator('.scene-modal-header').textContent()
  check('and the header says what the pointer and the click do', modal.includes('Move to choose'), modal)
  await shot('scene-cut-preview.png')

  // The wheel asks for more cuts, and more lines appear.
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(200)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(250)
  const lines = await page.locator('.scene-tool-path__line').count()
  check('the wheel asks for three cuts and three lines are drawn', lines === 3, `${lines} lines`)

  // The click settles the ring and hands over to the slide; Enter with a typed factor confirms.
  await page.mouse.move(edgeAt.x, edgeAt.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(350)
  check('the click cuts, and the preview lines are gone',
    (await page.locator('.scene-tool-path__line').count()) === 0 && (await counts()).faces > 6,
    JSON.stringify(await counts()))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const cut = await counts()
  // Three cuts across a ring of four quads: twelve new vertices, and each quad in four.
  check('three loops leave a cube of eighteen faces and twenty vertices',
    cut.faces === 18 && cut.vertices === 20, JSON.stringify(cut))
  await shot('scene-cut-loops.png')

  // One undo takes back the whole cut.
  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(400)
  check('one undo takes the whole loop cut back', (await counts()).faces === 6, JSON.stringify(await counts()))

  /* --------------------------------------------------------------- the speed */

  // A heavy grid, and the preview measured on it: this is the four-millisecond budget.
  await helpers.seedScene((current) => {
    const size = 100
    const vertices = []
    const faces = []
    for (let row = 0; row <= size; row += 1) {
      for (let column = 0; column <= size; column += 1) vertices.push(column - size / 2, row - size / 2, 0)
    }
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const corner = row * (size + 1) + column
        faces.push([corner, corner + 1, corner + size + 2, corner + size + 1])
      }
    }
    const meshId = Object.keys(current.meshes)[0]
    const edges = []
    const seen = new Set()
    for (const loop of faces) {
      for (let index = 0; index < loop.length; index += 1) {
        const a = loop[index]
        const b = loop[(index + 1) % loop.length]
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push([Math.min(a, b), Math.max(a, b)])
      }
    }
    return {
      meshes: {
        ...current.meshes,
        [meshId]: {
          vertices,
          vertexIds: vertices.map((_, index) => index).slice(0, vertices.length / 3),
          edges,
          faces,
          faceIds: faces.map((_, index) => index),
          nextVertexId: vertices.length / 3,
          nextFaceId: faces.length,
          attributes: { vertex: {}, edge: {}, face: { smooth: faces.map(() => false), material: faces.map(() => 0) } },
        },
      },
      view: { ...current.view, mode: 'object', distance: 90 },
    }
  })
  // A is select-all in object mode, which is steadier than a click on a scene that has just loaded.
  await page.locator('#main').focus()
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(800)
  /*
   * A reloaded page settles at its own pace, and A then Tab pressed into it too early selects
   * nothing and opens nothing — which used to show up as a preview over a cube that was never
   * replaced. The mode is what says the pair landed, so it is waited for rather than slept through.
   */
  for (let attempt = 0; attempt < 6 && (await scene()).view.mode !== 'edit'; attempt += 1) {
    await page.locator('#main').focus()
    await page.keyboard.press('KeyA')
    await page.waitForTimeout(250)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(400)
  }
  const heavy = await counts()
  log(`heavy grid: ${heavy.vertices} vertices, ${heavy.faces} faces, mode ${(await scene()).view.mode}`)

  const hover = await page.evaluate(() => {
    const scene = window.__paramrigScene
    const box = document.querySelector('.scene-viewport').getBoundingClientRect()
    const samples = []
    for (let index = 0; index < 40; index += 1) {
      const x = box.width * (0.3 + 0.4 * (index / 40))
      const y = box.height * 0.5
      const started = performance.now()
      scene.pickElements(x, y, 10)
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    return { mean: samples.reduce((total, value) => total + value, 0) / samples.length, p95: samples[Math.floor(samples.length * 0.95)] }
  })
  log(`MEASURE hover over ${heavy.faces} faces: ${hover.mean.toFixed(2)} ms mean, ${hover.p95.toFixed(2)} ms p95`)
  check('the hover pick stays under four milliseconds on ten thousand faces', hover.mean < witness.ms(4),
    `${hover.mean.toFixed(2)} ms against ${witness.against(4)}`)

  // And the whole preview path, which is the number the prompt asks for: the pick, the ring walk,
  // the projection and the drawing, measured as the pointer really drives them.
  await page.mouse.move(centre.x, centre.y)
  await page.waitForTimeout(150)
  await page.locator('#main').focus()
  await page.keyboard.press('Control+KeyR')
  await page.waitForTimeout(300)
  const drawn = await page.locator('.scene-tool-path__line').count()
  check('⌃R previews a ring across the heavy grid', drawn > 0, `${drawn} lines`)
  const preview = await page.evaluate(() => {
    const surface = document.querySelector('.scene-surface')
    const box = surface.getBoundingClientRect()
    const samples = []
    for (let index = 0; index < 30; index += 1) {
      const x = box.left + box.width * (0.35 + 0.3 * (index / 30))
      const y = box.top + box.height * (0.4 + 0.2 * (index / 30))
      const started = performance.now()
      surface.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 0,
      }))
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    return { mean: samples.reduce((total, value) => total + value, 0) / samples.length, p95: samples[Math.floor(samples.length * 0.95)] }
  })
  log(`MEASURE loop cut preview over ${heavy.faces} faces: ${preview.mean.toFixed(2)} ms mean, ${preview.p95.toFixed(2)} ms p95`)
  check('and the preview follows the pointer in under four milliseconds', preview.mean < witness.ms(4),
    `${preview.mean.toFixed(2)} ms mean, ${preview.p95.toFixed(2)} ms p95, against ${witness.against(4)}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  check('Escape leaves the grid uncut', (await counts()).faces === heavy.faces, JSON.stringify(await counts()))

  /* ---------------------------------------------------------------- the knife */

  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  const beforeKnife = await counts()

  await page.keyboard.press('KeyK')
  await page.waitForTimeout(250)
  // The stored copy is written on a debounce; the bar is the live answer.
  const pressed = await page.locator('.scene-toolbar button[aria-pressed="true"]').first().getAttribute('aria-label')
  check('K picks up the knife', (pressed ?? '').includes('Knife'), pressed ?? 'nothing pressed')

  // A line straight across the cube, placed with two clicks and confirmed with Enter.
  await page.mouse.move(centre.x - 200, centre.y)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.mouse.move(centre.x, centre.y)
  await page.waitForTimeout(150)
  const drawnKnife = await page.locator('.scene-tool-path[data-kind="knife"] .scene-tool-path__line').count()
  check('the line follows the pointer from the point that was placed', drawnKnife > 0, `${drawnKnife} lines`)
  const snapping = await page.locator('.scene-tool-path__snap').count()
  check('and it shows where it would snap when it is over the mesh', snapping > 0, `${snapping} markers`)
  await shot('scene-cut-knife.png')
  await page.mouse.move(centre.x + 200, centre.y)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const knifed = await counts()
  check('Enter cuts along the line, and the faces it crossed are split',
    knifed.faces > beforeKnife.faces && knifed.vertices > beforeKnife.vertices,
    JSON.stringify({ before: beforeKnife, after: knifed }))
  check('and the line is gone from the screen', (await page.locator('.scene-tool-path__line').count()) === 0)

  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(400)
  check('one undo takes the whole cut back', JSON.stringify(await counts()) === JSON.stringify(beforeKnife),
    JSON.stringify(await counts()))

  /* ----------------------------------------------------------- poly build */

  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)
  await page.keyboard.press('KeyX')
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu[role="menu"] [role="menuitem"]', { hasText: 'Faces' }).first().click()
  await page.waitForTimeout(400)
  const holed = await counts()
  check('a face is taken off the cube to build against', holed.faces === 5, JSON.stringify(holed))

  // Poly build from the T bar, on one of the border edges the hole left.
  await page.locator('.scene-toolbar button[aria-label="Poly build"]').click({ force: true })
  await page.waitForTimeout(300)
  await page.keyboard.press('Digit2')
  await page.waitForTimeout(200)
  const open = await meshOf()
  let borderAt = null
  for (let edge = 0; edge < open.edges.length && !borderAt; edge += 1) {
    const users = open.faces.filter((loop) => {
      const [a, b] = open.edges[edge]
      const at = loop.indexOf(a)
      return at >= 0 && (loop[(at + 1) % loop.length] === b || loop[(at + loop.length - 1) % loop.length] === b)
    })
    if (users.length !== 1) continue
    const [a, b] = open.edges[edge]
    const middle = [0, 1, 2].map((axis) => (open.vertices[a * 3 + axis] + open.vertices[b * 3 + axis]) / 2)
    const where = await helpers.project3d(middle)
    if (!where) continue
    const found = await page.evaluate(([x, y]) => window.__paramrigScene.pickElements(x, y, 8), where.local)
    if (found.edge) borderAt = where
  }
  check('a border edge is under the pointer', borderAt !== null)
  await page.mouse.move(borderAt.x, borderAt.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(500)
  const built = await counts()
  check('poly build pulls a face out of it', built.faces === holed.faces + 1 && built.vertices === holed.vertices + 1,
    `${JSON.stringify(holed)} → ${JSON.stringify(built)} — ${await page.locator('.scene-status__message').textContent()}`)
  await shot('scene-cut-poly-build.png')

  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(400)
  check('and one undo takes it back', (await counts()).faces === holed.faces, JSON.stringify(await counts()))

  const errors = await page.evaluate(() => window.__paramrigErrors ?? [])
  check('no console errors of our own', errors.length === 0, errors.join(' | '))
})
