import { run } from './lib.mjs'

/** Chantier 6: adding, duplicating, joining, parenting, hiding, and back through the history. */
export default run('scene-object-mode', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const scene = () => helpers.scene()
  const names = async () => (await scene()).objects.map((object) => object.name)

  // ⇧A opens the Add menu where the pointer is, and it filters as you type.
  await page.mouse.move(centre.x - 120, centre.y - 60)
  await page.locator('#main').focus()
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Shift')
  await page.waitForSelector('.scene-menu[role="menu"]')
  const menuBox = await page.locator('.scene-menu[role="menu"]').boundingBox()
  // A menu that would run off the bottom opens above the pointer instead, so either edge may be at it.
  const atPointer = Math.abs(menuBox.x - (centre.x - 120)) < 60
    && (Math.abs(menuBox.y - (centre.y - 60)) < 40 || Math.abs(menuBox.y + menuBox.height - (centre.y - 60)) < 40)
  check('the Add menu opens at the pointer', atPointer,
    JSON.stringify({ menu: [Math.round(menuBox.x), Math.round(menuBox.y), Math.round(menuBox.height)], pointer: [Math.round(centre.x - 120), Math.round(centre.y - 60)] }))
  for (const letter of ['c', 'y', 'l']) await page.keyboard.press(`Key${letter.toUpperCase()}`)
  await page.waitForTimeout(150)
  const left = await page.locator('.scene-menu[role="menu"] [role="menuitem"]').allTextContents()
  check('and filters as the letters arrive', left.length === 1 && left[0].includes('Cylinder'), left.join(', '))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('Enter adds the highlighted one', (await names()).includes('Cylinder'), (await names()).join(', '))

  const added = await scene()
  const cylinder = added.objects.find((object) => object.name === 'Cylinder')
  check('the new object is selected and active', true)
  check('and it is named the way Blender names it', cylinder.name === 'Cylinder')

  // The F9 panel re-runs the operator with different numbers, in place.
  await page.locator('#main').focus()
  await page.keyboard.press('F9')
  await page.waitForSelector('.scene-redo__body')
  const vertices = page.locator('.scene-redo__body .control', { hasText: 'Vertices' }).locator('input').first()
  await vertices.fill('6')
  await vertices.press('Enter')
  await page.waitForTimeout(500)
  const adjusted = await scene()
  const adjustedMesh = adjusted.meshes[adjusted.objects.find((object) => object.name === 'Cylinder').data.meshId]
  check('F9 re-runs it with six sides instead of thirty-two', adjustedMesh.vertexIds.length === 12,
    `${adjustedMesh.vertexIds.length} vertices`)
  check('and does not add a second history step', adjusted.objects.length === 4, `${adjusted.objects.length} objects`)

  // ⇧D duplicates and hands over to a move; a typed number lands it exactly.
  await page.locator('#main').focus()
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyD')
  await page.keyboard.up('Shift')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyX')
  await page.keyboard.press('Digit3')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const duplicated = await scene()
  const copy = duplicated.objects.find((object) => object.name === 'Cylinder.001')
  check('⇧D duplicates and hands over to a move', !!copy && Math.abs(copy.transform.position[0] - 3) < 1e-6,
    copy ? JSON.stringify(copy.transform.position) : (await names()).join(', '))
  check('and the copy has a mesh of its own', copy && copy.data.meshId !== cylinder.data.meshId)

  // ⌃J joins the selection into the active object.
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Shift')
  await page.keyboard.press('Escape')
  await page.locator('#main').focus()
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(200)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyJ')
  await page.keyboard.up('Control')
  await page.waitForTimeout(400)
  const joined = await scene()
  check('⌃J joins the mesh objects into one', joined.objects.filter((object) => object.kind === 'mesh').length === 1,
    joined.objects.map((object) => object.name).join(', '))

  // H hides, ⌥H brings everything back.
  await page.keyboard.press('KeyH')
  await page.waitForTimeout(300)
  check('H hides the selection', (await scene()).objects.some((object) => object.visible === false))
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyH')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(300)
  check('⌥H brings it back', (await scene()).objects.every((object) => object.visible !== false))

  // Undo all the way back to the startup scene, then redo all the way forward.
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(300)
  const rewound = await names()
  check('undo walks all the way back to the startup scene', rewound.join(',') === 'Cube,Light,Camera', rewound.join(', '))
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.down('Control')
    await page.keyboard.down('Shift')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Control')
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(300)
  const forward = await names()
  check('and redo walks all the way forward again', forward.length === 3 && forward.includes('Light'), forward.join(', '))
  log(`MEASURE objects after redo: ${forward.join(', ')}`)

  await shot('scene-object-mode-1440.png')
})
