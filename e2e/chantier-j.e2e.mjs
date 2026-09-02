import { run } from './lib.mjs'

/** The toolbar: six groups, the document in the middle, the view at the end. */
export default run('chantier-j', async ({ page, check, log }) => {
  const helpers = (await import('./lib.mjs')).pageHelpers(page)
  await helpers.newDocument()
  await page.waitForTimeout(200)

  const groups = await page.locator('.vector-toolbar__tools [data-tool-group]').evaluateAll(
    (nodes) => [...new Set(nodes.map((node) => node.dataset.toolGroup))],
  )
  check('the bar carries the six groups', groups.length === 6, groups.join(', '))

  const clusters = await page.evaluate(() => {
    const bar = document.querySelector('.vector-toolbar')
    const seen = new Set()
    let count = 0
    for (const node of bar.querySelectorAll('button, input:not([type="file"])')) {
      if (node.offsetParent === null) continue
      const cluster = node.closest('.vector-tool-menu, .vector-toolbar__zoom')
      if (cluster) { if (seen.has(cluster)) continue; seen.add(cluster) }
      count += 1
    }
    return count
  })
  log(`MEASURE toolbar controls at 1440: ${clusters}`)
  check('the bar is under fourteen controls', clusters <= 14, String(clusters))

  check('undo left the bar', await page.locator('.vector-toolbar [aria-label="Undo"]').count() === 0)
  check('group left the bar', await page.locator('.vector-toolbar [aria-label="Group"]').count() === 0)
  check('the document name sits in the middle', await page.locator('.vector-toolbar__title .vector-document-name').count() === 1)
  check('the save badge sits beside it', await page.locator('.vector-toolbar__title .vector-save-badge').count() === 1)

  // The File button holds undo, redo and the palette.
  await page.click('.vector-toolbar [aria-label="File"]')
  await page.waitForSelector('.vector-file-menu')
  const items = await page.locator('.vector-file-menu__item').allInnerTexts()
  check('the file menu carries undo and redo', items.some((t) => t.startsWith('Undo')) && items.some((t) => t.startsWith('Redo')), items.join(' / '))
  check('the file menu offers the commands', items.some((t) => t.startsWith('Commands')))
  await page.keyboard.press('Escape')

  // Picking a tool in a group makes it the one the group shows.
  await page.click('[aria-label="Shape tools"]')
  await page.waitForSelector('.vector-tool-menu__content')
  await page.click('.vector-tool-menu__item:has-text("Star")')
  await page.waitForTimeout(200)
  check('the shapes group now shows the star', await page.locator('.vector-toolbar [aria-label="Star"]').count() === 1)
  check('picking a tool selects it', await page.locator('.vector-canvas[data-tool="polygon"]').count() === 1)

  await helpers.drag({ x: 200, y: 160 }, { x: 380, y: 340 })
  await page.waitForTimeout(300)
  const drawn = (await helpers.doc()).elements.at(-1)
  check('the star entry draws a star', drawn?.kind === 'polygon' && (drawn.innerRatio ?? 0) > 0, JSON.stringify({ kind: drawn?.kind, innerRatio: drawn?.innerRatio }))

  // A shortcut lights the group it belongs to.
  await page.locator('#main').focus()
  await page.keyboard.press('o')
  await page.waitForTimeout(150)
  check('a shortcut moves the group to that tool', await page.locator('.vector-toolbar [aria-label="Ellipse"]').count() === 1)

  // Zoom: the percentage opens a menu.
  await page.click('.vector-toolbar__zoom .vector-zoom')
  await page.waitForSelector('.vector-zoom-menu')
  await page.click('.vector-zoom-menu__item:has-text("200%")')
  await page.waitForTimeout(250)
  const zoomLabel = await page.locator('.vector-toolbar__zoom .vector-zoom').innerText()
  check('the zoom menu sets the scale', zoomLabel.trim() === '200%', zoomLabel)

  // Full screen moved into the view options.
  await page.click('.vector-toolbar [aria-label="View options"]')
  await page.waitForSelector('.vector-view-menu')
  const viewItems = await page.locator('.vector-view-menu__item').allInnerTexts()
  check('the view options carry full screen', viewItems.some((t) => t.includes('Full screen')), viewItems.join(' / '))
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(400)
  const narrow = await page.evaluate(() => {
    const bar = document.querySelector('.vector-toolbar')
    const tools = document.querySelector('.vector-toolbar__tools')
    const title = document.querySelector('.vector-toolbar__title')
    return {
      scrolls: tools.scrollWidth > tools.clientWidth + 1,
      titleBelow: title.getBoundingClientRect().top > tools.getBoundingClientRect().top + 8,
      barFits: bar.scrollWidth <= bar.clientWidth + 1,
    }
  })
  check('at 320 the tools scroll', narrow.scrolls, JSON.stringify(narrow))
  check('at 320 the name drops under the bar', narrow.titleBelow, JSON.stringify(narrow))
  check('at 320 the bar itself does not overflow', narrow.barFits, JSON.stringify(narrow))
})
