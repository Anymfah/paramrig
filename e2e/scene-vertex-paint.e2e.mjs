import { run } from './lib.mjs'

/**
 * Chantier T: vertex paint.
 *
 * A colour attribute is a value a vertex or a corner carries, and everything worth checking follows
 * from that: a stroke changes the values under the brush and no others, the fill changes all of
 * them, solid shading in "attribute" shows what was painted, and the file that leaves carries it.
 */

/** A grid to paint on, big enough that a brush covers a knowable part of it. */
const buildSlab = (stored) => {
  const side = 40
  const span = side + 1
  const vertices = []
  const vertexIds = []
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      vertices.push(column - side / 2, row - side / 2, 0)
      vertexIds.push(row * span + column)
    }
  }
  const faces = []
  const faceIds = []
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const slot = row * span + column
      faces.push([slot, slot + 1, slot + span + 1, slot + span])
      faceIds.push(faceIds.length)
    }
  }
  return {
    objects: [{
      id: 'object-slab',
      name: 'Slab',
      kind: 'mesh',
      collectionId: stored.collections[0].id,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [8 / side, 8 / side, 8 / side] },
      visible: true,
      selectable: true,
      renderable: true,
      data: { kind: 'mesh', meshId: 'mesh-slab' },
      modifiers: [],
      materialSlots: [stored.materials[0].id],
    }, ...stored.objects.filter((object) => object.kind !== 'mesh')],
    meshes: {
      'mesh-slab': {
        vertices,
        vertexIds,
        nextVertexId: span * span,
        edges: [],
        faces,
        faceIds,
        nextFaceId: faces.length,
        attributes: { face: { smooth: faces.map(() => true), material: faces.map(() => 0) }, edge: {}, vertex: {} },
      },
    },
    view: { ...stored.view, mode: 'object', target: [0, 0, 0], yaw: 0, pitch: 89, distance: 12 },
  }
}

/** The mesh's colour attribute, whichever domain it is on, or nothing when it carries none. */
const coloursOf = async (helpers) => {
  const document = await helpers.scene()
  const mesh = document.meshes['mesh-slab']
  return mesh.attributes.loop?.color ?? mesh.attributes.vertex?.color ?? null
}

export default run('scene-vertex-paint', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await helpers.seedScene(buildSlab)
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })

  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(400)

  /* --------------------------------------------------------------- the mode */

  await page.locator('button.scene-header__mode').click()
  await page.locator('[role="menuitemradio"]', { hasText: 'Vertex paint' }).click()
  await page.waitForTimeout(700)
  check('the header opens vertex paint mode', (await helpers.scene()).view.mode === 'vertex-paint',
    (await helpers.scene()).view.mode)
  const bar = await page.locator('.scene-toolbar').getAttribute('aria-label')
  check('and the tool bar offers the paint brushes rather than the mesh tools', bar === 'Vertex paint brushes', bar ?? 'no bar')

  const hints = await page.locator('.scene-status__hints').innerText()
  check('and the status bar says what the pointer does now',
    /Paint/.test(hints) && /Fill/.test(hints), hints.replace(/\n/g, ' '))

  check('the mesh starts with no colour at all', (await coloursOf(helpers)) === null, 'none')

  /* ------------------------------------------------------------- one stroke */

  await page.locator('#main').focus()
  await page.mouse.move(centre.x - 60, centre.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(centre.x - 60 + step * 12, centre.y)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
  await page.waitForTimeout(900)

  const painted = await coloursOf(helpers)
  check('a stroke gives the mesh a colour attribute', !!painted, painted ? `${painted.length / 3} values` : 'none')
  const changed = painted ? painted.filter((value, index) => index % 3 === 0 && value < 0.999).length : 0
  const total = painted ? painted.length / 3 : 0
  check('and paints under the brush rather than over the whole mesh',
    changed > 20 && changed < total * 0.6, `${changed} of ${total} values touched`)
  log(`MEASURE one stroke: ${changed} of ${total} values painted`)

  /* ------------------------------------------------------- what it looks like */

  const shown = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1') ?? '{}')
    const id = location.pathname.split('/r/')[1]
    const document = store[id]
    document.view.solid = { ...(document.view.solid ?? {}), colour: 'attribute' }
    store[id] = document
    localStorage.setItem('paramrig.scene-documents.v1', JSON.stringify(store))
    return document.view.solid.colour
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.scene-stage')
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  check('solid shading takes "attribute" as one of its colours', shown === 'attribute', shown)
  await shot('scene-vertex-paint-1440.png')

  /*
   * The reload keeps the mode and the mesh, but a page that has just opened has nothing selected —
   * and a click in paint mode paints rather than selects, as Blender's does. So the object is
   * chosen in object mode and the mode is entered again, which is what a person would do.
   */
  await page.locator('button.scene-header__mode').click()
  await page.locator('[role="menuitemradio"]', { hasText: 'Object mode' }).click()
  await page.waitForTimeout(500)
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(400)
  await page.locator('button.scene-header__mode').click()
  await page.locator('[role="menuitemradio"]', { hasText: 'Vertex paint' }).click()
  await page.waitForTimeout(600)

  /* ------------------------------------------------------------- the fill */

  await page.locator('#main').focus()
  await page.keyboard.press('Shift+KeyK')
  await page.waitForTimeout(800)
  const filled = await coloursOf(helpers)
  const uniform = filled ? filled.every((value, index) => Math.abs(value - filled[index % 3]) < 1e-6) : false
  check('⇧K fills every value with the brush colour', uniform,
    filled ? `${filled.length / 3} values, ${uniform ? 'all alike' : 'still uneven'}` : 'none')

  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(700)
  const back = await coloursOf(helpers)
  const stillPainted = back ? back.filter((value, index) => index % 3 === 0 && value < 0.999).length : 0
  check('and one undo brings the stroke back', stillPainted > 20 && stillPainted < total * 0.6,
    `${stillPainted} of ${total} values painted`)

  /* ------------------------------------------------------------- the export */

  // A GLB carries its JSON in the first chunk, so the head is enough to read what it declares.
  const glb = await helpers.captureDownload(async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    await page.locator('.scene-file__button').click()
    await page.waitForSelector('.scene-file-menu')
    await page.locator('.menu__item', { hasText: 'Export glTF' }).first().click()
  }, 8192)
  const json = glb ? String.fromCharCode(...glb.head) : ''
  check('the glTF that leaves declares the colours as COLOR_0',
    /COLOR_0/.test(json), glb ? `${glb.download} · ${glb.size} bytes` : 'no file')

})
