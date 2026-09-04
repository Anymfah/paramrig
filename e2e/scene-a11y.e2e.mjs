import { run } from './lib.mjs'

/**
 * Chantier O1: the editor without a mouse, and the editor read out loud.
 *
 * Everything here is a journey rather than a snapshot — where the focus goes, what the live region
 * says, what the arrows do to a transform — because that is what accessibility is: not a property
 * of a screenshot but the ability to get somewhere and be told where you are.
 */
export default run('scene-a11y', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  /* ------------------------------------------------------------ what it says */

  const said = () => page.locator('[data-announce="scene"]').innerText()
  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.waitForTimeout(700)
  const selected = await said()
  check('the live region names what was selected, its size and where it is',
    /Cube, 8 vertices, at 0, 0, 0/.test(selected), selected)

  // Into the viewport: Tab toggles the mode from there, and moves the focus from a panel, which is
  // what keeps the page from being a trap for anyone working without a mouse.
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(400)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(800)
  const mode = await said()
  check('and says which mode the editor is in', /Edit mode/.test(mode), mode)

  await page.keyboard.press('Digit2')
  await page.waitForTimeout(800)
  const selectMode = await said()
  check('and which elements are being selected', /Edge select/.test(selectMode), selectMode)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(800)

  /* ---------------------------------------------------- moving without a mouse */

  const before = await helpers.scene()
  const startZ = before.objects.find((object) => object.name === 'Cube').transform.position[2]
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('KeyG')
  await page.waitForSelector('.scene-hud', { state: 'attached', timeout: 10000 })
  await page.keyboard.press('KeyZ')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const moved = (await helpers.scene()).objects.find((object) => object.name === 'Cube').transform.position[2]
  check('G, an axis and an arrow move the object one unit without a pointer',
    Math.abs(moved - startZ - 1) < 1e-6, `${startZ} → ${moved}`)

  await page.keyboard.press('KeyG')
  await page.waitForSelector('.scene-hud', { state: 'attached', timeout: 10000 })
  await page.keyboard.press('KeyZ')
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.up('Shift')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const fine = (await helpers.scene()).objects.find((object) => object.name === 'Cube').transform.position[2]
  check('⇧ makes the step a tenth of one', Math.abs(fine - moved - 0.1) < 1e-6, `${moved} → ${fine}`)

  await page.keyboard.press('KeyG')
  await page.waitForSelector('.scene-hud', { state: 'attached', timeout: 10000 })
  await page.keyboard.press('KeyZ')
  await page.keyboard.down('Control')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Control')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const coarse = (await helpers.scene()).objects.find((object) => object.name === 'Cube').transform.position[2]
  check('⌃ makes it ten', Math.abs(coarse - fine + 10) < 1e-6, `${fine} → ${coarse}`)
  log(`MEASURE keyboard move: ${startZ} → ${moved} → ${fine} → ${coarse}`)

  /* -------------------------------------------------------- the focus journey */

  await page.evaluate(() => {
    // A stable name per element, so a focus that has not moved is told from two buttons alike.
    let count = 0
    for (const node of document.querySelectorAll('*')) node.setAttribute('data-tab-id', String(count += 1))
    document.querySelector('.scene-outliner a, .scene-outliner button')?.focus()
  })
  const regions = new Set()
  let last = ''
  let stuck = 0
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press('Tab')
    const here = await page.evaluate(() => {
      const node = document.activeElement
      if (!node || node === document.body) return { region: 'body', id: 'body' }
      const region = node.closest('.scene-outliner, .scene-header, .scene-toolbar, .scene-sidebar, .scene-properties, .scene-stage')
      return {
        region: region ? region.classList[region.classList.length - 1] : 'elsewhere',
        id: node.getAttribute('data-tab-id') ?? 'unknown',
      }
    })
    if (here.id === 'body') break
    regions.add(here.region)
    stuck = here.id === last ? stuck + 1 : 0
    if (stuck > 1) break
    last = here.id
  }
  check('the keyboard walks the outliner, the header, the tool bar and the properties',
    ['scene-outliner', 'scene-header', 'scene-toolbar', 'scene-properties'].every((region) => regions.has(region)),
    [...regions].join(', '))
  check('and nothing holds it: the focus moves on every press', stuck === 0, `${stuck} presses that went nowhere`)
  log(`MEASURE tab order visits: ${[...regions].join(', ')}`)

  /* ------------------------------------------------- Escape closes the last layer */

  // The journey above ends past the last element of the page, which in a headless browser is its
  // own chrome; a click brings the keyboard back to the document.
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input', { timeout: 10000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const paletteGone = await page.locator('.scene-palette__input').count()
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('KeyZ')
  await page.waitForSelector('[data-scene-pie-item]', { timeout: 10000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const pieGone = await page.locator('[data-scene-pie-item]').count()
  check('Escape closes the palette and the pie, each in its turn',
    paletteGone === 0 && pieGone === 0, `${paletteGone} palettes, ${pieGone} pie entries`)

  /* --------------------------------------------- the high-contrast selection */

  await page.evaluate(() => {
    const key = 'paramrig.scene-prefs.v1'
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
    localStorage.setItem(key, JSON.stringify({ ...stored, preferences: { ...(stored.preferences ?? {}), theme: 'high-contrast' } }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.scene-stage')
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const ratio = await page.evaluate(() => {
    const read = (name) => getComputedStyle(document.querySelector('.scene-stage')).getPropertyValue(name).trim()
    const parse = (value) => {
      const hex = value.replace('#', '')
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6)
      return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16))
    }
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const a = luminance(parse(read('--scene-selected')))
    const b = luminance(parse(read('--scene-viewport')))
    const [high, low] = a > b ? [a, b] : [b, a]
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100
  })
  check('the high-contrast preset puts the selection well clear of the viewport behind it',
    ratio >= 4.5, `${ratio}:1`)
  log(`MEASURE high-contrast selection against the viewport: ${ratio}:1`)
  await shot('scene-a11y-high-contrast-1440.png')
})
