/*
 * The link someone else sends you. A browser that has never opened the project has nothing in
 * `paramrig.web-projects.v1`, and the registry has nothing to describe: the workspace has to ask
 * the local service instead of showing the library's "not in the example registry" page.
 */
import { run, BASE } from './lib.mjs'

export default run('web-deeplink', async ({ page, check, log }) => {
  const forget = () => page.evaluate(() => localStorage.removeItem('paramrig.web-projects.v1'))

  await page.goto(`${BASE}/web`, { waitUntil: 'domcontentloaded' })
  await forget()
  await page.goto(`${BASE}/r/web-fieldnotes`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.web-toolbar', { timeout: 20000 })
  check('a link to an unopened project opens the workspace', await page.locator('.web-toolbar').count() === 1)
  check('the registry page is never shown for a web link', await page.locator('h1:has-text("not in the example registry")').count() === 0)
  await page.waitForFunction(() => document.querySelectorAll('.web-connection-notice').length === 0, null, { timeout: 30000 })
  const name = await page.locator('.web-project-button > span:not(.web-project-mark)').innerText()
  check('the project arrives with the name the service gave it', name === 'Fieldnotes', name)

  // Having opened it once, the browser remembers it: the same link works with the service asleep.
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('paramrig.web-projects.v1') ?? '[]').map(p => p.id))
  check('the project is remembered for next time', remembered.includes('fieldnotes'), JSON.stringify(remembered))

  // An identifier the service is not connected to lands on the fallback, not on the library error.
  await forget()
  await page.goto(`${BASE}/r/web-nothinghere`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.web-connect h1', { timeout: 20000 })
  await page.waitForFunction(() => document.querySelector('.web-connect h1')?.textContent === 'Connect this web project', null, { timeout: 20000 }).catch(() => undefined)
  const heading = await page.locator('.web-connect h1').innerText()
  check('an unconnected project falls back to the connections page', heading === 'Connect this web project', heading)
  check('the fallback offers the way out', await page.locator('.web-connect a[href="/web"]').count() === 1)

  // The connections page says what the workspace is for, and what the project is.
  await page.goto(`${BASE}/web`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.web-connect__project', { timeout: 20000 })
  const lede = await page.locator('.web-connect > p').first().innerText()
  const row = await page.locator('.web-connect__project p').innerText()
  log(`NOTE connections page: ${JSON.stringify(lede.slice(0, 60))} · project row ${JSON.stringify(row)}`)
  check('the page says what it is for', lede.length > 40)
  check('the project row shows its origin and page count', row.includes('127.0.0.1:5174') && /\d+ pages?$/.test(row), row)
  const selectable = await page.evaluate(() => getComputedStyle(document.querySelector('.web-setup code')).userSelect)
  check('the setup commands stay selectable', selectable === 'text', selectable)
})
