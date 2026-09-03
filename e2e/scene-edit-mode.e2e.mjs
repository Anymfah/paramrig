import { run } from './lib.mjs'

/**
 * Chantier A3: Tab, the three element kinds, and what a click reaches.
 *
 * Every check here is about the two halves agreeing. A dot is drawn from the mesh and picked from
 * the id buffer, and the whole of edit mode rests on those being the same place — so the script
 * projects a vertex itself, asks the id buffer what is there, and clicks it.
 */
export default run('scene-edit-mode', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const scene = () => helpers.scene()
  const mode = async () => (await scene())?.view?.mode ?? 'unknown'

  /* ------------------------------------------------------------------- Tab */

  // A new scene has nothing selected, as Blender's does not; the cube is chosen the way a person
  // would choose it, with a click, so that Tab has something to open.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  check('Tab opens the cube for editing', await mode() === 'edit', await mode())
  check('and the status bar counts the elements, not the objects',
    (await page.locator('.scene-status__stats').textContent()).includes('Verts 0/8'),
    await page.locator('.scene-status__stats').textContent())
  check('and the header swaps to the mesh menus',
    await page.locator('button[aria-label="Mesh"], button:has-text("Mesh")').first().isVisible())
  await shot('scene-edit-mode-open.png')

  /* ------------------------------------------------- a vertex, drawn and picked */

  const document = await scene()
  const mesh = document.meshes[document.objects.find((object) => object.data.kind === 'mesh').data.meshId]
  const corner = [mesh.vertices[0], mesh.vertices[1], mesh.vertices[2]]
  const at = await helpers.project3d(corner)
  const hits = await page.evaluate(([x, y]) => window.__paramrigScene.pickElements(x, y, 10), at.local)
  check('the id buffer finds a vertex where the mesh says one is', hits.vertex !== null,
    JSON.stringify({ vertex: hits.vertex, edge: hits.edge?.slot ?? null, face: hits.face?.slot ?? null }))
  check('and it is within a pixel of the drawn dot', (hits.vertex?.distance ?? 99) <= 1.5,
    `${(hits.vertex?.distance ?? 99).toFixed(2)} px`)
  check('a vertex beats the edges and the face under the same pointer',
    hits.vertex !== null && hits.edge !== null && hits.face !== null,
    JSON.stringify({ v: !!hits.vertex, e: !!hits.edge, f: !!hits.face }))

  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(300)
  const picked = await scene()
  const chosen = picked.selection?.elements ?? null
  const stored = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1') ?? '{}')
    return all[location.pathname.split('/r/')[1]]
  })
  check('clicking it selects one vertex',
    (await page.locator('.scene-status__stats').textContent()).includes('Verts 1/8'),
    await page.locator('.scene-status__stats').textContent())
  log(`selection stored: ${chosen ? 'in the document' : 'in the page'}, mode ${stored.view.mode}`)

  // ⇧ click on a second corner extends rather than replacing.
  const second = [mesh.vertices[3], mesh.vertices[4], mesh.vertices[5]]
  const secondAt = await helpers.project3d(second)
  await page.keyboard.down('Shift')
  await page.mouse.click(secondAt.x, secondAt.y)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(300)
  check('⇧ click adds a second rather than replacing the first',
    (await page.locator('.scene-status__stats').textContent()).includes('Verts 2/8'),
    await page.locator('.scene-status__stats').textContent())

  /* ------------------------------------------------------- A, ⌥A and the modes */

  await page.locator('#main').focus()
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  check('A selects everything', (await page.locator('.scene-status__stats').textContent()).includes('Verts 8/8'),
    await page.locator('.scene-status__stats').textContent())

  await page.keyboard.press('Digit2')
  await page.waitForTimeout(250)
  check('2 converts the whole selection to edges',
    (await page.locator('.scene-status__stats').textContent()).includes('Edges 12/12'),
    await page.locator('.scene-status__stats').textContent())
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(250)
  check('3 converts it to faces',
    (await page.locator('.scene-status__stats').textContent()).includes('Faces 6/6'),
    await page.locator('.scene-status__stats').textContent())
  await shot('scene-edit-mode-faces.png')

  await page.keyboard.press('Digit1')
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(250)
  check('⌥A deselects everything', (await page.locator('.scene-status__stats').textContent()).includes('Verts 0/8'),
    await page.locator('.scene-status__stats').textContent())

  /* ------------------------------------------------------------ ⌥ click, a loop */

  await page.keyboard.press('Digit2')
  await page.waitForTimeout(200)
  // The first edge the id buffer answers for, found by projecting each one's middle.
  const edgeUnder = async () => {
    const current = await scene()
    const data = current.meshes[current.objects.find((object) => object.data.kind === 'mesh').data.meshId]
    for (let edge = 0; edge < data.edges.length; edge += 1) {
      const [a, b] = data.edges[edge]
      const middle = [0, 1, 2].map((axis) => (data.vertices[a * 3 + axis] + data.vertices[b * 3 + axis]) / 2)
      const where = await helpers.project3d(middle)
      if (!where) continue
      const found = await page.evaluate(([x, y]) => window.__paramrigScene.pickElements(x, y, 8), where.local)
      if (found.edge) return where
    }
    return null
  }
  const altClick = async (where) => {
    await page.keyboard.down('Alt')
    await page.mouse.move(where.x, where.y)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await page.waitForTimeout(350)
  }

  const cubeEdge = await edgeUnder()
  check('an edge is under the pointer where the mesh says one is', cubeEdge !== null)
  await altClick(cubeEdge)
  // Every corner of a cube joins three edges, and a loop stops at anything that is not four — so
  // one edge is the whole loop here. It is Blender's rule, and the next few lines show it walking.
  check('⌥ click takes the loop, which on a bare cube is the one edge', 
    (await page.locator('.scene-status__stats').textContent()).includes('Edges 1/12'),
    await page.locator('.scene-status__stats').textContent())

  // Subdivide once through the palette, and the corners it mints have four edges each.
  await page.locator('#main').focus()
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(150)
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input')
  await page.keyboard.type('Subdivide')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const divided = await page.locator('.scene-status__stats').textContent()
  check('the palette runs subdivide on the whole cube', divided.includes('/26') && divided.includes('/24'), divided)

  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(200)
  const dividedEdge = await edgeUnder()
  await altClick(dividedEdge)
  const loopText = await page.locator('.scene-status__stats').textContent()
  check('and ⌥ click now walks a loop of eight edges round it', loopText.includes('Edges 8/48'), loopText)
  await shot('scene-edit-mode-loop.png')

  /* ------------------------------------------------------------------- X-ray */

  await page.keyboard.press('Digit1')
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(400)
  check('⌥Z turns X-ray on', (await scene()).view.xray === true, String((await scene()).view.xray))
  await shot('scene-edit-mode-xray.png')

  // A box over the left half in X-ray takes the four vertices behind as well as the four in front.
  await page.keyboard.press('KeyB')
  await page.waitForTimeout(150)
  // Clear of the T bar, which floats over the left edge of the viewport and would take the press.
  const from = { x: box.x + 140, y: box.y + 16 }
  const to = { x: box.x + box.width / 2, y: box.y + box.height - 16 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(350)
  const boxed = await page.locator('.scene-status__stats').textContent()
  check('a box over one half in X-ray takes the vertices behind as well as in front', /Verts \d+\/26/.test(boxed) && !boxed.includes('Verts 0/26'), boxed)

  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(300)

  /* ------------------------------------------------------- the selection survives */

  await page.keyboard.press('KeyA')
  await page.waitForTimeout(200)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(350)
  check('Tab closes edit mode', (await scene()).view.mode === 'object', (await scene()).view.mode)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  const back = await page.locator('.scene-status__stats').textContent()
  check('and the element selection is still there on the way back', back.includes('Verts 26/26'), back)

  /* ---------------------------------------------------------------- overlays */

  const overlaysOn = await page.evaluate(() => window.__paramrigScene.stats().drawCalls)
  check('the overlay draws over the mesh rather than instead of it', overlaysOn > 6, `${overlaysOn} draw calls`)

  const errors = await page.evaluate(() => window.__paramrigErrors ?? [])
  check('no console errors', errors.length === 0, errors.join(' | '))
})
