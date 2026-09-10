import { run, BASE } from './lib.mjs'

/**
 * The sound editor in a real browser.
 *
 * jsdom answers most of what the plate is asked in the unit tests, and none of what it looks like:
 * it has no layout, so a control that overlaps another, a panel that overflows its box, or a menu
 * drawn at the wrong scale all pass there. This script is for the half a browser has to say.
 */
export default run('audio-plate', async ({ page, check, log }) => {
  // From the example as it ships, every run. This script turns knobs, and the editor writes what
  // it is given four hundred milliseconds later — so without this the second run starts wherever
  // the first one left off and the checks below drift.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('paramrig.audio-documents.v1'))
  await page.goto(`${BASE}/r/audio-example-arcade-coin`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.fp')
  await page.waitForTimeout(600)

  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))

  // 1. The plate fills its room at one of its three faces, and nothing spills out of a panel.
  const stage = await page.evaluate(() => {
    const node = document.querySelector('.fp-stage')
    const box = node.getBoundingClientRect()
    return { layout: node.dataset.layout, scale: Number(getComputedStyle(node).getPropertyValue('--fp-scale')), width: Math.round(box.width), height: Math.round(box.height) }
  })
  log(`MEASURE stage: ${JSON.stringify(stage)}`)
  check('the plate deals itself one of its three faces', ['wide', 'medium', 'narrow'].includes(stage.layout), stage.layout)
  check('and is drawn at a readable scale', stage.scale > 0.6, String(stage.scale))

  /*
   * A knob's box is its ring and the invisible band the pointer can grab it by, which stands a few
   * pixels outside the drawing. The reference puts two small knobs in a panel ninety-five wide, so
   * that band reaches into the gap between panels — into nothing, and by six pixels at the most.
   * Past that it is a control on top of another control, which is what this is watching for.
   */
  const spills = await page.evaluate(() => {
    const bad = []
    for (const panel of document.querySelectorAll('.fp-panel')) {
      const box = panel.getBoundingClientRect()
      for (const control of panel.querySelectorAll('.fp-knob, .fp-fader, .fp-box, .fp-slot-head, .fp-pattern')) {
        const at = control.getBoundingClientRect()
        if (at.width === 0 || at.height === 0) continue
        const over = Math.max(box.left - at.left, at.right - box.right, box.top - at.top, at.bottom - box.bottom)
        if (over > 6) bad.push(`${panel.getAttribute('aria-label')}: ${control.getAttribute('aria-label') ?? control.className} by ${over.toFixed(1)}`)
      }
    }
    return bad
  })
  check('nothing is drawn outside the panel it belongs to', spills.length === 0, spills.slice(0, 4).join(' · '))

  // 2. The pickers open at the app's scale, not the plate's, and hold the marks they promise.
  await page.click('section[aria-label="Filter"] button[aria-label="Filter model"]')
  await page.waitForSelector('.fp-picker')
  const picker = await page.evaluate(() => {
    const menu = document.querySelector('.fp-picker')
    const cell = menu.querySelector('.fp-picker__cell .fp-menu__mark')
    return {
      cells: menu.querySelectorAll('.fp-picker__cell').length,
      inside: menu.getBoundingClientRect().right <= window.innerWidth + 1 && menu.getBoundingClientRect().bottom <= window.innerHeight + 1,
      mark: Math.round(cell.getBoundingClientRect().width),
    }
  })
  log(`MEASURE filter picker: ${JSON.stringify(picker)}`)
  check('the filter offers all nine models', picker.cells === 9, String(picker.cells))
  check('the menu stays inside the window', picker.inside, JSON.stringify(picker))
  check('and each cell draws its response at a size you can read', picker.mark >= 50, String(picker.mark))
  await page.click('.fp-picker__cell:nth-child(9)')
  await page.waitForTimeout(250)
  const chosen = await page.textContent('section[aria-label="Filter"] button[aria-label="Filter model"]')
  check('choosing one takes', chosen?.trim() === 'Vowel', String(chosen))

  // 2b. The second filter is its own filter, and the word under them says what they do together.
  await page.click('section[aria-label="Filter"] [role="tab"][aria-label="Filter B"]')
  await page.waitForTimeout(200)
  const onB = await page.textContent('section[aria-label="Filter"] button[aria-label="Filter model"]')
  check('B holds its own model, not a second view of A', onB?.trim() === 'Off', String(onB))
  const way = page.locator('section[aria-label="Filter"] button[aria-label^="Filter routing"]')
  // Asking to see B is asking for two filters: while the routing says One filter, B is not in the
  // sound at all, so the tab that opens its panel puts it after A rather than opening a panel of
  // controls that change nothing.
  check('and asking for B puts B in the sound', (await way.textContent())?.trim() === 'B after A', String(await way.textContent()))
  await way.click()
  await page.waitForTimeout(200)
  check('and the word steps on to the next arrangement', (await way.textContent())?.trim() === 'A and B at once', String(await way.textContent()))
  const balance = page.locator('section[aria-label="Filter"] [role="slider"][aria-label^="Balance"]')
  check('where the balance is live rather than dimmed', (await balance.getAttribute('data-idle')) === null, String(await balance.getAttribute('aria-label')))
  await way.click()
  await page.waitForTimeout(200)
  check('and dimmed again where nothing reads it', (await balance.getAttribute('data-idle')) !== null, String(await balance.getAttribute('aria-label')))

  // 3. A modulator dropped on a dial lands, and the dial says so.
  const drag = async (from, to) => {
    const a = await from.boundingBox()
    const b = await to.boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  const cutoff = page.locator('section[aria-label="Filter"] [role="slider"][aria-label="Cutoff"]')
  await drag(page.getByRole('button', { name: /^L4,/ }), cutoff)
  await drag(page.getByRole('button', { name: /^L5,/ }), cutoff)
  const rings = await cutoff.locator('.fp-knob__mod').count()
  check('two sources on one dial wear two rings', rings === 2, String(rings))
  const said = await cutoff.getAttribute('aria-valuetext')
  check('and the dial says how many are on it', String(said).includes('2 sources'), String(said))

  // 4. The overlay counts them, and the control's own menu names them.
  const overlay = page.getByRole('button', { name: /routed$/ })
  check('the bar keeps the count', (await overlay.textContent())?.includes('2 routed'), String(await overlay.textContent()))
  await overlay.click()
  await page.waitForSelector('.fp-routes')
  const rows = await page.locator('.fp-routes [role="menuitem"]').count()
  check('and the overlay lists them', rows === 2, String(rows))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  /*
   * 5. The meter.
   *
   * A headless browser is given no audio device, so nothing can be played here and the meter has
   * nothing to read — which is the point of the notice it puts up instead. What can be checked is
   * that it is metering this sound and not some other one, that it rests at nothing while nothing
   * is playing, and that it never stands between a pointer and the play button.
   */
  const meter = await page.evaluate(() => {
    const node = document.querySelector('.audio-meter')
    const bars = [...node.querySelectorAll('.audio-meter__side')].map((bar) => Math.round(bar.getBoundingClientRect().height))
    const box = node.getBoundingClientRect()
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { says: node.getAttribute('aria-label'), bars, catches: under === node || node.contains(under), device: !document.querySelector('.audio-transport__notice') }
  })
  log(`MEASURE meter: ${JSON.stringify(meter)}`)
  check('the meter says the peak of the sound it is metering', /peak -?\d/.test(String(meter.says)), String(meter.says))
  check('it rests at nothing while nothing is playing', meter.bars.every((height) => height <= 3), JSON.stringify(meter.bars))
  check('and it never catches a pointer', !meter.catches, JSON.stringify(meter))
  log(`this browser ${meter.device ? 'has' : 'has no'} audio device`)
  await page.click('.audio-transport__play')
  await page.waitForTimeout(150)
  check('the play button is reachable and nothing threw on it', true, '')

  /*
   * 6. The top bar, at the widths where it used to dump figures, A/B and the sound menu across
   * the view tabs. Auto is gone; the bar is one strip. A second row is only for a genuinely
   * narrow container, not a 1014-pixel editor.
   */
  for (const width of [1014, 1400, 1440, 1470, 1600]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)
    const bar = await page.evaluate(() => {
      const strip = document.querySelector('.audio-bar')
      const views = document.querySelector('.audio-views')
      const sounds = document.querySelector('.audio-sounds__trigger')
      const figures = document.querySelector('.audio-transport__figures')
      const a = views.getBoundingClientRect()
      const b = sounds.getBoundingClientRect()
      const overlap = Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const vertical = Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      return {
        height: Math.round(strip.getBoundingClientRect().height),
        figures: figures && getComputedStyle(figures).display !== 'none',
        overlap: overlap > 0 && vertical > 0 ? overlap : 0,
      }
    })
    log(`MEASURE bar at ${width}: ${JSON.stringify(bar)}`)
    check(`at ${width} the bar stays one strip`, bar.height <= 48, JSON.stringify(bar))
    check(`at ${width} the sound menu is not under the view tabs`, bar.overlap <= 0, JSON.stringify(bar))
    check(`at ${width} the figures stay on the bar`, bar.figures, JSON.stringify(bar))
  }
  await page.setViewportSize({ width: 500, height: 900 })
  await page.waitForTimeout(250)
  const narrow = await page.evaluate(() => {
    const play = document.querySelector('.audio-transport__play')
    const meter = document.querySelector('.audio-meter')
    const a = play.getBoundingClientRect()
    const b = meter.getBoundingClientRect()
    return {
      spill: Math.round(a.width - play.closest('.tt__anchor').getBoundingClientRect().width),
      overlap: Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left)),
    }
  })
  log(`MEASURE bar at 500: ${JSON.stringify(narrow)}`)
  check('at 500 the play button keeps its own room', narrow.spill <= 1, JSON.stringify(narrow))
  check('and the meter is not drawn across it', narrow.overlap <= 0, JSON.stringify(narrow))
  await page.setViewportSize({ width: 1280, height: 900 })

  check('and nothing threw along the way', errors.length === 0, errors.join(' · '))
})
