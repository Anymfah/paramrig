import { run } from './lib.mjs'

/**
 * Chantier E in the browser: the operators that take geometry away and put it back.
 *
 * These are menu-driven rather than gestural, so the script drives them the way a person would —
 * through M, X, F and P, and through the menus those keys open — and checks the counts the
 * document ends up with rather than the pixels.
 */
export default run('scene-merge-fill', async ({ page, check, log, helpers, shot }) => {
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
  const menuEntry = async (key, label) => {
    await page.locator('#main').focus()
    await page.keyboard.press(key)
    await page.waitForSelector('.scene-menu[role="menu"]')
    await page.locator('.scene-menu[role="menu"] [role="menuitem"]', { hasText: label }).first().click()
    await page.waitForTimeout(500)
  }

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit1')
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  check('the cube is open with every vertex selected', (await counts()).vertices === 8, JSON.stringify(await counts()))

  /* -------------------------------------------------------------------- merge */

  await menuEntry('KeyM', 'At centre')
  const merged = await counts()
  check('M at centre welds the whole cube to one vertex', merged.vertices === 1 && merged.faces === 0,
    JSON.stringify(merged))
  const message = await page.locator('.scene-status__message').textContent()
  check('and the status bar says how many went', /remov/i.test(message), message)
  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(400)
  check('one undo puts the cube back', (await counts()).vertices === 8, JSON.stringify(await counts()))

  /* ------------------------------------------------------------------ dissolve */

  await page.keyboard.press('Digit2')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(200)
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(200)
  // One edge, found through the id buffer, dissolved into the two faces it held apart.
  const current = await meshOf()
  let edgeAt = null
  for (let edge = 0; edge < current.edges.length && !edgeAt; edge += 1) {
    const [a, b] = current.edges[edge]
    const middle = [0, 1, 2].map((axis) => (current.vertices[a * 3 + axis] + current.vertices[b * 3 + axis]) / 2)
    const where = await helpers.project3d(middle)
    if (!where) continue
    const found = await page.evaluate(([x, y]) => window.__paramrigScene.pickElements(x, y, 8), where.local)
    if (found.edge) edgeAt = where
  }
  await page.mouse.click(edgeAt.x, edgeAt.y)
  await page.waitForTimeout(300)
  await menuEntry('KeyX', 'Dissolve edges')
  const dissolved = await counts()
  // The edge goes and its two quads become one; the two corners it left with only two edges each go
  // with it, which is what "dissolve vertices" does and why a hexagon comes out as a quad.
  check('X then Dissolve edges merges the two faces into one',
    dissolved.faces === 5 && dissolved.vertices === 6, JSON.stringify(dissolved))
  await shot('scene-merge-fill-dissolved.png')

  /* --------------------------------------------------------------------- fill */

  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(200)
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)
  await menuEntry('KeyX', 'Faces')
  const holed = await counts()
  check('deleting one face leaves a hole and every vertex where it was',
    holed.faces === 5 && holed.vertices === 8 && holed.edges === 12, JSON.stringify(holed))
  await page.keyboard.press('Digit1')
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  await page.keyboard.press('KeyF')
  await page.waitForTimeout(700)
  const filled = await counts()
  check('F closes the hole again', filled.faces === 6 && filled.vertices === 8,
    `${JSON.stringify(filled)} — ${await page.locator('.scene-status__message').textContent()}`)

  /* ----------------------------------------------------------------- separate */

  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(200)
  const beforeSeparate = (await scene()).objects.length
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)
  await menuEntry('KeyP', 'Separate')
  const after = await scene()
  check('P separates the selected face into an object of its own',
    after.objects.length === beforeSeparate + 1, `${beforeSeparate} → ${after.objects.length} objects`)
  const outliner = await page.locator('.scene-outliner [role="treeitem"]').allTextContents()
  check('and the outliner shows it', outliner.length >= after.objects.length - 1, outliner.join(', '))
  await shot('scene-merge-fill-separated.png')

  const errors = await page.evaluate(() => window.__paramrigErrors ?? [])
  check('no console errors of our own', errors.length === 0, errors.join(' | '))
})
