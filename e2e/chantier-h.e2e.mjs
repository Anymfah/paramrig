import { run } from './lib.mjs'

/** Chantier H: components and the instances that follow them. */
export default run('chantier-h', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()

  // Two shapes to make a component out of.
  await page.keyboard.press('r')
  await helpers.drag({ x: 100, y: 100 }, { x: 220, y: 180 })
  await page.waitForTimeout(200)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('o')
  await helpers.drag({ x: 120, y: 120 }, { x: 160, y: 160 })
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await page.keyboard.press('Meta+a')
  await page.waitForTimeout(200)

  // 1. ⌥⌘K makes a component out of the selection.
  await page.keyboard.press('Alt+Meta+k')
  await page.waitForTimeout(400)
  let state = await helpers.doc()
  const component = state.elements.find((element) => element.kind === 'component')
  check('the selection becomes a component', !!component && state.elements.filter((element) => element.parentId === component.id).length === 2,
    JSON.stringify(state.elements.map((element) => [element.kind, element.parentId ?? null])))
  check('and it keeps the box of what went into it', Math.round(component.width) === 120 && Math.round(component.height) === 80,
    JSON.stringify({ width: component.width, height: component.height }))

  // 2. The assets tab lists it, with a thumbnail and its instance count.
  await page.click('.vector-layers__tab[aria-selected="false"]')
  await page.waitForTimeout(300)
  const asset = await page.evaluate(() => {
    const item = document.querySelector('.vector-assets__item')
    return item ? { name: item.querySelector('.vector-assets__name')?.textContent, count: item.querySelector('.vector-assets__count')?.textContent, shapes: item.querySelectorAll('svg path, svg rect, svg ellipse, svg image, svg text').length } : null
  })
  check('the assets tab shows the component with a thumbnail', !!asset && asset.shapes >= 2 && asset.count === '0', JSON.stringify(asset))
  await shot('chantier-h-assets.png')

  // 3. Placing it three times gives three instances that copy the master.
  for (let index = 0; index < 3; index += 1) {
    await page.click('.vector-assets__item')
    await page.waitForTimeout(300)
  }
  state = await helpers.doc()
  const instances = state.elements.filter((element) => element.kind === 'instance')
  check('three clicks place three instances', instances.length === 3, String(instances.length))
  const copies = state.elements.filter((element) => element.id.startsWith('inst:'))
  check('each instance carries a copy of both children', copies.length === 6, String(copies.length))
  check('the copies are painted like the master',
    copies.every((copy) => copy.fill === state.elements.find((element) => element.id === copy.id.split(':')[2])?.fill),
    JSON.stringify(copies.map((copy) => copy.fill)))

  // Spread them out so they can be told apart.
  const ids = instances.map((instance) => instance.id)
  await page.evaluate((list) => {
    const key = 'paramrig.vector-documents.v1'
    const all = JSON.parse(localStorage.getItem(key) ?? '{}')
    const id = location.pathname.split('/r/')[1]
    all[id] = { ...all[id], elements: all[id].elements.map((element) => {
      const index = list.indexOf(element.id)
      return index >= 0 ? { ...element, x: 150 + index * 200, y: 400 } : element
    }) }
    localStorage.setItem(key, JSON.stringify(all))
  }, ids)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(500)

  // 4. Editing the master changes all three.
  await page.evaluate(() => {
    const key = 'paramrig.vector-documents.v1'
    const all = JSON.parse(localStorage.getItem(key) ?? '{}')
    const id = location.pathname.split('/r/')[1]
    all[id] = { ...all[id], elements: all[id].elements.map((element) => element.kind === 'rectangle' && !element.id.startsWith('inst:') ? { ...element, fill: '#FF0000' } : element) }
    localStorage.setItem(key, JSON.stringify(all))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(600)
  state = await helpers.doc()
  const rectCopies = state.elements.filter((element) => element.id.startsWith('inst:') && element.kind === 'rectangle')
  check('editing the master repaints every instance', rectCopies.length === 3 && rectCopies.every((copy) => copy.fill === '#FF0000'),
    JSON.stringify(rectCopies.map((copy) => copy.fill)))
  await shot('chantier-h-instances.png')

  // 5. Painting inside one instance writes an override and leaves the others alone.
  const firstCopy = rectCopies[0].id
  await page.evaluate((copyId) => {
    const layer = [...document.querySelectorAll('.vector-layer__select')]
    void layer
    void copyId
  }, firstCopy)
  await page.locator('.vector-layers__tab', { hasText: 'Layers' }).click().catch(() => {})
  await page.waitForTimeout(200)
  // Reach the copy through the canvas: click inside the first instance, twice to go in.
  const inside = await helpers.toClient({ x: 200, y: 440 })
  await page.mouse.dblclick(inside.x, inside.y)
  await page.waitForTimeout(400)
  const selected = await page.$$eval('[data-vector-element][data-selected]', (nodes) => nodes.map((node) => node.getAttribute('data-vector-element')))
  check('a double-click reaches the copy inside the instance', selected.some((id) => id?.startsWith('inst:')), JSON.stringify(selected))
  if (selected.some((id) => id?.startsWith('inst:'))) {
    await page.locator('.vector-paints').locator('.color-field__hex').first().fill('#00FF00')
    await page.locator('.vector-paints').locator('.color-field__hex').first().press('Enter')
    await page.waitForTimeout(500)
    state = await helpers.doc()
    const instance = state.elements.find((element) => element.kind === 'instance' && element.overrides)
    check('the edit lands on the instance as an override', !!instance?.overrides, JSON.stringify(instance?.overrides))
    const greens = state.elements.filter((element) => element.id.startsWith('inst:') && element.fill === '#00FF00')
    check('and only that instance changes', greens.length === 1, String(greens.length))
  }

  // 6. Detaching stops one instance following.
  const instanceIds = (await helpers.doc()).elements.filter((element) => element.kind === 'instance').map((element) => element.id)
  await page.evaluate((id) => {
    const row = [...document.querySelectorAll('.vector-layer__select')].find((node) => node.closest('[data-vector-layer]')?.getAttribute('data-vector-layer') === id)
    row?.click()
  }, instanceIds[2])
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await helpers.clickAt({ x: 610, y: 440 })
  await page.waitForTimeout(300)
  await page.keyboard.press('Alt+Meta+b')
  await page.waitForTimeout(400)
  state = await helpers.doc()
  check('detaching turns it into a plain group', state.elements.filter((element) => element.kind === 'instance').length === 2
    && state.elements.some((element) => element.kind === 'group'),
    JSON.stringify(state.elements.filter((element) => element.kind === 'group' || element.kind === 'instance').map((element) => element.kind)))

  // 7. The export expands an instance into its shapes.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export writes the instances out as shapes',
    !!exported && (exported.text.match(/id="inst:/g) ?? []).length >= 4,
    exported ? String((exported.text.match(/id="inst:/g) ?? []).length) : 'no download')
  await page.keyboard.press('Escape')
})
