/*
 * The moves every web script makes.
 *
 * The workspace is opened through the connections page rather than by deep link, because that is
 * the path a person takes, and because the deep link is the subject of one script rather than the
 * preamble of all of them.
 */
import { BASE } from './lib.mjs'

/**
 * A draft the browser is holding ahead of the file on disk blocks every write until someone
 * chooses between the two versions — which is exactly what a killed run leaves behind, since the
 * recovery copy in IndexedDB is written before the file is. A script that does not make that
 * choice writes nothing and fails on the state it thought it had saved. It takes the project's
 * file: that is the version every other window shares.
 */
export async function settleRecovery(page) {
  const choice = page.getByRole('button', { name: 'Use the project file' })
  if (await choice.count() === 0) return false
  await choice.click()
  await page.waitForTimeout(800)
  return true
}

/** Opens the Fieldnotes workspace and waits for the preview to answer. */
export async function openWorkspace(page, { theme } = {}) {
  await page.goto(`${BASE}/web`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (theme) {
    const changed = await page.evaluate(value => {
      const had = localStorage.getItem('paramrig.theme')
      localStorage.setItem('paramrig.theme', value)
      return had !== value
    }, theme)
    if (changed) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  }
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.waitForSelector('.web-toolbar')
  await settled(page)
  await settleRecovery(page)
}

/** Waits for the preview to be connected — the notice is gone. */
export function settled(page) {
  return page.waitForFunction(() => document.querySelectorAll('.web-connection-notice').length === 0, null, { timeout: 30000 })
}

/** Removes every comment in the draft. The draft is shared, so a script cleans up after itself. */
export async function clearComments(page, guard = 10) {
  await page.locator('button[aria-label^="Comments"]').click()
  await page.waitForTimeout(300)
  for (let attempt = 0; attempt < guard; attempt += 1) {
    const rows = page.locator('.web-ticket-list button')
    if (await rows.count() === 0) break
    await rows.first().click()
    await page.waitForTimeout(300)
    await page.locator('button[aria-label="Remove ticket"]').click()
    await page.waitForTimeout(400)
  }
  return page.locator('.web-ticket-list button').count()
}
