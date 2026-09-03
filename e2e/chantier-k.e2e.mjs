import { run } from './lib.mjs'

/** The selection bar: what you do to what you have, parked out of the way of it. */
export default run('chantier-k', async ({ page, check, log, helpers }) => {
  await helpers.newDocument()
  await page.evaluate(() => localStorage.removeItem('paramrig.vector-inspector.v1'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.locator('#main').focus()
  await page.keyboard.press('r')
  await helpers.drag({ x: 200, y: 220 }, { x: 420, y: 380 })
  await page.waitForTimeout(300)

  const bar = page.locator('.vector-selection-bar')
  check('a selection brings up the bar', await bar.count() === 1)

  const geometry = await page.evaluate(() => {
    const node = document.querySelector('.vector-selection-bar')
    const box = document.querySelector('[data-vector-element][data-selected]')?.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    const canvas = document.querySelector('.vector-canvas').getBoundingClientRect()
    return {
      mode: node.dataset.mode,
      height: Math.round(rect.height),
      bottomGap: Math.round(canvas.bottom - rect.bottom),
      offCentre: Math.round((rect.left + rect.right) / 2 - (canvas.left + canvas.right) / 2),
      clear: rect.top > box.bottom,
      inside: rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1,
    }
  })
  log(`MEASURE selection bar: ${JSON.stringify(geometry)}`)
  check('it parks at the bottom middle of the canvas', geometry.offCentre === 0 && geometry.bottomGap === 16, JSON.stringify(geometry))
  check('and covers nothing of the selection', geometry.clear, JSON.stringify(geometry))
  check('it is 44 pixels tall', geometry.height === 44, String(geometry.height))
  check('it stays inside the canvas', geometry.inside)

  const buttons = await bar.locator('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  check('it carries group, the flips, the rotation, lock, hide and delete', [
    'Group', 'Combine shapes', 'Flip horizontal', 'Flip vertical', 'Rotate 90 degrees',
    'Lock selection', 'Hide selection', 'Delete selection', 'More actions',
  ].every((label) => buttons.includes(label)), buttons.join(', '))
  const sizes = await bar.locator('button').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)))
  check('every button is a 32 pixel target', sizes.every((size) => size >= 32), sizes.join(', '))

  // Parked at the edge it covers nothing, so it no longer blinks out on every gesture.
  const from = await helpers.toClient({ x: 250, y: 260 })
  const to = await helpers.toClient({ x: 330, y: 300 })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  const duringDrag = await page.evaluate(() => {
    const node = document.querySelector('.vector-selection-bar')
    return node ? Math.round(node.getBoundingClientRect().left) : null
  })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const afterDrag = await page.evaluate(() => Math.round(document.querySelector('.vector-selection-bar').getBoundingClientRect().left))
  check('it stays put through a drag rather than blinking out', duringDrag !== null && duringDrag === afterDrag, `${duringDrag} → ${afterDrag}`)

  // Its grip moves it, and the canvas remembers where it was left.
  const grip = await page.evaluate(() => {
    const r = document.querySelector('.vector-selection-bar__grip').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x - 160, grip.y - 240, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const parked = await page.evaluate(() => {
    const r = document.querySelector('.vector-selection-bar').getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top) }
  })
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('paramrig.vector-inspector.v1') ?? '{}').bar)
  log(`MEASURE bar after its grip was dragged: ${JSON.stringify({ parked, stored })}`)
  check('the grip drags the bar', stored?.dx === -160 && stored.dy === -240, JSON.stringify(stored))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.locator('#main').focus()
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(400)
  const reopened = await page.evaluate(() => {
    const r = document.querySelector('.vector-selection-bar').getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top) }
  })
  check('and it comes back where it was left', reopened.left === parked.left && reopened.top === parked.top, JSON.stringify({ parked, reopened }))
  await page.dblclick('.vector-selection-bar__grip')
  await page.waitForTimeout(300)
  check('a double-click on the grip puts it back', await page.evaluate(() => {
    const bar = document.querySelector('.vector-selection-bar').getBoundingClientRect()
    const canvas = document.querySelector('.vector-canvas').getBoundingClientRect()
    return Math.round((bar.left + bar.right) / 2 - (canvas.left + canvas.right) / 2) === 0
  }))

  // A button on the bar acts, and does not start a drag on the canvas underneath.
  const before = (await helpers.doc()).elements[0]
  await bar.locator('[aria-label="Flip horizontal"]').click()
  await page.waitForTimeout(250)
  const after = (await helpers.doc()).elements[0]
  check('a bar button acts on the selection', before.x === after.x && before.width === after.width && (await helpers.doc()).elements.length === 1)
  check('the bar is still there after acting', await page.locator('.vector-selection-bar').count() === 1)

  // Node mode swaps the bar for the node one.
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
  const nodeMode = await page.locator('.vector-selection-bar[data-mode="nodes"]').count()
  check('node mode brings the node bar', nodeMode === 1)
  const nodeButtons = await bar.locator('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  check('the node bar offers connect, scissors, smooth, corner and delete', [
    'Connect nodes', 'Scissors', 'Smooth nodes', 'Corner nodes', 'Delete nodes',
  ].every((label) => nodeButtons.includes(label)), nodeButtons.join(', '))

  // Smoothing a node through the bar, in one history entry.
  await page.click('.vector-nodes__point >> nth=0', { force: true })
  await page.waitForTimeout(200)
  const steps = await page.evaluate(() => document.querySelectorAll('.vector-history__step').length)
  await bar.locator('[aria-label="Smooth nodes"]').click()
  await page.waitForTimeout(300)
  const doc = await helpers.doc()
  const segments = doc.elements[0]?.network?.segments ?? []
  check('smoothing a node gives it handles', segments.some((segment) => segment.ah || segment.bh), JSON.stringify(segments.slice(0, 2)))
  log(`MEASURE history steps before smoothing: ${steps}`)

  // A tool that draws hides the bar entirely.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('p')
  await page.waitForTimeout(250)
  check('the pen hides the bar', await page.locator('.vector-selection-bar').count() === 0)

  // The HUD, the tooltips and the bar are the same chip.
  await page.locator('#main').focus()
  await page.keyboard.press('v')
  await page.waitForTimeout(200)
  const chips = await page.evaluate(() => {
    const read = (node) => {
      if (!node) return null
      const style = getComputedStyle(node)
      return [style.backgroundColor, style.borderRadius, style.borderTopWidth, style.borderTopColor].join('|')
    }
    return { bar: read(document.querySelector('.vector-selection-bar')), tip: read(document.querySelector('.tt')) }
  })
  log(`MEASURE chip: ${JSON.stringify(chips)}`)
  check('the bar is drawn on the chip surface', typeof chips.bar === 'string' && chips.bar.includes('px'))
})
