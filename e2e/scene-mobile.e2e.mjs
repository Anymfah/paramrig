import { run } from './lib.mjs'

/**
 * The scene editor at 320 × 720, under a finger.
 *
 * The touch is real rather than a mouse wearing a costume: `Emulation.setTouchEmulationEnabled`
 * is what makes Blink report `pointer: coarse`, and every tap and drag below is a CDP
 * `Input.dispatchTouchEvent`. `page.touchscreen` is not available here — Playwright gates it on a
 * context created with `hasTouch`, and the harness attaches to a browser that already exists.
 */
export default run('scene-mobile', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  const cdp = await page.context().newCDPSession(page)
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 720 })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.waitForTimeout(600)

  /** A tap, as a finger makes one. */
  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await page.waitForTimeout(40)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(200)
  }

  /** One finger, held down and moved. The steps are what a gesture handler needs to see a delta. */
  const touchDrag = async (from, to, steps = 12) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
    for (let step = 1; step <= steps; step += 1) {
      const x = from.x + (to.x - from.x) * step / steps
      const y = from.y + (to.y - from.y) * step / steps
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(350)
  }

  const media = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    anyCoarse: window.matchMedia('(any-pointer: coarse)').matches,
    narrow: window.matchMedia('(max-width: 64em)').matches,
  }))
  check('the page is 320 px wide, narrow and coarse',
    media.width === 320 && media.narrow && media.coarse && media.anyCoarse,
    JSON.stringify(media))

  /* ------------------------------------------------------------- the dock */

  const dock = page.locator('.mobile-dock button')
  check('the dock offers Objects, Viewport and Inspector',
    (await dock.allTextContents()).join('/') === 'Objects/Viewport/Inspector',
    (await dock.allTextContents()).join('/'))

  /*
   * On screen, not merely painted: the shell slides a panel it is not showing out past the edge
   * with a transform rather than hiding it, so a box that overlaps the window is the only honest
   * reading of “this panel is the one up”.
   */
  const panelState = async () => page.evaluate(() => {
    const shell = document.querySelector('.shell')
    const onScreen = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.visibility !== 'hidden' && box.width > 0 && box.right > 0 && box.left < window.innerWidth
    }
    return {
      panel: shell?.getAttribute('data-mobile-panel'),
      outliner: onScreen('.scene-outliner'),
      properties: onScreen('.scene-properties'),
      stage: onScreen('.scene-stage'),
    }
  })

  const objectsBox = await dock.nth(0).boundingBox()
  await tap(objectsBox.x + objectsBox.width / 2, objectsBox.y + objectsBox.height / 2)
  const onNav = await panelState()
  check('tapping Objects brings up the outliner', onNav.panel === 'nav' && onNav.outliner, JSON.stringify(onNav))

  const inspectorBox = await dock.nth(2).boundingBox()
  await tap(inspectorBox.x + inspectorBox.width / 2, inspectorBox.y + inspectorBox.height / 2)
  const onInspector = await panelState()
  check('tapping Inspector brings up the properties',
    onInspector.panel === 'inspector' && onInspector.properties && !onInspector.outliner,
    JSON.stringify(onInspector))

  const viewportBox = await dock.nth(1).boundingBox()
  await tap(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2)
  const onMain = await panelState()
  check('tapping Viewport puts the viewport back',
    onMain.panel === 'main' && onMain.stage && !onMain.outliner && !onMain.properties,
    JSON.stringify(onMain))

  /* --------------------------------------------------------- the viewport */

  const stats = await page.evaluate(() => window.__paramrigScene.stats())
  check('the viewport draws at 320 px', stats.frames > 0, `${stats.frames} frames`)

  const box = await helpers.viewportBox()
  /** The selection is editor state rather than document state, so the status bar is where it shows. */
  const counted = () => page.locator('.scene-status__stats span').first().textContent()
  const before = await helpers.scene()
  const countBefore = await counted()
  await touchDrag(
    { x: box.x + box.width * 0.25, y: box.y + box.height * 0.7 },
    { x: box.x + box.width * 0.75, y: box.y + box.height * 0.3 },
  )
  const after = await helpers.scene()
  // What the drag did instead, when it did not orbit, is the useful half of a failure here.
  log(`  ${countBefore} → ${await counted()}`)
  check('one finger dragging in the viewport orbits',
    Math.abs(after.view.yaw - before.view.yaw) > 0.05 || Math.abs(after.view.pitch - before.view.pitch) > 0.05,
    `yaw ${before.view.yaw.toFixed(3)} → ${after.view.yaw.toFixed(3)}`
    + `, pitch ${before.view.pitch.toFixed(3)} → ${after.view.pitch.toFixed(3)}`)

  /* ---------------------------------------------------------- the toolbar */

  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector('.scene-toolbar')
    if (!bar) return null
    const box = bar.getBoundingClientRect()
    const body = document.querySelector('.scene-body').getBoundingClientRect()
    const tools = [...bar.querySelectorAll('.scene-toolbar__tool')].map((tool) => tool.getBoundingClientRect())
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      fromFoot: Math.round(body.bottom - box.bottom),
      scrolls: bar.scrollWidth > bar.clientWidth + 1,
      tops: [...new Set(tools.map((rect) => Math.round(rect.top)))],
      count: tools.length,
    }
  })
  check('the toolbar is a horizontal row along the foot of the viewport',
    toolbar.width > toolbar.height && toolbar.tops.length === 1 && toolbar.fromFoot < 24,
    JSON.stringify(toolbar))
  check('and it scrolls sideways rather than wrapping', toolbar.scrolls, `${toolbar.count} tools in ${toolbar.width} px`)

  // The stage swallows touch so a drag orbits; the strip has to be exempt or it cannot be reached.
  const barBox = await page.locator('.scene-toolbar').boundingBox()
  await touchDrag(
    { x: barBox.x + barBox.width - 24, y: barBox.y + barBox.height / 2 },
    { x: barBox.x + 24, y: barBox.y + barBox.height / 2 },
  )
  const scrolled = await page.evaluate(() => document.querySelector('.scene-toolbar').scrollLeft)
  check('and a finger can push it along', scrolled > 0, `scrollLeft ${Math.round(scrolled)}`)

  /* ----------------------------------------------------------- the header */

  const header = await page.evaluate(() => {
    const row = document.querySelector('.scene-titlebar')
    const controls = [...row.querySelectorAll('button, input')].filter((node) => !node.closest('.visually-hidden'))
    return {
      rows: [...new Set(controls.map((node) => Math.round(node.getBoundingClientRect().top / 8)))].length,
      scrolls: row.scrollWidth > row.clientWidth + 1,
      width: Math.round(row.clientWidth),
      content: Math.round(row.scrollWidth),
    }
  })
  check('the header row stays one line and scrolls sideways',
    header.rows === 1 && header.scrolls, JSON.stringify(header))

  /* -------------------------------------------------------- the status bar */

  const status = await page.evaluate(() => {
    const bar = document.querySelector('.scene-status')
    const hints = bar.querySelector('.scene-status__hints')
    return {
      hints: hints ? getComputedStyle(hints).display !== 'none' : false,
      counts: bar.querySelector('.scene-status__stats').textContent.trim(),
      overflows: bar.scrollWidth > bar.clientWidth + 1,
    }
  })
  check('the status bar drops its hints and keeps the counts',
    !status.hints && status.counts.includes('Objects') && status.counts.includes('Vertices') && !status.overflows,
    JSON.stringify(status))

  /* --------------------------------------------------- the sidebar sheet */

  const canvasBefore = await page.evaluate(() => {
    const box = document.querySelector('.scene-canvas').getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height) }
  })
  await page.locator('#main').focus()
  await page.keyboard.press('n')
  await page.waitForSelector('.scene-sidebar')
  await page.waitForTimeout(300)
  const sheet = await page.evaluate(() => {
    const panel = document.querySelector('.scene-sidebar')
    const body = document.querySelector('.scene-body')
    const canvas = document.querySelector('.scene-canvas').getBoundingClientRect()
    const box = panel.getBoundingClientRect()
    const area = body.getBoundingClientRect()
    const grab = getComputedStyle(panel, '::before')
    return {
      fromFoot: Math.round(area.bottom - box.bottom),
      share: Math.round((box.height / area.height) * 100),
      full: Math.round(box.width) >= Math.round(area.width) - 1,
      scrolls: getComputedStyle(panel.querySelector('.scene-sidebar__body')).overflowY,
      grabBar: grab.content !== 'none' && parseFloat(grab.width) > 16,
      canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height) },
      navClear: Math.round(box.top - document.querySelector('.scene-nav').getBoundingClientRect().bottom),
    }
  })
  check('the sidebar is a sheet on the foot of the viewport, at most 60 % of it',
    sheet.fromFoot === 0 && sheet.full && sheet.share <= 60 && sheet.share > 20,
    JSON.stringify(sheet))
  check('it has its own scroll and a grab bar, and does not push the canvas',
    sheet.scrolls === 'auto' && sheet.grabBar
    && sheet.canvas.width === canvasBefore.width && sheet.canvas.height === canvasBefore.height,
    `${JSON.stringify(sheet)} against ${JSON.stringify(canvasBefore)}`)
  check('and the navigation ball stays clear of it', sheet.navClear > 0, `${sheet.navClear} px of daylight`)

  /* ------------------------------------------------- adjust last operation */

  await page.locator('.scene-menu__trigger', { hasText: 'Add' }).first().click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu__item', { hasText: 'Cylinder' }).first().click()
  await page.waitForTimeout(600)
  await page.locator('#main').focus()
  await page.keyboard.press('F9')
  await page.waitForTimeout(300)
  const redo = await page.evaluate(() => {
    const panel = document.querySelector('.scene-redo')
    if (!panel) return null
    const box = panel.getBoundingClientRect()
    const bar = document.querySelector('.scene-toolbar').getBoundingClientRect()
    const area = document.querySelector('.scene-body').getBoundingClientRect()
    return {
      full: Math.round(box.width) >= Math.round(area.width) - 20,
      aboveToolbar: box.bottom <= bar.top + 1,
      fields: panel.querySelectorAll('.control').length,
    }
  })
  check('“Adjust last operation” spans the foot, above the toolbar',
    !!redo && redo.full && redo.aboveToolbar && redo.fields > 0, JSON.stringify(redo))

  /* ------------------------------------------------------- the 44 px walk */

  const targets = await page.evaluate(() => {
    const SELECTOR = [
      'button', 'input', 'select', 'textarea', 'a[href]',
      '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="slider"]',
      '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
    ].join(',')
    const name = (node) => node.getAttribute('aria-label')
      || node.textContent.trim().slice(0, 32)
      || node.getAttribute('placeholder')
      || (typeof node.className === 'string' ? node.className : node.className.baseVal)
      || node.tagName.toLowerCase()
    // A screen-reader-only file input is not a target; it is a one-pixel clip nobody can see.
    const shown = (node) => getComputedStyle(node).visibility !== 'hidden' && !node.closest('.visually-hidden')
    const measure = (root, area) => [...root.querySelectorAll(SELECTOR)]
      .filter(shown)
      .map((node) => {
        const box = node.getBoundingClientRect()
        return { area, name: name(node), width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 }
      })
      .filter((entry) => entry.width > 0 && entry.height > 0)
    return [
      ...measure(document.querySelector('.scene-body'), 'viewport'),
      ...measure(document.querySelector('.scene-titlebar'), 'header'),
    ].sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))
  })
  const inViewport = targets.filter((entry) => entry.area === 'viewport')
  const smallest = inViewport[0]
  const under = inViewport.filter((entry) => entry.width < 44 || entry.height < 44)
  log(`  ${inViewport.length} controls in the viewport; smallest “${smallest.name}” at ${smallest.width} × ${smallest.height}`)
  for (const entry of under.slice(0, 8)) log(`  under 44: ${entry.area} “${entry.name}” ${entry.width} × ${entry.height}`)
  check('every control in the viewport is at least 44 px in both directions',
    under.length === 0,
    `smallest “${smallest.name}” ${smallest.width} × ${smallest.height}`)

  const headerUnder = targets.filter((entry) => entry.area === 'header' && (entry.width < 44 || entry.height < 44))
  for (const entry of headerUnder.slice(0, 8)) log(`  under 44: header “${entry.name}” ${entry.width} × ${entry.height}`)
  check('and so is every control in the header row', headerUnder.length === 0,
    headerUnder.map((entry) => `${entry.name} ${entry.width}×${entry.height}`).join(', '))

  /* ---------------------------------------------------------- the dock line */

  const overlap = await page.evaluate(() => {
    const dock = document.querySelector('.mobile-dock').getBoundingClientRect()
    return [...document.querySelectorAll('.scene-toolbar, .scene-sidebar, .scene-redo, .scene-nav, .scene-status')]
      .map((node) => ({ name: node.className.split(' ')[0], bottom: Math.round(node.getBoundingClientRect().bottom) }))
      .filter((entry) => entry.bottom > Math.round(dock.top))
  })
  check('nothing in the editor reaches over the dock', overlap.length === 0, JSON.stringify(overlap))

  /* ------------------------------------------------------------ the record */

  // The two rows were scrolled by the checks above; a QA frame should start where a person would.
  await page.evaluate(() => {
    document.querySelector('.scene-titlebar').scrollLeft = 0
    document.querySelector('.scene-toolbar').scrollLeft = 0
  })
  await page.waitForTimeout(200)
  await shot('scene-mobile-320-sheet.png')

  // And again with the sheet down, which is the only state that shows the strip and the F9 panel.
  await page.locator('#main').focus()
  await page.keyboard.press('n')
  await page.waitForTimeout(400)
  await shot('scene-mobile-320.png')
})
