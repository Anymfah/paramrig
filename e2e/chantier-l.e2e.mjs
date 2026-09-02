import { run } from './lib.mjs'

/** The inspector: three tabs, one section header, lines instead of cards. */
export default run('chantier-l', async ({ page, check, log, helpers }) => {
  await helpers.newDocument()
  await page.evaluate(() => localStorage.removeItem('paramrig.vector-inspector.v1'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(300)

  const measure = () => page.evaluate(() => {
    const body = document.querySelector('.vector-inspector__body')
    const open = [...body.querySelectorAll('.vector-section')].filter((node) => node.dataset.open === 'true')
    return {
      sections: [...body.querySelectorAll('.vector-section')].map((node) => node.dataset.section),
      open: open.length,
      height: Math.round(body.scrollHeight),
      headHeights: [...body.querySelectorAll('.vector-section__head')].map((node) => Math.round(node.getBoundingClientRect().height)),
    }
  })

  const empty = await measure()
  log(`MEASURE nothing selected: ${JSON.stringify(empty)}`)
  check('nothing selected shows page, guides and export', empty.sections.join(',') === 'page,guides,document-export', empty.sections.join(','))

  await page.keyboard.press('r')
  await helpers.drag({ x: 180, y: 150 }, { x: 460, y: 340 })
  await page.waitForTimeout(300)
  const rect = await measure()
  log(`MEASURE one rectangle: ${JSON.stringify(rect)}`)
  check('one object shows six sections', rect.sections.join(',') === 'position,layer,fill,stroke,effects,network', rect.sections.join(','))
  check('every section header is 32 pixels', rect.headHeights.every((height) => height === 32), rect.headHeights.join(','))
  log(`MEASURE inspector content height for a rectangle: ${rect.height}px`)

  // One header, one word: "Fill" appears once inside the Fill section.
  const fillWords = await page.evaluate(() => (document.querySelector('[data-section="fill"]').textContent.match(/Fill/g) ?? []).length)
  check('the word Fill appears once in the Fill section', fillWords === 1, String(fillWords))

  // Rows, not cards: the paint layer is a 32 px line whose detail opens in a popover.
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-section="fill"] .vector-row')].map((node) => Math.round(node.getBoundingClientRect().height)))
  check('a paint layer is a 32 pixel line', rows.length === 1 && rows[0] >= 32 && rows[0] <= 40, rows.join(','))
  await page.click('[data-section="fill"] .vector-row__open')
  await page.waitForSelector('.vector-paint-popover')
  const popoverText = await page.locator('.vector-paint-popover').innerText()
  check('its detail opens in a popover', popoverText.includes('Type') && popoverText.includes('Layer opacity'), popoverText.replace(/\n/g, ' / '))
  check('the popover offers the style', popoverText.includes('Create style'), popoverText.replace(/\n/g, ' / '))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  // Align lives in the Position header.
  const alignInHeader = await page.locator('[data-section="position"] .vector-section__head [role="group"][aria-label="Align"]').count()
  check('align is a row of icons in the Position header', alignInHeader === 1)
  check('align is not a section of its own', (await measure()).sections.includes('align') === false)

  // Folding a section survives a reload.
  await page.click('[data-section="effects"] .vector-section__title')
  await page.waitForTimeout(200)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('paramrig.vector-inspector.v1') ?? '{}'))
  check('a folded section is written down', (stored.collapsed ?? []).includes('effects'), JSON.stringify(stored))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(400)
  await page.locator('#main').focus()
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(300)
  const folded = await page.locator('[data-section="effects"]').getAttribute('data-open')
  check('it comes back folded', folded === 'false', String(folded))

  // The tab is remembered per document.
  await page.click('[role="tab"][id="vector-tab-controls"]')
  await page.waitForTimeout(200)
  check('the Controls tab says what it is for', (await page.locator('.vector-inspector__body').innerText()).includes('No controls yet'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(400)
  const selected = await page.locator('[role="tab"][aria-selected="true"]').innerText()
  check('the tab comes back with the document', selected.trim() === 'Controls', selected)

  await page.click('[role="tab"][id="vector-tab-history"]')
  await page.waitForTimeout(200)
  check('history has a tab of its own', await page.locator('[data-section="history"]').count() === 1)
  await page.click('[role="tab"][id="vector-tab-design"]')
  await page.waitForTimeout(200)

  // Node mode swaps Position for Node.
  await page.locator('#main').focus()
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const nodeSections = (await measure()).sections
  check('node mode replaces Position with Node', nodeSections[0] === 'node' && !nodeSections.includes('position'), nodeSections.join(','))
})
