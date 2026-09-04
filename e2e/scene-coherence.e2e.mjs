import { run } from './lib.mjs'

/**
 * Chantier O4: the editor read as one thing rather than as thirty.
 *
 * These are the rules of the prompt's first section, asked of the running application rather than
 * of the stylesheet: one spacing scale, one section header, no label said twice in the same panel,
 * an empty state that says what to do, no full-width button outside a form, and one word for one
 * thing. A rule that cannot be asked of the page is not checked here; it is said in the bilan.
 */

/** The spacing tokens the design system declares, as pixels. */
const SCALE = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64]

export default run('scene-coherence', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.waitForTimeout(400)

  /* ------------------------------------------------------------ one spacing scale */

  const spacing = await page.evaluate((scale) => {
    const odd = []
    const seen = new Map()
    for (const node of document.querySelectorAll('.scene-properties *, .scene-sidebar *, .scene-header *, .scene-toolbar *')) {
      const style = getComputedStyle(node)
      /*
       * A hair space between a number and its unit is set in em, so that it follows the type
       * rather than the layout; it is a typographic detail rather than a step of the scale, and
       * the only one in the chrome.
       */
      if (node.classList.contains('number-value__unit')) continue
      for (const property of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'gap', 'rowGap', 'columnGap']) {
        const raw = style[property]
        if (!raw || raw === 'normal') continue
        const value = Math.round(Number.parseFloat(raw) * 100) / 100
        if (!Number.isFinite(value) || value === 0) continue
        if (scale.includes(value)) continue
        const label = `${value}px ${property}`
        seen.set(label, (seen.get(label) ?? 0) + 1)
      }
    }
    for (const [label, count] of seen) odd.push(`${label} ×${count}`)
    return odd.sort()
  }, SCALE)
  for (const entry of spacing.slice(0, 8)) log(`  off the scale: ${entry}`)
  check('every padding and gap in the chrome is a step of the one scale',
    spacing.length === 0, spacing.slice(0, 4).join(', ') || 'all on the scale')

  /* ------------------------------------------------- one heading, no double labels */

  const headings = await page.evaluate(() => {
    const bad = []
    for (const section of document.querySelectorAll('.scene-properties .scene-section')) {
      const own = section.querySelectorAll(':scope > .scene-section__head').length
      if (own !== 1) bad.push(`${section.getAttribute('aria-label')}: ${own} heads`)
    }
    return bad
  })
  check('every section of the properties has exactly one header', headings.length === 0, headings.join(', ') || 'one each')

  const duplicates = await page.evaluate(() => {
    const found = []
    for (const panel of document.querySelectorAll('.scene-properties .scene-section')) {
      const labels = [...panel.querySelectorAll('.control__label, .segment-field__label, .scene-axes__label')]
        .map((node) => node.textContent.trim())
        .filter(Boolean)
      const counts = new Map()
      for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
      for (const [label, count] of counts) {
        if (count > 1) found.push(`${panel.getAttribute('aria-label')} · ${label} ×${count}`)
      }
    }
    return found
  })
  check('no label is said twice inside one section', duplicates.length === 0, duplicates.join(', ') || 'each said once')

  /* ---------------------------------------------------------------- empty states */

  const empties = []
  for (const [tab, expected] of [['Modifiers', /add/i], ['Material', /material/i]]) {
    await page.locator(`.scene-properties__tab[aria-label="${tab}"]`).click()
    await page.waitForTimeout(300)
    const text = await page.locator('.scene-properties__body').innerText()
    empties.push(`${tab}: ${text.split('\n').slice(0, 2).join(' ')}`)
    check(`the ${tab} tab says what to do rather than showing nothing`,
      text.trim().length > 0 && (text.length > 40 || expected.test(text)), text.slice(0, 80))
  }
  log(`  ${empties.join(' | ')}`)

  /* ------------------------------------------------- no full-width buttons outside forms */

  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForTimeout(300)
  const wide = await page.evaluate(() => {
    const found = []
    for (const panel of document.querySelectorAll('.scene-properties__body, .scene-sidebar__body')) {
      const width = panel.getBoundingClientRect().width
      for (const button of panel.querySelectorAll('button')) {
        // A segmented choice and a switch are one control drawn as buttons, not a button each.
        if (button.closest('.segment, .switch, .scene-menu, [role="radiogroup"], form')) continue
        const box = button.getBoundingClientRect()
        if (box.width >= width - 24 && box.width > 0) {
          found.push(`${button.getAttribute('aria-label') ?? button.textContent.trim().slice(0, 24)} ${Math.round(box.width)}px`)
        }
      }
    }
    return found
  })
  for (const entry of wide.slice(0, 6)) log(`  full width: ${entry}`)
  check('no button spans a panel outside a form', wide.length === 0, wide.slice(0, 3).join(', ') || 'none')

  /* --------------------------------------------------------- one word for one thing */

  const words = await page.evaluate(() => {
    const text = document.body.innerText
    const forbidden = [
      ['Shape', /\\bShapes?\\b/],
      ['Item', /\\bItems?\\b/],
      ['Element', /\\bElements?\\b/],
      ['Entity', /\\bEntit(y|ies)\\b/],
    ]
    return forbidden.filter(([, pattern]) => pattern.test(text)).map(([word]) => word)
  })
  // "Item" is Blender's own name for the sidebar's first tab, and is the exception that stays.
  check('the editor calls a thing by one name', words.filter((word) => word !== 'Item').length === 0,
    words.join(', ') || 'no synonyms in the chrome')

  /* ------------------------------------------------------------------ the tooltips */

  const tips = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.scene-header button, .scene-toolbar button')]
    // A button with words on it names itself; the rest need a label or the tooltip that carries one.
    const missing = buttons.filter((node) => (
      !node.closest('[data-tooltip-anchor]')
      && !node.getAttribute('aria-label')
      && node.textContent.trim().length === 0
    ))
    return {
      buttons: buttons.length,
      missing: missing.length,
      names: missing.map((node) => `${node.className.split(' ')[0]}:${node.textContent.trim().slice(0, 20)}`),
    }
  })
  check('every button of the header and the tool bar can name itself',
    tips.missing === 0, tips.names?.join(', ') || `${tips.missing} of ${tips.buttons} unnamed`)
  log(`MEASURE header and tool bar buttons: ${tips.buttons}`)

  await shot('scene-coherence-1440.png')
})
