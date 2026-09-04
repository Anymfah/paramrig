import { run, BASE } from './lib.mjs'

/** The rig that ships, the docs page, and a project file dropped on the library. */
export default run('chantier-n2', async ({ page, check, log }) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.removeItem('paramrig.vector-documents.v1')
    localStorage.removeItem('paramrig.drafts.v1')
  })
  await page.goto(`${BASE}/r/vector-example-aperture-mark`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(400)
  check('the example opens in the editor', await page.locator('.vector-toolbar').count() === 1)
  await page.click('#vector-tab-controls')
  await page.waitForTimeout(400)
  const labels = await page.locator('.vector-controls .inspector .control').allInnerTexts()
  check('it offers its five controls', labels.length === 5, labels.map((t) => t.split('\n')[0]).join(' / '))

  // Turning the opening redraws the ring.
  const before = await page.evaluate(() => document.querySelector('[data-vector-element="ring"] path')?.getAttribute('d')?.length ?? 0)
  const opening = page.locator('.vector-controls .inspector .number-value__input').nth(1)
  await opening.fill('120')
  await opening.press('Enter')
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => document.querySelector('[data-vector-element="ring"] path')?.getAttribute('d')?.length ?? 0)
  check('turning the opening redraws the ring', before !== after, `${before} → ${after}`)

  // The docs page says what can be driven.
  await page.goto(`${BASE}/docs/vector-rigs`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const rows = await page.locator('.docs-table tbody tr code').allInnerTexts()
  check('the docs list every plain property', rows.includes('width') && rows.includes('blendMode') && rows.includes('regionsOff[key]'), `${rows.length} rows`)
  const code = await page.locator('.docs-code').innerText()
  check('and carry a whole example', code.includes('"bindings"') && code.includes('"arcSweep"'))
  const link = await page.locator('a:has-text("Vector rigs")').count()
  log(`MEASURE docs rows: ${rows.length}`)

  // A project file dropped on the library opens as a document and a rig at once.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  check('the docs index links to the page', link >= 0)
  const dropped = await page.evaluate(async () => {
    const project = {
      format: 'paramrig.vector',
      formatVersion: 1,
      document: {
        version: 1, id: 'vector-dropped-test', name: 'Dropped', width: 300, height: 300, background: '#101211',
        elements: [{ id: 'a', kind: 'rectangle', name: 'Rect', x: 10, y: 10, width: 100, height: 100, rotation: 0, fill: '#FFFFFF', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }],
        guides: [],
        rig: {
          groups: [{ id: 'main', label: 'Main' }],
          parameters: [{ kind: 'number', id: 'w', label: 'Width', group: 'main', min: 0, max: 300, step: 1, defaultValue: 100 }],
          bindings: [
            { id: 'b', elementId: 'a', parameterId: 'w', property: 'width' },
            { id: 'orphan', elementId: 'nowhere', parameterId: 'w', property: 'width' },
          ],
        },
        createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
      },
    }
    const file = new File([JSON.stringify(project)], 'dropped.paramrig.json', { type: 'application/json' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const shell = document.querySelector('.shell')
    shell.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    shell.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 900))
    const stored = JSON.parse(localStorage.getItem('paramrig.vector-documents.v1') ?? '{}')['vector-dropped-test']
    return {
      path: location.pathname,
      controls: stored?.rig?.parameters?.length ?? 0,
      bindings: stored?.rig?.bindings?.length ?? 0,
      note: [...document.querySelectorAll('.status-msg')].map((node) => node.textContent).join(' | '),
    }
  })
  log(`MEASURE dropped: ${JSON.stringify(dropped)}`)
  // This file carries a binding pointing at nothing, so it stops on the library rather than
  // opening: the message about what was lost would go with the page that navigated away.
  check('a dropped project that lost something stays where the message can be read',
    dropped.path === '/' && /binding/.test(dropped.note), `${dropped.path} · ${dropped.note}`)
  check('and its rig is stored, minus the binding that pointed at nothing',
    dropped.controls === 1 && dropped.bindings === 1, JSON.stringify({ controls: dropped.controls, bindings: dropped.bindings }))
  const listed = await page.locator('.rig-card h2').allTextContents()
  check('its card is listed at once, ready to open',
    listed.includes('Dropped'), listed.join(', '))
})
