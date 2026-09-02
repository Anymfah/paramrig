import { run } from './lib.mjs'

/** The follow-ups: the diamond on every line, the tabs, the shape drafts, the corner handle. */
export default run('chantier-p', async ({ page, check, log, helpers }) => {
  await helpers.newDocument()
  // A section another script folded away would hide the lines this one is about.
  await page.evaluate(() => localStorage.removeItem('paramrig.vector-inspector.v1'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(300)

  // 1. The rail's tabs are the same strip as the inspector's, not a pair of pills.
  const tabs = await page.evaluate(() => {
    const rail = document.querySelector('.vector-layers__tab')
    const inspector = document.querySelector('.vector-inspector__tabs [role="tab"]')
    const read = (node) => {
      const style = getComputedStyle(node)
      return { border: style.borderTopWidth, background: style.backgroundColor, weight: style.fontWeight, height: Math.round(node.getBoundingClientRect().height) }
    }
    return { rail: read(rail), inspector: read(inspector) }
  })
  log(`MEASURE tabs: ${JSON.stringify(tabs)}`)
  check('the rail tab carries no button chrome of its own', tabs.rail.border === '0px', JSON.stringify(tabs.rail))
  check('and matches the inspector strip', tabs.rail.height === tabs.inspector.height && tabs.rail.weight === tabs.inspector.weight, JSON.stringify(tabs))

  // 2. A shape is drawn as itself while the pointer is down.
  await page.click('[aria-label="Shape tools"]')
  await page.waitForSelector('.vector-tool-menu__content')
  await page.click('.vector-tool-menu__item:has-text("Star")')
  await page.waitForTimeout(250)
  const from = await helpers.toClient({ x: 150, y: 150 })
  const to = await helpers.toClient({ x: 420, y: 400 })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  const starDraft = await page.evaluate(() => {
    const node = document.querySelector('.vector-draft')
    return node ? { tag: node.tagName, corners: (node.getAttribute('d') ?? '').split('L').length - 1, dashed: getComputedStyle(node).strokeDasharray } : null
  })
  await page.mouse.up()
  await page.waitForTimeout(300)
  check('a star is drafted as a star, not a box', starDraft?.tag === 'path' && starDraft.corners === 9, JSON.stringify(starDraft))
  check('and the draft is not dashed like a marquee', starDraft?.dashed === 'none', String(starDraft?.dashed))
  const star = (await helpers.doc()).elements.at(-1)
  check('and lands as a star', star?.kind === 'polygon' && star.name === 'Star' && (star.innerRatio ?? 0) > 0, JSON.stringify({ kind: star?.kind, name: star?.name, innerRatio: star?.innerRatio }))

  for (const [key, tool, tag] of [['o', 'ellipse', 'ellipse'], ['l', 'line', 'line'], ['r', 'rectangle', 'rect']]) {
    await page.locator('#main').focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press(key)
    const a = await helpers.toClient({ x: 500, y: 150 })
    const b = await helpers.toClient({ x: 700, y: 330 })
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 5 })
    const drafted = await page.evaluate(() => document.querySelector('.vector-draft')?.tagName ?? null)
    await page.mouse.up()
    await page.waitForTimeout(250)
    check(`the ${tool} is drafted as a ${tag}`, drafted === tag, String(drafted))
  }

  // 3. A corner of a path can be pulled round on the canvas.
  await helpers.newDocument()
  await page.keyboard.press('r')
  await helpers.drag({ x: 200, y: 180 }, { x: 520, y: 420 })
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('a corner offers no handle before it is selected', await page.locator('.vector-nodes__radius').count() === 0)
  await page.click('.vector-nodes__point >> nth=0', { force: true })
  await page.waitForTimeout(300)
  check('a selected corner offers a radius handle', await page.locator('.vector-nodes__radius').count() === 1)
  const handle = await page.locator('.vector-nodes__radius').first().boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 40, handle.y + 30, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const radii = (await helpers.doc()).elements[0].network?.nodes.map((node) => node.radius ?? 0) ?? []
  check('pulling it rounds that corner and no other', radii[0] > 0 && radii.slice(1).every((value) => value === 0), JSON.stringify(radii))
  const steps = await page.locator('.vector-history__step').count()
  await page.locator('#main').focus()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(400)
  check('and undo takes the whole pull back', ((await helpers.doc()).elements[0].network?.nodes[0]?.radius ?? 0) === 0)
  log(`MEASURE history steps after the pull: ${steps}`)

  // 4. The diamond reaches the paint and effect lines.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  const fillPopover = await helpers.openPaint('fill')
  check('the fill popover offers the colour as a control', await fillPopover.locator('[aria-label*="Expose"][aria-label*="colour"]').count() === 1)
  check('and the layer opacity too', await fillPopover.locator('[aria-label*="Expose"][aria-label*="opacity"]').count() === 1)
  await fillPopover.locator('[aria-label*="Expose"][aria-label*="colour"]').click()
  await page.waitForSelector('.vector-expose-popover')
  await page.click('[data-action="expose"]')
  await page.waitForTimeout(600)
  const rig = (await helpers.doc()).rig
  check('exposing a paint colour binds fills[0].color', rig?.bindings?.[0]?.property === 'fills[0].color', JSON.stringify(rig?.bindings?.[0]))
  check('and the control is a colour', rig?.parameters?.[0]?.kind === 'color', JSON.stringify(rig?.parameters?.[0]))
  await page.click('#vector-tab-design')
  await page.waitForTimeout(300)
  check('the fill line says it is driven', await page.locator('[data-section="fill"] .vector-row[data-driven] .vector-row__driven').count() === 1)

  // An effect line, the same way.
  await page.click('[data-section="effects"] [aria-label="Add an effect"]')
  await page.waitForTimeout(400)
  await helpers.openSection('effects')
  const effectPopover = await helpers.openPaint('effects')
  const diamonds = await effectPopover.locator('[aria-label^="Expose"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  check('every field of a shadow can be exposed', diamonds.length === 6, diamonds.join(' / '))
})
