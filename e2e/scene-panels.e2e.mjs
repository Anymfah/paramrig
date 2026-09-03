import { run } from './lib.mjs'

/** Chantiers 5, 6 and 8: the outliner, the header menus, the properties and the palette. */
export default run('scene-panels', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  // The outliner lists the startup scene under its collection.
  const rows = await page.locator('.scene-outliner__label').allTextContents()
  check('the outliner lists the collection and the three objects',
    rows.includes('Scene Collection') && rows.includes('Cube') && rows.includes('Light') && rows.includes('Camera'),
    rows.slice(0, 6).join(', '))

  // Clicking a row selects the object, and the status bar counts it.
  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.waitForTimeout(200)
  const stats = await page.locator('.scene-status__stats').textContent()
  check('clicking a row selects that object', stats.includes('Objects 1/3'), stats)

  // Renaming from the outliner renames it everywhere.
  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().locator('.scene-outliner__label').dblclick()
  await page.waitForSelector('.scene-outliner__edit input')
  await page.locator('.scene-outliner__edit input').fill('Block')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const renamed = await helpers.scene()
  check('renaming in the outliner renames the object', renamed.objects.some((object) => object.name === 'Block'),
    renamed.objects.map((object) => object.name).join(', '))

  // The header carries the menus and the view settings.
  const menus = await page.locator('.scene-header .scene-menu__trigger').allTextContents()
  check('the header carries the View, Select, Add and Object menus',
    ['View', 'Select', 'Add', 'Object'].every((label) => menus.some((text) => text.trim() === label)),
    menus.join(' | '))

  // Adding from the Add menu puts a new object in, selected and named.
  await page.locator('.scene-menu__trigger', { hasText: 'Add' }).first().click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu__item', { hasText: 'Cylinder' }).first().click()
  await page.waitForTimeout(500)
  const added = await helpers.scene()
  const cylinder = added.objects.find((object) => object.name === 'Cylinder')
  check('Add · Cylinder puts a cylinder in the scene', !!cylinder, added.objects.map((object) => object.name).join(', '))
  const mesh = cylinder && added.meshes[cylinder.data.meshId]
  check('and it is Blender’s cylinder: 32 sides, 64 vertices, 34 faces',
    !!mesh && mesh.vertexIds.length === 64 && mesh.faces.length === 34,
    mesh ? `${mesh.vertexIds.length}/${mesh.edges.length}/${mesh.faces.length}` : 'none')

  // The F9 panel adjusts what was just done, without adding a second history step.
  check('the adjust panel names the last operation', (await page.locator('.scene-redo__label').textContent()) === 'Add cylinder',
    await page.locator('.scene-redo__label').textContent())
  await page.locator('#main').focus()
  await page.keyboard.press('F9')
  await page.waitForTimeout(250)
  const fields = await page.locator('.scene-redo__body .control').count()
  check('and F9 opens its parameters', fields > 3, `${fields} fields`)
  await shot('scene-panels-redo-1440.png')

  // The properties editor shows the active object and edits it.
  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForTimeout(200)
  const nameField = page.locator('.scene-properties input[type="text"]').first()
  check('the properties editor shows the active object', (await nameField.inputValue()) === 'Cylinder', await nameField.inputValue())

  // The palette lists what exists and can run it.
  await page.locator('#main').focus()
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input')
  await page.keyboard.type('frame all')
  await page.waitForTimeout(200)
  const results = await page.locator('.scene-palette__label').allTextContents()
  check('the palette finds an operator by name', results.some((label) => label === 'Frame all'), results.slice(0, 3).join(', '))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  check('and running it moves the view', (await helpers.scene()).view.distance !== 17.5, String((await helpers.scene()).view.distance))

  // F1 shows the keymap, generated from the table.
  await page.locator('#main').focus()
  await page.keyboard.press('F1')
  await page.waitForSelector('.scene-keymap')
  const keys = await page.locator('.scene-keymap kbd').allTextContents()
  log(`MEASURE keymap rows: ${keys.length}`)
  check('F1 shows the keymap, generated from the table', keys.length > 40 && keys.includes('⇧D'), keys.slice(0, 6).join(' '))
  await shot('scene-keymap-1440.png')
  await page.keyboard.press('Escape')

  await shot('scene-panels-1440.png')
})
