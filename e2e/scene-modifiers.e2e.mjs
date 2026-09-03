import { run } from './lib.mjs'

/**
 * Chantier H: the modifier stack.
 *
 * What is checked here is the round trip a person actually makes — a chord that adds a modifier,
 * a panel that adds and reorders one, a mesh that is edited under a mirror and cannot cross the
 * seam, and an Apply that leaves the geometry behind and the stack empty. The counts are read from
 * the stored document rather than from the screen, because that is what a saved file will hold.
 */
export default run('scene-modifiers', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  /* ------------------------------------------------------- ⌃2 on the cube */

  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.locator('#main').focus()
  await page.keyboard.press('Control+Digit2')
  await page.waitForTimeout(400)
  let scene = await helpers.scene()
  let cube = scene.objects.find((object) => object.name === 'Cube')
  const subsurf = cube?.modifiers?.[0]
  check('⌃2 puts a subdivision modifier on the cube at level 2',
    subsurf?.kind === 'subsurf' && subsurf.params.levels === 2,
    JSON.stringify(subsurf?.params ?? null))

  // The cube's own mesh is untouched: a modifier is a description, not a change.
  check('and the mesh it is on still has its eight vertices',
    scene.meshes[cube.data.meshId].vertexIds.length === 8,
    `${scene.meshes[cube.data.meshId].vertexIds.length} vertices`)

  // What is drawn is the evaluated mesh, which has far more triangles than the cage.
  const drawn = await page.evaluate(() => window.__paramrigScene.stats())
  check('and the statistics count what is drawn rather than the cage',
    drawn.vertices > 8 && drawn.faces > 6, `${drawn.vertices} vertices, ${drawn.faces} faces`)
  log(`MEASURE with the subdivision on: ${drawn.vertices} vertices, ${drawn.triangles} triangles`)

  await page.keyboard.press('Control+Digit0')
  await page.waitForTimeout(300)
  scene = await helpers.scene()
  check('⌃0 takes it off again',
    scene.objects.find((object) => object.name === 'Cube').modifiers.length === 0,
    JSON.stringify(scene.objects.find((object) => object.name === 'Cube').modifiers))

  /* ------------------------------------------------- the panel: add, fold, reorder */

  await page.locator('.scene-properties__tab[aria-label="Modifiers"]').click()
  await page.waitForSelector('.scene-modifiers')
  await page.locator('.scene-modifiers__add .scene-menu__trigger').click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  const headings = await page.locator('.scene-menu__heading').allTextContents()
  // Modify is Blender's third column and holds nothing this build has yet, so it is not drawn.
  check('the Add menu groups the modifiers by category',
    ['Generate', 'Deform'].every((title) => headings.includes(title)),
    headings.join(', '))
  await page.locator('.scene-menu__item', { hasText: 'Mirror' }).first().click()
  await page.waitForTimeout(400)
  scene = await helpers.scene()
  cube = scene.objects.find((object) => object.name === 'Cube')
  check('choosing Mirror adds it to the stack, with the module’s defaults',
    cube.modifiers.length === 1 && cube.modifiers[0].kind === 'mirror' && cube.modifiers[0].params.axisX === true,
    JSON.stringify(cube.modifiers[0]?.params ?? null))

  // A second one, so there is an order to change.
  await page.locator('.scene-modifiers__add .scene-menu__trigger').click()
  await page.locator('.scene-menu__item', { hasText: 'Array' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.scene-modifier__switches .scene-menu__trigger').last().click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu__item', { hasText: 'Move to first' }).first().click()
  await page.waitForTimeout(400)
  scene = await helpers.scene()
  cube = scene.objects.find((object) => object.name === 'Cube')
  check('the ⋯ menu reorders the stack', cube.modifiers.map((entry) => entry.kind).join(' → ') === 'array → mirror',
    cube.modifiers.map((entry) => entry.kind).join(' → '))

  /* ------------------------------------------------------------ an array of three */

  // A modifier is added unfolded, so its fields are already there to be written into.
  const count = page.locator('.scene-modifier__card', { hasText: 'Array' }).first().getByLabel('Count', { exact: true })
  await count.fill('3')
  await count.press('Enter')
  await page.waitForTimeout(600)
  scene = await helpers.scene()
  cube = scene.objects.find((object) => object.name === 'Cube')
  check('a field written into the panel reaches the document',
    cube.modifiers.find((entry) => entry.kind === 'array').params.count === 3,
    JSON.stringify(cube.modifiers.find((entry) => entry.kind === 'array').params.count))
  await shot('scene-modifiers-array-1440.png')

  /* ------------------------------------------- clipping, while the mesh is edited */

  // Only the mirror is left: an array under an edit would confuse what the numbers mean.
  await page.locator('.scene-modifier__card', { hasText: 'Array' }).first().locator('.scene-modifier__switches .scene-menu__trigger').click()
  await page.locator('.scene-menu__item', { hasText: 'Delete' }).first().click()
  await page.waitForTimeout(300)
  const clipping = page.locator('.scene-modifier__card', { hasText: 'Mirror' }).first().getByRole('switch', { name: 'Clipping' })
  await clipping.click()
  await page.waitForTimeout(300)

  // A corner is dragged across the mirror plane; clipping has to stop it on the plane.
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)
  const before = await helpers.scene()
  const meshId = before.objects.find((object) => object.name === 'Cube').data.meshId
  const corner = await page.evaluate((id) => {
    const mesh = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1'))[location.pathname.split('/r/')[1]].meshes[id]
    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      const x = mesh.vertices[slot * 3]
      if (x > 0) return { id: mesh.vertexIds[slot], point: [x, mesh.vertices[slot * 3 + 1], mesh.vertices[slot * 3 + 2]] }
    }
    return null
  }, meshId)
  const at = await helpers.project3d(corner.point)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(300)
  // Typed rather than dragged: the number is exact, so what is measured is the clipping and not the
  // pointer. The sidebar's median field is the same route a drag takes into the document.
  await page.keyboard.press('KeyG')
  await page.keyboard.press('KeyX')
  await page.keyboard.type('-4')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const after = await helpers.scene()
  const moved = await page.evaluate(([id, vertexId]) => {
    const mesh = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1'))[location.pathname.split('/r/')[1]].meshes[id]
    const slot = mesh.vertexIds.indexOf(vertexId)
    return slot < 0 ? null : mesh.vertices.slice(slot * 3, slot * 3 + 3)
  }, [meshId, corner.id])
  check('clipping stops a vertex on the mirror plane instead of letting it cross',
    moved !== null && Math.abs(moved[0]) < 1e-6, JSON.stringify(moved))
  void after

  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)

  /* --------------------------------------------------------------------- apply */

  const applied = await page.evaluate(() => {
    const scene = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1'))[location.pathname.split('/r/')[1]]
    const cube = scene.objects.find((object) => object.name === 'Cube')
    return scene.meshes[cube.data.meshId].faces.length
  })
  await page.locator('.scene-modifier__card', { hasText: 'Mirror' }).first().locator('.scene-modifier__switches .scene-menu__trigger').click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu__item', { hasText: 'Apply' }).first().click()
  await page.waitForTimeout(600)
  scene = await helpers.scene()
  cube = scene.objects.find((object) => object.name === 'Cube')
  check('Apply writes the result into the mesh and empties the stack',
    cube.modifiers.length === 0 && scene.meshes[cube.data.meshId].faces.length > applied,
    `${applied} faces → ${scene.meshes[cube.data.meshId].faces.length}, ${cube.modifiers.length} modifiers`)
  const status = await page.locator('.scene-status__message').textContent()
  check('and the status bar confirms it', /applied to Cube/.test(status ?? ''), status ?? 'nothing')
  await shot('scene-modifiers-applied-1440.png')
})
