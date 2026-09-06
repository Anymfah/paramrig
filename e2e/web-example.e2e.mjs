/*
 * The example page on its own, as a page rather than as a preview.
 *
 * It is the first thing an integrator looks at, and it is the only page in this repository whose
 * colours are all mixed from three properties a person can move — so a contrast that holds at the
 * default is not something to take on trust after any change to the stylesheet. Six of the eleven
 * text colours here were below 4.5:1 when this was first measured.
 *
 * The workspace's own side is covered by the eleven other web scripts; this one never opens it.
 */
import { run } from './lib.mjs'

const PAGE = 'http://127.0.0.1:5174/examples/web'

/** Contrast measured through a canvas: computed styles hand back `color-mix` and `oklab` as-is. */
const measure = () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  const px = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
  const lum = (rgb) => { const [r, g, b] = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05) }
  const paper = px(getComputedStyle(document.documentElement).getPropertyValue('--fn-paper'))
  const ground = (el) => { let node = el; while (node) { const back = getComputedStyle(node).backgroundColor; if (back && back !== 'transparent' && !back.endsWith(', 0)')) return px(back); node = node.parentElement } return paper }
  return ['.fn-hero p', '.fn-card p', '.fn-kicker', '.fn-eyebrow', '.fn-caption', '.fn-scroll p', '.fn-colophon span', '.fn-nav a:not(.fn-brand)', '.fn-menu > button', '.fn-link', '.fn-card a', '.fn-masthead > span', '.fn-facts dt', '.fn-facts dd']
    .map((selector) => {
      const el = document.querySelector(selector)
      if (!el) return { selector, missing: true }
      return { selector, ratio: +ratio(px(getComputedStyle(el).color), ground(el)).toFixed(2) }
    })
}

export default run('web-example', async ({ page, check, log }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${PAGE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.fn-page', { timeout: 30000 })
  await page.waitForTimeout(500)

  // Calibration: the notebook line is full ink on paper, which is ~11:1 by hand. A probe that does
  // not see that is a broken probe, and every number under it would be worth nothing.
  const readings = await page.evaluate(measure)
  const notebook = readings.find(r => r.selector === '.fn-scroll p')
  check('the contrast probe agrees with a ratio worked out by hand', notebook.ratio > 10 && notebook.ratio < 12, `${notebook.ratio}:1 for full ink on paper`)
  for (const reading of readings) log(`  ${reading.missing ? 'MISSING' : `${String(reading.ratio).padStart(5)} : 1`}  ${reading.selector}`)
  check('every text colour on the page clears 4.5:1', readings.every(r => !r.missing && r.ratio >= 4.5), readings.filter(r => r.missing || r.ratio < 4.5).map(r => `${r.selector} ${r.ratio ?? 'missing'}`).join(', '))

  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(300)
    const box = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    check(`nothing runs off the side at ${width} px`, box.scroll <= box.client + 1, `${box.scroll} vs ${box.client}`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${PAGE}/journal.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.fn-page', { timeout: 30000 })
  check('the second page is instrumented the same way', await page.locator('[data-paramrig-id="hero-title"]').count() === 1)

  // Keyboard: the first stop is the brand, and it has to be visibly ringed rather than merely focused.
  await page.goto(`${PAGE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.fn-page', { timeout: 30000 })
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => {
    const el = document.activeElement
    const style = getComputedStyle(el)
    return { tag: el.localName, text: el.textContent.trim().slice(0, 24), width: style.outlineWidth, style: style.outlineStyle }
  })
  log(`  first tab stop: ${focused.tag} "${focused.text}" · outline ${focused.width} ${focused.style}`)
  check('the first tab stop is a link with a real focus ring', focused.tag === 'a' && parseFloat(focused.width) >= 2 && focused.style !== 'none', JSON.stringify(focused))

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.fn-link', { timeout: 30000 })
  const quiet = await page.evaluate(() => getComputedStyle(document.querySelector('.fn-link')).transitionDuration)
  check('reduced motion stills the page rather than leaving it moving', /^0(\.001)?s/.test(quiet), quiet)
  await page.emulateMedia({ reducedMotion: null })
})
