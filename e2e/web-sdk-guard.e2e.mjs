/*
 * What the SDK does to a page that is not a workbench preview, and what the workbench says when a
 * page will not pair.
 *
 * Two of the three cases here are the ones a project's own developer meets every day and the
 * workbench never sees: their page opened normally, and their page opened by the other name their
 * development server answers to. Neither should carry a trace of ParamRig, beyond one line naming
 * the address that disagrees. The third is the workbench opened by 127.0.0.1 rather than by
 * localhost, which used to pair only by the first of the two.
 */
import { run, BASE } from './lib.mjs'
import { settleRecovery, settled } from './web-lib.mjs'

const ADDRESSES = ['http://127.0.0.1:5174', 'http://localhost:5174']
const PAGE = '/examples/web/index.html'

export default run('web-sdk-guard', async ({ page, check, log }) => {
  /*
   * The example's own origin is read from the manifest the service serves rather than assumed. The
   * alias is the other name the same development server answers to — the pair of them is the whole
   * point of this script, and getting them the wrong way round makes every check pass silently.
   */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const PROJECT = await page.evaluate(() => fetch('/api/web/state').then(r => r.json()).then(s => s.manifest.origin))
  const ALIAS = ADDRESSES.find(address => address !== PROJECT)
  check('the example declares one of the two addresses the server answers to', ADDRESSES.includes(PROJECT) && !!ALIAS, `manifest origin ${PROJECT}`)
  log(`  manifest origin ${PROJECT}, alias ${ALIAS}`)

  /*
   * The page's own console, collected around one visit. The 404 the example's missing favicon
   * produces belongs to the demo page rather than to the SDK, and the Vite client says hello on
   * every development page there is; what is being counted is what ParamRig adds to either.
   */
  const visit = async url => {
    const messages = []
    const onConsole = m => messages.push(`${m.type()}: ${m.text()}`)
    const onError = e => messages.push(`pageerror: ${String(e)}`)
    page.on('console', onConsole); page.on('pageerror', onError)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)
    const state = await page.evaluate(() => ({
      root: document.querySelector('#root')?.innerHTML.length ?? -1,
      overlays: document.querySelectorAll('paramrig-overlay').length,
      framed: window.parent !== window,
    }))
    page.off('console', onConsole); page.off('pageerror', onError)
    const ours = messages.filter(m => /ParamRig|paramrig|postMessage|recipient window/.test(m))
    return { ...state, messages, ours }
  }

  // 1. The page opened normally, at the origin its manifest declares.
  const alone = await visit(`${PROJECT}${PAGE}`)
  check('the example page opened alone is not framed', alone.framed === false)
  check('the example page opened alone renders', alone.root > 100, `#root ${alone.root} chars`)
  check('the SDK adds no overlay to a page opened alone', alone.overlays === 0)
  check('the SDK says nothing at all on a page opened alone', alone.ours.length === 0, alone.ours.join(' | '))

  // 2. The same page, at the other name the same development server answers to.
  const aliased = await visit(`${ALIAS}${PAGE}`)
  check('the page reached by a host alias still renders whole', aliased.root > 100, `#root ${aliased.root} chars`)
  check('the page reached by a host alias has no overlay', aliased.overlays === 0)
  check('a host alias costs exactly one message', aliased.ours.length === 1, aliased.ours.join(' | '))
  const warning = aliased.ours[0] ?? ''
  check('that message is a warning, not an error', warning.startsWith('warning:'), warning)
  check('it names the page origin', warning.includes(ALIAS), warning)
  check('it names the manifest origin', warning.includes(PROJECT), warning)
  check('nothing throws through it', !aliased.messages.some(m => m.startsWith('pageerror:')), aliased.messages.filter(m => m.startsWith('pageerror:')).join(' | '))
  log(`  alias page console: ${aliased.messages.join(' | ')}`)

  /*
   * 3. The workbench reached by either of its own addresses.
   *
   * Measured the way `web-connect` measures: the lifetime of the connection notice, read by a rAF
   * loop in the page's own clock, because the round trip from the container is the same order as
   * the thing being timed. The deep link is used rather than the connections page because a
   * browser that has never opened the workbench at this origin has nothing in its library.
   */
  const stopwatch = () => {
    window.__guard = { notice: null, done: [] }
    let at = null
    let sawBar = false
    const tick = () => {
      const bar = !!document.querySelector('.web-toolbar')
      const notice = document.querySelector('.web-connection-notice')
      if (bar && !sawBar) { sawBar = true; if (notice) at = performance.now() }
      if (sawBar && notice && at === null) at = performance.now()
      if (sawBar && notice && !window.__guard.notice) window.__guard.notice = notice.textContent
      if (sawBar && !notice && at !== null) { window.__guard.done.push(Math.round(performance.now() - at)); at = null }
      requestAnimationFrame(tick)
    }
    tick()
  }
  await page.addInitScript(stopwatch)

  const pairAt = async origin => {
    const warnings = []
    const onConsole = m => { if (/postMessage|recipient window/.test(m.text())) warnings.push(m.text()) }
    page.on('console', onConsole)
    await page.goto(`${origin}/r/web-fieldnotes`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('.web-toolbar', { timeout: 30000 })
    await settled(page)
    await settleRecovery(page)
    const took = await page.evaluate(() => window.__guard.done[0] ?? null)
    page.off('console', onConsole)
    return { took, warnings }
  }

  const byLocalhost = await pairAt('http://localhost:5174')
  const byLoopback = await pairAt('http://127.0.0.1:5174')
  log(`  paired in ${byLocalhost.took} ms by localhost, ${byLoopback.took} ms by 127.0.0.1`)
  check('the workbench pairs when opened by localhost', byLocalhost.took !== null && byLocalhost.took < 1000, `${byLocalhost.took} ms`)
  check('the workbench pairs when opened by 127.0.0.1', byLoopback.took !== null && byLoopback.took < 1000, `${byLoopback.took} ms`)
  check('neither address is slower than the other by more than half a second', Math.abs((byLoopback.took ?? 0) - (byLocalhost.took ?? 0)) < 500, `${byLocalhost.took} vs ${byLoopback.took} ms`)
  check('neither address produces a postMessage recipient warning', byLocalhost.warnings.length === 0 && byLoopback.warnings.length === 0, [...byLocalhost.warnings, ...byLoopback.warnings].join(' | '))

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
})
