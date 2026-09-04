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
  // What the drag did instead is the useful half of a failure here, and proof the touch landed.
  const countAfter = await counted()
  check('one finger dragging in the viewport orbits',
    Math.abs(after.view.yaw - before.view.yaw) > 0.05 || Math.abs(after.view.pitch - before.view.pitch) > 0.05,
    `yaw ${before.view.yaw.toFixed(3)} → ${after.view.yaw.toFixed(3)}`
    + `, pitch ${before.view.pitch.toFixed(3)} → ${after.view.pitch.toFixed(3)}`
    + `; the drag went to the marquee instead (${countBefore} → ${countAfter})`)

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
    row.scrollLeft = 0
    const controls = [...row.querySelectorAll('button, input')].filter((node) => !node.closest('.visually-hidden'))
    const menus = [...row.querySelectorAll('.scene-menu__trigger')]
    const within = (node) => {
      const box = node.getBoundingClientRect()
      return box.left >= 0 && box.right <= window.innerWidth
    }
    return {
      rows: [...new Set(controls.map((node) => Math.round(node.getBoundingClientRect().top / 8)))].length,
      scrolls: row.scrollWidth > row.clientWidth + 1,
      width: Math.round(row.clientWidth),
      content: Math.round(row.scrollWidth),
      menus: menus.length,
      menusInView: menus.filter(within).length,
    }
  })
  check('the header row stays one line and scrolls sideways',
    header.rows === 1 && header.scrolls, JSON.stringify(header))
  check('and a menu is on screen before anyone scrolls it',
    header.menusInView > 0, `${header.menusInView} of ${header.menus} menus within 320 px`)

  // Reaching the last of them is a scroll, not a fold: nothing has been dropped from the row.
  await page.locator('.scene-menu__trigger', { hasText: 'Object' }).first().click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  const objectMenu = await page.locator('.scene-menu[role="menu"] .scene-menu__item').count()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('and the last menu in the row still opens', objectMenu > 0, `${objectMenu} entries`)

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
  // With nothing selected the Item tab is an empty state; the sheet is measured with something in it.
  await page.locator('#main').focus()
  await page.keyboard.press('a')
  await page.waitForTimeout(200)
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

  const walk = () => page.evaluate(() => {
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
    /*
     * What a thumb has to hit, which is not always the element itself: a control wrapped in the
     * label that names it is pressed anywhere in that label, so the label is the target. That is
     * how a switch's forty-by-twenty-four pill sits inside a forty-four-pixel row.
     */
    const target = (node) => {
      const label = node.closest('label')
      return label && node.id && label.getAttribute('for') === node.id ? label : node
    }
    const measure = (root, area) => [...root.querySelectorAll(SELECTOR)]
      .filter(shown)
      .map((node) => {
        const box = target(node).getBoundingClientRect()
        return { area, name: name(node), width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 }
      })
      .filter((entry) => entry.width > 0 && entry.height > 0)
    return [
      ...measure(document.querySelector('.scene-body'), 'viewport'),
      ...measure(document.querySelector('.scene-titlebar'), 'header'),
    ].sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))
  })

  // Both tabs of the sheet: Item is number fields, Tool is switches and segmented choices.
  const itemTargets = await walk()
  await page.locator('.scene-sidebar__tab', { hasText: 'Tool' }).click()
  await page.waitForTimeout(300)
  const toolTargets = await walk()
  await shot('scene-mobile-320-tools.png')
  const targets = [...itemTargets, ...toolTargets].sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))
  const inViewport = targets.filter((entry) => entry.area === 'viewport')
  const smallest = inViewport[0]
  const under = inViewport.filter((entry) => entry.width < 44 || entry.height < 44)
  log(`  ${inViewport.length} controls in the viewport over both sheet tabs;`
    + ` smallest “${smallest.name}” at ${smallest.width} × ${smallest.height}`)
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

  /* ------------------------------------------------------- the edit-mode bar */

  // Edit mode has no keyboard here, so the bar is the whole of it: eight things at forty-four
  // pixels, and a way to the rest of the mesh menu.
  //
  // The sheet is closed first: it holds the focus while it is open, and Tab belongs to whatever
  // holds the focus — the mode toggle is the viewport's, and the viewport is behind the sheet.
  await page.locator('#main').focus()
  await page.keyboard.press('n')
  await page.waitForSelector('.scene-sidebar', { state: 'detached', timeout: 10000 })
  await tap(160, 300)
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)

  const bar = page.locator('.scene-touchbar')
  check('the edit bar appears at 320 px', await bar.isVisible())
  const barButtons = await bar.locator('button').count()
  check('and it holds the eight things a finger cannot do without', barButtons >= 8, `${barButtons} buttons`)
  const barSizes = await bar.locator('button').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect()
    return Math.round(Math.min(rect.width, rect.height))
  }))
  const smallestOnBar = Math.min(...barSizes)
  log(`MEASURE smallest control on the edit bar at 320: ${smallestOnBar} px`)
  check('every one of them is at least forty-four pixels', smallestOnBar >= 44, `${smallestOnBar} px`)
  check('and the floating tool strip stands aside for it',
    !(await page.locator('.scene-toolbar[data-mode="edit"]').isVisible()))

  /*
   * The events are dispatched rather than tapped: the bar scrolls sideways, so a control can be off
   * the visible run of it and a synthetic tap at its centre would land outside the window. Its size
   * is asserted above, which is the check that matters; what is proved here is that the handler
   * behind it does the right thing.
   */
  await page.locator('.scene-touchbar button[aria-label="Face select"]').dispatchEvent('click')
  await page.waitForTimeout(400)
  check('the bar switches to faces',
    await page.locator('.scene-touchbar button[aria-label="Face select"]').getAttribute('aria-pressed') === 'true',
    await page.locator('.scene-status__stats').textContent())
  check('and the kind it left is no longer marked',
    await page.locator('.scene-touchbar button[aria-label="Vertex select"]').getAttribute('aria-pressed') === 'false')
  await shot('scene-mobile-320-edit.png')

  await page.locator('.scene-touchbar__more').dispatchEvent('click')
  await page.waitForSelector('.scene-menu[role="menu"]')
  const meshEntries = await page.locator('.scene-menu[role="menu"] [role="menuitem"]').count()
  check('More opens the Mesh menu', meshEntries > 5, `${meshEntries} entries`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // An element is still reachable under a finger: ten pixels is the radius a click reads.
  await page.locator('.scene-touchbar button[aria-label="Vertex select"]').dispatchEvent('click')
  await page.waitForTimeout(400)
  const scene = await helpers.scene()
  const editedMesh = scene.meshes[scene.objects.find((object) => object.data.kind === 'mesh').data.meshId]
  const corner = [editedMesh.vertices[0], editedMesh.vertices[1], editedMesh.vertices[2]]
  const cornerAt = await helpers.project3d(corner)
  // The middle of the cube, which is over the mesh whichever way the pointer strays from it — a
  // corner sits on the silhouette, and a few pixels past it there is nothing to find by design.
  const middleAt = await helpers.project3d([0, 0, 0])
  const reach = await page.evaluate(([corner, middle]) => {
    const api = window.__paramrigScene
    const onCorner = api.pickElements(corner[0], corner[1], 10)
    let overMesh = 0
    for (let offset = 2; offset <= 20; offset += 2) {
      const away = api.pickElements(middle[0] + offset, middle[1], 10)
      if ((away.vertex || away.edge || away.face) && overMesh === offset - 2) overMesh = offset
    }
    return { vertex: !!onCorner.vertex, distance: onCorner.vertex?.distance ?? -1, overMesh }
  }, [cornerAt.local, middleAt.local])
  log(`MEASURE at 320: the corner answers a vertex ${reach.distance.toFixed(1)} px from the pointer;`
    + ` over the mesh an element is found ${reach.overMesh} px in every direction tried`)
  /*
   * Two things a finger needs, and neither is the size of the drawn dot: that a tap on a vertex
   * finds that vertex, and that a tap that strays over the mesh finds something to work with rather
   * than nothing. A corner sits on the silhouette, so straying *off* it finds nothing by design —
   * which is why the second number is measured from the middle.
   */
  check('a tap on a corner finds the vertex, and a tap over the mesh always finds something',
    reach.vertex && reach.overMesh >= 20, `${reach.distance.toFixed(1)} px, ${reach.overMesh} px over the mesh`)

  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)

  /* -------------------------------------------------- two fingers, and a hold */

  /*
   * A gesture is measured on a page that nothing has been done to. The checks above leave a menu
   * open, the sheet up over the middle of the screen and the editor in edit mode, and the point of
   * these three is the gesture itself rather than the state it is made in.
   */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.scene-stage')
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await page.waitForTimeout(400)
  const viewport = await helpers.viewportBox()
  // Above the middle: the tool strip and the edit bar sit along the foot of the viewport.
  const middle = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height * 0.35 }

  log(`  at the middle of the viewport: ${await page.evaluate(([x, y]) => {
    const node = document.elementFromPoint(x, y)
    return node ? `${node.tagName}.${String(node.className).slice(0, 40)}` : 'nothing'
  }, [middle.x, middle.y])}`)

  const viewNow = async () => (await helpers.scene()).view
  const panBefore = await viewNow()
  // Two fingers moving together pan; the target moves and the angles do not.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: middle.x - 40, y: middle.y, id: 1 }, { x: middle.x + 40, y: middle.y, id: 2 }],
  })
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: middle.x - 40 + step * 6, y: middle.y + step * 4, id: 1 },
        { x: middle.x + 40 + step * 6, y: middle.y + step * 4, id: 2 },
      ],
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(600)
  const panAfter = await viewNow()
  const moved = Math.hypot(panAfter.target[0] - panBefore.target[0], panAfter.target[1] - panBefore.target[1], panAfter.target[2] - panBefore.target[2])
  check('two fingers pan without turning the view',
    moved > 0.05 && Math.abs(panAfter.yaw - panBefore.yaw) < 1 && Math.abs(panAfter.pitch - panBefore.pitch) < 1,
    `moved ${moved.toFixed(2)} m, yaw ${panBefore.yaw.toFixed(1)} → ${panAfter.yaw.toFixed(1)}`)

  // And two fingers spreading zoom in, which is the distance coming down.
  const zoomBefore = (await viewNow()).distance
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: middle.x - 30, y: middle.y, id: 1 }, { x: middle.x + 30, y: middle.y, id: 2 }],
  })
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: middle.x - 30 - step * 8, y: middle.y, id: 1 },
        { x: middle.x + 30 + step * 8, y: middle.y, id: 2 },
      ],
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(600)
  const zoomAfter = (await viewNow()).distance
  check('and spreading them zooms in', zoomAfter < zoomBefore - 0.2, `${zoomBefore.toFixed(2)} → ${zoomAfter.toFixed(2)} m`)
  log(`MEASURE pinch: ${zoomBefore.toFixed(2)} → ${zoomAfter.toFixed(2)} m`)

  // A finger held still opens the context menu, which is the right button a phone does not have.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: middle.x, y: middle.y }] })
  await page.waitForTimeout(900)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
  const held = await page.locator('[role="menuitem"]').count()
  check('a finger held on the viewport opens the context menu', held > 0, `${held} entries`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ------------------------------------------------- what a phone draws with */

  const drawing = await page.evaluate(() => ({
    ratio: window.devicePixelRatio,
    canvas: {
      width: document.querySelector('.scene-canvas').width,
      css: Math.round(document.querySelector('.scene-canvas').getBoundingClientRect().width),
    },
  }))
  const scale = Math.round((drawing.canvas.width / drawing.canvas.css) * 100) / 100
  check('the viewport draws at most one and a half pixels for one of ours',
    scale <= 1.5 + 1e-6, `${scale}× against a display of ${drawing.ratio}×`)
  log(`MEASURE mobile pixel ratio: ${scale}× on a ${drawing.ratio}× display`)

  /* ------------------------------------------- what it costs at 375 × 812 */

  /*
   * A phone-shaped viewport, turned under a finger, measured the way the desktop budget is: the
   * time spent inside the frame callback, which is where the viewport draws. The scene is the
   * startup one rather than the heavy grid — a hundred thousand triangles is not what a phone is
   * asked for, and a budget nobody would meet is not a budget.
   */
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(600)
  // Something worth drawing: a subdivided cube is what a phone is actually asked to turn.
  await page.locator('#main').focus()
  await page.keyboard.press('a')
  await page.keyboard.press('Control+3')
  await page.waitForTimeout(800)
  const load = await page.evaluate(() => window.__paramrigScene.stats())
  log(`  measured on ${load.triangles} triangles`)
  const phone = await helpers.viewportBox()
  const from = { x: phone.x + phone.width * 0.3, y: phone.y + phone.height * 0.35 }
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window)
    window.__phone = { work: [] }
    window.__phoneRestore = () => { window.requestAnimationFrame = original }
    window.requestAnimationFrame = (callback) => original((time) => {
      const started = performance.now()
      callback(time)
      // A frame already queued when the probe is taken down still runs, and has nowhere to report.
      window.__phone?.work.push(performance.now() - started)
    })
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
  for (let step = 1; step <= 40; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + step * 3, y: from.y + Math.sin(step / 6) * 20 }],
    })
    await page.waitForTimeout(12)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
  const frames = await page.evaluate(() => {
    window.__phoneRestore()
    const work = window.__phone.work
    delete window.__phone
    delete window.__phoneRestore
    return work
  })
  const sorted = [...frames].sort((a, b) => a - b)
  const mean = frames.reduce((total, value) => total + value, 0) / Math.max(1, frames.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
  log(`MEASURE at 375 × 812, one finger orbiting: ${frames.length} frames, ${mean.toFixed(2)} ms mean, ${p95.toFixed(2)} ms p95`)
  check('a finger turning the view on a phone holds a 16 ms mean frame', mean <= 16, `${mean.toFixed(2)} ms`)
  check('and a 33 ms p95', p95 <= 33, `${p95.toFixed(2)} ms`)
  await shot('scene-mobile-375.png')
  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(400)

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
