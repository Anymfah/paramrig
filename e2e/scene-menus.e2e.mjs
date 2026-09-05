import { run } from './lib.mjs'

/**
 * Chantier N: the palette, the pies, the Q menu and the preferences.
 *
 * These are the parts of the editor that are reached rather than looked at, so what is checked is
 * the gesture: a key held and released over a sector, a right-click that puts something on Q, a
 * preference that changes what the next drag does.
 */
export default run('scene-menus', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.evaluate(() => localStorage.removeItem('paramrig.scene-prefs.v1'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.scene-stage')
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  /* ------------------------------------------------------------ the shading pie */

  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('KeyZ')
  await page.waitForSelector('[data-scene-pie-item]', { timeout: 10000 })
  const sectors = await page.locator('[data-scene-pie-item]').allInnerTexts()
  check('Z opens the shading pie with its four entries',
    sectors.length === 4 && sectors.join(' ').includes('Wireframe'), sectors.join(' / '))
  await shot('scene-menus-pie-1440.png')

  await page.locator('[data-scene-pie-item]', { hasText: 'Wireframe' }).first().click()
  await page.waitForTimeout(500)
  const shading = await page.evaluate(() => window.__paramrigScene && JSON.parse(localStorage.getItem('paramrig.scene-documents.v1')))
  const document = Object.values(shading)[0]
  check('picking Wireframe from the pie changes the shading', document.view.shading === 'wireframe', document.view.shading)

  /* ------------------------------------------------------------- the views pie */

  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('Backquote')
  await page.waitForSelector('[data-scene-pie-item]', { timeout: 10000 })
  const views = await page.locator('[data-scene-pie-item]').allInnerTexts()
  check('the ` pie offers the six axis views, the camera and framing',
    views.length === 8 && views.includes('Top') && views.includes('Camera'), views.join(' / '))
  // The number keys drive a pie without the pointer: 1 is the entry at the top.
  await page.keyboard.press('1')
  await page.waitForTimeout(700)
  const top = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1'))
    return Object.values(all)[0].view
  })
  check('and its first entry, taken by its number, is the top view',
    Math.round(top.pitch) === 90, `pitch ${Math.round(top.pitch)}`)

  /* ------------------------------------------------------- the snap pie on ⇧S */

  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('Shift+KeyS')
  await page.waitForSelector('[data-scene-pie-item]', { timeout: 10000 })
  const snaps = await page.locator('[data-scene-pie-item]').allInnerTexts()
  check('⇧S opens the snap pie, its eight slices each their own',
    snaps.length === 8 && new Set(snaps).size === 8, snaps.join(' / '))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ---------------------------------------------------------------- the palette */

  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input', { timeout: 10000 })
  const panel = await page.evaluate(() => {
    const node = document.querySelector('.scene-modal__panel')
    const rect = node.getBoundingClientRect()
    return { width: Math.round(rect.width), background: getComputedStyle(node).backgroundColor }
  })
  check('the palette is drawn as a panel rather than as bare markup',
    panel.width > 200 && panel.width < 700 && panel.background !== 'rgba(0, 0, 0, 0)', JSON.stringify(panel))
  await page.locator('.scene-palette__input').fill('shsm')
  await page.waitForTimeout(400)
  const loose = await page.locator('.scene-palette__item .scene-palette__label').allInnerTexts()
  check('and finds a command from letters that are spread through its name',
    loose.some((label) => /shade smooth/i.test(label)), loose.slice(0, 3).join(' / ') || 'nothing')
  await page.locator('.scene-palette__input').fill('add cube')
  await page.waitForTimeout(300)
  await page.locator('.scene-palette__input').fill('cube')
  await page.waitForTimeout(300)
  await page.locator('.scene-palette__item').first().click()
  await page.waitForTimeout(600)

  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input', { timeout: 10000 })
  const first = await page.locator('.scene-palette__item .scene-palette__label').first().innerText()
  check('the palette opens on what was last run from it', /cube/i.test(first), first)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  log(`MEASURE palette: ${loose.length} matches for “shsm”, last choice “${first}”`)

  /* -------------------------------------------------------- the quick favourites */

  await page.locator('.scene-header__menus button', { hasText: 'Add' }).first().click()
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 })
  await page.locator('[role="menuitem"]', { hasText: 'Cylinder' }).first().click({ button: 'right' })
  await page.waitForSelector('.scene-menu__favorite', { timeout: 10000 })
  await page.locator('.scene-menu__favorite button').click()
  await page.waitForTimeout(400)
  const favorites = await page.evaluate(() => JSON.parse(localStorage.getItem('paramrig.scene-prefs.v1') ?? '{}').favorites ?? [])
  check('the right button puts a menu entry on the Q menu', favorites.includes('add.cylinder'), favorites.join(', ') || 'none')

  // Away from the Add menu first: two menus open at once would answer for each other's entries.
  await page.keyboard.press('Escape')
  await page.mouse.click(centre.x, centre.y + 200)
  await page.waitForTimeout(400)
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('KeyQ')
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 })
  const quick = await page.locator('[role="menu"][aria-label="Quick favourites"] [role="menuitem"]').allInnerTexts()
  check('and Q opens a menu of them at the pointer, holding only what was put there',
    quick.length === 1 && quick[0].includes('Cylinder'), quick.join(' / ') || 'nothing')
  await shot('scene-menus-favorites-1440.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ------------------------------------------------------------ the preferences */

  await page.locator('.scene-file .scene-menu__trigger', { hasText: 'Edit' }).first().click()
  await page.locator('[role="menuitem"]', { hasText: 'Preferences' }).first().click()
  await page.waitForSelector('.scene-prefs', { timeout: 10000 })
  await shot('scene-menus-preferences-1440.png')
  await page.locator('.scene-prefs__tab', { hasText: 'Navigation' }).click()
  await page.getByRole('radio', { name: 'Trackball' }).click({ force: true })
  await page.waitForTimeout(400)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('paramrig.scene-prefs.v1') ?? '{}').preferences ?? {})
  check('a preference is remembered the moment it is changed', stored.orbitStyle === 'trackball', JSON.stringify(stored.orbitStyle))

  await page.locator('.scene-prefs__tab', { hasText: 'Keymap' }).click()
  await page.getByLabel('Search the keymap').fill('extrude')
  await page.waitForTimeout(300)
  const rows = await page.locator('.scene-prefs__keys li').allInnerTexts()
  check('the keymap section is the keymap, searchable',
    rows.length > 0 && rows.every((row) => /extrude/i.test(row)), `${rows.length} rows`)
  log(`MEASURE keymap search “extrude”: ${rows.length} rows`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Trackball turns the view differently from turntable, which is the whole reason to offer it.
  const before = await page.evaluate(() => window.__paramrigScene.project([2, 0, 0]))
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(centre.x + step * 15, centre.y + step * 5)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => window.__paramrigScene.project([2, 0, 0]))
  check('and the preference is in force: the view turns under the drag',
    !!before && !!after && Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]) > 1,
    `${before?.map((v) => v.toFixed(1)).join(',')} → ${after?.map((v) => v.toFixed(1)).join(',')}`)
})
