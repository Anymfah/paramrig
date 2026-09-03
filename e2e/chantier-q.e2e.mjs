import { run } from './lib.mjs'

/** The look of a selection, and the column the exposing diamonds live in. */
export default run('chantier-q', async ({ page, check, log, helpers }) => {
  await helpers.newDocument()
  await page.evaluate(() => localStorage.removeItem('paramrig.vector-inspector.v1'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.locator('#main').focus()

  await page.click('[aria-label="Shape tools"]')
  await page.waitForSelector('.vector-tool-menu__content')
  await page.click('.vector-tool-menu__item:has-text("Star")')
  await page.waitForTimeout(250)
  await helpers.drag({ x: 220, y: 160 }, { x: 520, y: 440 })
  await page.waitForTimeout(400)

  // 1. The box hugs what it selects.
  const fit = await page.evaluate(() => {
    const box = document.querySelector('.vector-selection > rect').getBoundingClientRect()
    const ink = document.querySelector('[data-vector-element] path').getBoundingClientRect()
    return {
      dx: Math.abs(box.width - ink.width),
      dy: Math.abs(box.height - ink.height),
      offset: Math.hypot(box.left - ink.left, box.top - ink.top),
    }
  })
  log(`MEASURE selection against the ink: ${JSON.stringify(fit)}`)
  check('the selection box hugs the star it selects', fit.dx <= 1 && fit.dy <= 1 && fit.offset <= 1.5, JSON.stringify(fit))

  const star = (await helpers.doc()).elements[0]
  check('and the star is stored with the box it was drawn in', Math.round(star.width) === 300 && Math.round(star.height) === 280, JSON.stringify([star.width, star.height]))

  // 2. The chrome is the canvas teal, not the near-white accent, and the handles carry the weight.
  const look = await page.evaluate(() => {
    const read = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return null
      const style = getComputedStyle(node)
      return { stroke: style.stroke, width: style.strokeWidth, shadow: style.filter !== 'none' }
    }
    return { box: read('.vector-selection > rect'), handle: read('.vector-selection__handle') }
  })
  log(`MEASURE selection chrome: ${JSON.stringify(look)}`)
  check('the selection is drawn in the canvas teal', look.box?.stroke === 'rgb(31, 174, 140)', String(look.box?.stroke))
  check('the box is a hairline', look.box?.width === '1px', String(look.box?.width))
  check('and the handles are lifted off the artboard', look.handle?.shadow === true)

  // 3. Hovering shows the shape, in the same teal, quieter.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  const at = await helpers.toClient({ x: 370, y: 260 })
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(300)
  const hover = await page.evaluate(() => {
    const node = document.querySelector('.vector-hover')
    if (!node) return null
    const style = getComputedStyle(node)
    return { tag: node.tagName, stroke: style.stroke, opacity: Number(style.opacity) }
  })
  log(`MEASURE hover: ${JSON.stringify(hover)}`)
  check('hovering outlines the shape, not a box', hover?.tag === 'path', String(hover?.tag))
  check('in the selection colour, one notch quieter', hover?.stroke === 'rgb(31, 174, 140)' && hover.opacity < 1, JSON.stringify(hover))

  // 4. Every row of a section ends at the same place.
  await helpers.clickAt({ x: 370, y: 260 })
  await page.waitForTimeout(300)
  const edges = await page.evaluate(() => {
    const body = document.querySelector('.vector-inspector__body')
    const rows = [...body.querySelectorAll('.vector-section__body > *')]
      .map((node) => Math.round(node.getBoundingClientRect().right))
      .filter((right) => right > 0)
    return { rights: [...new Set(rows)], count: rows.length }
  })
  log(`MEASURE row right edges: ${JSON.stringify(edges)}`)
  check('no row sticks out past its neighbour', edges.rights.length === 1, JSON.stringify(edges))
  check('and there are rows to compare', edges.count > 6, String(edges.count))

  const switches = await page.evaluate(() => [...document.querySelectorAll('[data-section="layer"] .switch')].map((node) => Math.round(node.getBoundingClientRect().right)))
  check('the Visible and Locked switches line up', new Set(switches).size === 1 && switches.length === 2, JSON.stringify(switches))

  const gutter = await page.evaluate(() => {
    const field = document.querySelector('[data-section="position"] .vector-exposable .vector-exposable__field')
    const diamond = document.querySelector('[data-section="position"] .vector-exposable .vector-expose')
    return field && diamond ? Math.round(field.getBoundingClientRect().left - diamond.getBoundingClientRect().left) : null
  })
  check('the diamond sits in a gutter before the field', gutter !== null && gutter > 0, String(gutter))

  // With several objects nothing can be exposed, so the gutter is not reserved.
  await page.locator('#main').focus()
  await page.keyboard.press('r')
  await helpers.drag({ x: 560, y: 160 }, { x: 720, y: 300 })
  await page.waitForTimeout(200)
  await page.locator('#main').focus()
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(400)
  check('several objects leave no empty gutter', await page.locator('.vector-inspector__body[data-expose]').count() === 0)

  // 5. A polygon's own handles still land on the shape after the stretch.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await helpers.clickAt({ x: 370, y: 260 })
  await page.waitForTimeout(300)
  const onShape = await page.evaluate(() => {
    const handle = document.querySelector('[data-vector-shape-handle="polygon-sides"]')
    const ink = document.querySelector('[data-vector-element] path')
    if (!handle || !ink) return null
    const box = handle.getBoundingClientRect()
    const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const rect = ink.getBoundingClientRect()
    return { onTop: Math.abs(at.y - rect.top) < 3, centred: Math.abs(at.x - (rect.left + rect.width / 2)) < 3 }
  })
  log(`MEASURE polygon handle: ${JSON.stringify(onShape)}`)
  check('the sides handle sits on the top point of the star', onShape?.onTop === true && onShape.centred === true, JSON.stringify(onShape))
})
