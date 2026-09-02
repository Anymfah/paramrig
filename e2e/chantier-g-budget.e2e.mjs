import { run } from './lib.mjs'

/** How long a 1024×1024 silhouette takes, and whether the page keeps painting while it does. */
export default run('chantier-g-budget', async ({ page, check, helpers }) => {
  await helpers.newDocument()
  const png = await page.evaluate(() => {
    const size = 1024
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.fillStyle = '#101010'
    for (let index = 0; index < 24; index += 1) {
      context.beginPath()
      context.arc(120 + (index % 6) * 160, 120 + Math.floor(index / 6) * 160, 60, 0, Math.PI * 2)
      context.fill()
    }
    return canvas.toDataURL('image/png')
  })
  await page.evaluate((data) => {
    const key = 'paramrig.vector-documents.v1'
    const all = JSON.parse(localStorage.getItem(key) ?? '{}')
    const id = location.pathname.split('/r/')[1]
    all[id] = { ...all[id], elements: [{
      id: 'photo', kind: 'image', name: 'Photo', x: 0, y: 0, width: 600, height: 600, rotation: 0,
      fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
      image: data, imageWidth: 1024, imageHeight: 1024,
    }] }
    localStorage.setItem(key, JSON.stringify(all))
  }, png)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(500)
  await page.locator('.vector-layer__select').first().click()
  await page.locator('#main').focus()
  await page.keyboard.press('Meta+/')
  await page.waitForSelector('.vector-palette__input')
  await page.keyboard.type('Trace image')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.vector-trace')
  await page.waitForTimeout(1200)

  // Count the animation frames the page manages while the trace runs: a frozen page manages none.
  await page.evaluate(() => {
    window.__frames = 0
    const tick = () => { window.__frames += 1; window.__raf = requestAnimationFrame(tick) }
    window.__raf = requestAnimationFrame(tick)
  })
  const started = Date.now()
  await page.click('[data-action="trace"]')
  await page.waitForFunction(() => !document.querySelector('.vector-trace'), null, { timeout: 30000 })
  const elapsed = Date.now() - started
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames })
  const paths = (await helpers.doc()).elements.filter((element) => element.kind === 'path').length
  check(`a 1024×1024 silhouette traces in ${elapsed}ms`, elapsed < 1000, `${paths} paths, budget 1000ms`)
  check('the page kept painting while it ran', frames > elapsed / 40, `${frames} frames in ${elapsed}ms`)
})
