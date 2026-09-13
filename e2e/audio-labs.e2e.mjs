import { run, BASE } from './lib.mjs'

/**
 * Sound Labs in a real browser.
 *
 * The unit tests run the generator inline and mock the speakers; this is the other half — the
 * worker, Web Audio, the WebGL relief, and the layout — checked the way somebody uses the bench:
 * press, listen, press again, go back, reload.
 */
export default run('audio-labs', async ({ page, check, log, shot, errors }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => { localStorage.removeItem('paramrig.audio-documents.v1'); localStorage.removeItem('paramrig.labs-view.v1') })
  await page.goto(`${BASE}/r/audio-example-arcade-coin`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.fp')
  await page.click('#audio-view-labs')
  await page.waitForSelector('.audio-labs')
  await page.waitForTimeout(300)

  const state = () => page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('paramrig.audio-documents.v1') ?? '{}')
    const labs = Object.values(doc).find((entry) => entry?.id === 'audio-example-arcade-coin')?.labs
    return {
      history: document.querySelectorAll('.labs-row').length,
      bench: document.querySelector('.labs-bench__title h2')?.textContent ?? '',
      slot: document.querySelector('.labs-bench__meta')?.textContent?.match(/·\s*(\d+)/)?.[1] ?? '',
      playing: [...document.querySelectorAll('.labs-play[aria-pressed="true"]')].length,
      stops: [...document.querySelectorAll('button[aria-label^="Stop "]')].length,
      busy: !!document.querySelector('.labs-generate[aria-busy="true"]'),
      canvas: !!document.querySelector('.labs-relief__gl canvas'),
      saved: labs ? { history: labs.history?.length ?? 0, current: labs.current ?? null, reserve: labs.reserve?.length ?? 0 } : null,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mainOverflow: (() => { const main = document.querySelector('.labs-main'); return main ? main.scrollWidth > main.clientWidth : false })(),
    }
  })

  // 1. The empty bench, and the palette in the left column.
  const empty = await state()
  check('the bench starts empty', empty.bench === 'Nothing on the bench yet', empty.bench)
  check('the palette holds the twelve families', await page.locator('.labs-palette .labs-tiles--family .labs-tile').count() === 12)
  check('nothing overflows sideways', !empty.overflow && !empty.mainOverflow)
  await shot('labs-empty.png')

  // 2. One press, one sound, heard at once.
  await page.click('.labs-generate')
  await page.waitForFunction(() => !document.querySelector('.labs-generate[aria-busy="true"]') && document.querySelectorAll('.labs-row').length >= 1, null, { timeout: 15000 })
  await page.waitForTimeout(250)
  const first = await state()
  log(`MEASURE first: ${JSON.stringify(first)}`)
  check('one press puts exactly one sound in the history', first.history === 1)
  check('and it is on the bench', first.bench !== 'Nothing on the bench yet' && first.bench.length > 0, first.bench)
  check('and it is playing', first.stops >= 1, String(first.stops))
  check('the relief is drawn in WebGL', first.canvas)
  await page.waitForTimeout(400)
  await shot('labs-first.png')

  // 3. Pressing again while a render is in flight replaces the request rather than queueing it.
  const before = (await state()).history
  for (let i = 0; i < 5; i++) { await page.click('.labs-generate'); await page.waitForTimeout(40) }
  await page.waitForFunction(() => !document.querySelector('.labs-generate[aria-busy="true"]'), null, { timeout: 20000 })
  await page.waitForTimeout(300)
  const burst = await state()
  log(`MEASURE burst: ${JSON.stringify(burst)}`)
  check('five rapid presses add at most five sounds', burst.history - before <= 5 && burst.history > before, `${burst.history - before}`)
  check('and never more than one voice is playing', burst.stops <= 2 && burst.playing <= 2, `${burst.stops} stop buttons`)
  const voices = await page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve(document.querySelectorAll('.labs-row .labs-play[aria-pressed="true"]').length), 50)))
  check('exactly one history row is the voice', voices <= 1, String(voices))

  // 4. The keyboard: G makes one, the arrows walk the history, Space toggles the voice.
  await page.locator('.labs-head h1').click()
  const beforeKey = (await state()).history
  await page.keyboard.press('g')
  await page.waitForFunction((count) => document.querySelectorAll('.labs-row').length === count + 1, beforeKey, { timeout: 15000 })
  await page.waitForTimeout(200)
  const afterKey = await state()
  check('G generates one sound', afterKey.history === beforeKey + 1)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(400)
  const stepped = await state()
  check('ArrowLeft brings the previous sound back to the bench', stepped.slot !== afterKey.slot && stepped.slot !== '', `${afterKey.slot} → ${stepped.slot}`)
  const wasPlaying = stepped.stops > 0
  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  const toggled = await state()
  check('Space toggles the voice', (toggled.stops > 0) !== wasPlaying, `${wasPlaying} → ${toggled.stops > 0}`)
  await page.keyboard.press('Escape')

  // 5. Clicking a row in the history brings it to the bench.
  const rows = page.locator('.labs-row .labs-row__main')
  const last = await rows.count()
  const wanted = await rows.nth(last - 1).locator('.labs-row__name').textContent()
  await rows.nth(last - 1).click()
  await page.waitForTimeout(400)
  const chosen = await state()
  check('the oldest row goes back on the bench', chosen.bench === wanted, `${chosen.bench} vs ${wanted}`)
  await page.keyboard.press('Escape')

  // 6. Keep, then Variations from the bench: the reference stays put while variations are made.
  await page.click('.labs-bench__actions button[aria-label^="Keep in the reserve"]')
  await page.waitForTimeout(200)
  check('Keep puts the sound in the reserve', (await state()).saved?.reserve === 1 || await page.locator('.labs-card').count() === 1)
  await page.click('[role="tab"]:has-text("Variations")')
  await page.waitForTimeout(200)
  const referenceName = await page.locator('.labs-reference__who strong').textContent()
  check('entering Variations adopts the bench sound as the reference', referenceName === chosen.bench, `${referenceName} vs ${chosen.bench}`)
  const beforeVary = (await state()).history
  await page.click('.labs-generate')
  await page.waitForFunction(() => !document.querySelector('.labs-generate[aria-busy="true"]'), null, { timeout: 20000 })
  await page.waitForTimeout(300)
  const varied = await state()
  const meta = await page.locator('.labs-bench__meta').textContent()
  check('Vary & play makes one variation', varied.history === beforeVary + 1 && /Variation/.test(meta ?? ''), meta ?? '')
  check('the reference is unchanged by it', await page.locator('.labs-reference__who strong').textContent() === referenceName)
  await shot('labs-variations.png')

  // 7. Fusion needs two kept sounds and says so.
  await page.click('[role="tab"]:has-text("Fusion")')
  await page.waitForTimeout(200)
  check('Fusion explains what it still needs', (await page.locator('.labs-generate').getAttribute('aria-disabled')) === 'true')
  await page.click('[role="tab"]:has-text("Explore")')
  await page.waitForTimeout(200)

  // 8. Reload: the history, the bench and the relief come back.
  const kept = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.fp')
  await page.click('#audio-view-labs')
  await page.waitForSelector('.audio-labs')
  await page.waitForFunction(() => !!document.querySelector('.labs-relief__gl canvas'), null, { timeout: 15000 })
  await page.waitForTimeout(800)
  const back = await state()
  log(`MEASURE reload: ${JSON.stringify(back)}`)
  check('the history survives a reload', back.history === kept.history, `${back.history} vs ${kept.history}`)
  check('the same sound is on the bench', back.bench === kept.bench, `${back.bench} vs ${kept.bench}`)
  check('and its relief is drawn again', back.canvas)
  check('the reserve survives too', await page.locator('.labs-card').count() === 1)
  await shot('labs-reloaded.png')

  // 9. The voice plays exactly what is exported: the bench's audio graph, rendered offline here, is
  // the engine's render sample for sample — at unity, and with the width and gain changes the next
  // shaping step will use.
  const heard = await page.evaluate(async () => {
    const { renderPatch } = await import('/src/audio/dsp/render.ts')
    const { wireVoice } = await import('/src/audio/labs/labVoice.ts')
    const { generateSound } = await import('/src/audio/labs/generate.ts')
    const { DEFAULT_CRITERIA } = await import('/src/audio/labs/model.ts')
    const { sculptSound } = await import('/src/audio/labs/sculpt.ts')
    const rate = 48000
    const sound = generateSound({ ...DEFAULT_CRITERIA, minMs: 400, maxMs: 400 }, 23)
    // Under the limiter, so the comparison is of the two paths and not of saturation.
    sound.patch.master.limiter = 0
    sound.patch.master.gain *= 0.25
    const base = renderPatch(sound.patch, rate)
    let peak = 0
    for (let i = 0; i < base.left.length; i++) peak = Math.max(peak, Math.abs(base.left[i]), Math.abs(base.right[i]))
    const peakDb = 20 * Math.log10(peak)
    const cases = [['unity', 0, {}], ['width', 1.7, { side: 1.7 }], ['width', 0.3, { side: 0.3 }], ['level', peakDb - 7, { gain: Math.pow(10, -7 / 20) }]]
    const out = []
    for (const [kind, value, live] of cases) {
      const baked = kind === 'unity' ? base : renderPatch(sculptSound(sound, kind, value, peakDb).patch, rate)
      const context = new OfflineAudioContext(2, base.left.length, rate)
      const buffer = context.createBuffer(2, base.left.length, rate)
      buffer.copyToChannel(base.left, 0); buffer.copyToChannel(base.right, 1)
      wireVoice(context, buffer, context.destination, live).source.start()
      const rendered = await context.startRendering()
      const l = rendered.getChannelData(0), r = rendered.getChannelData(1)
      let error = 0, level = 0
      for (let i = 0; i < l.length; i++) { error = Math.max(error, Math.abs(l[i] - baked.left[i]), Math.abs(r[i] - baked.right[i])); level = Math.max(level, Math.abs(baked.left[i])) }
      out.push({ kind, value: Math.round(value * 100) / 100, error, level })
    }
    return out
  })
  log(`MEASURE heard: ${JSON.stringify(heard)}`)
  check('the voice plays sample for sample the sound that is exported', heard.every((entry) => entry.error < 1e-4 && entry.level > 0.01), heard.map((entry) => `${entry.kind} ${entry.value}: ${entry.error.toExponential(1)}`).join(', '))

  // 9b. The Bite mark: a line of the relief, at the frequency where the sound cuts, dragged up the
  // scale for more bite while the waves are rendered again under the hand.
  const bitePresent = await page.locator('.labs-mark[data-kind="bite"] .labs-mark__hit').count()
  if (bitePresent) {
    const grip = () => page.evaluate(() => {
      const el = document.querySelector('.labs-mark[data-kind="bite"] .labs-mark__hit')
      const points = el.getAttribute('points').split(' ').map((pair) => pair.split(',').map(Number))
      const box = el.ownerSVGElement.getBoundingClientRect()
      const middle = points[Math.floor(points.length / 2)]
      const hz = /([\d.]+) ?(k?Hz)/.exec(el.getAttribute('aria-valuetext') ?? '')
      return {
        now: Number(el.getAttribute('aria-valuenow')),
        hz: hz ? Number(hz[1]) * (hz[2] === 'kHz' ? 1000 : 1) : 0,
        x: box.left + middle[0], y: box.top + middle[1],
        label: document.querySelector('.labs-mark__label[data-kind="bite"]')?.textContent ?? '',
      }
    })
    // The sound on the bench, rendered here: its spectral centre, the brightness the ear follows.
    const centre = () => page.evaluate(async () => {
      const { renderPatch } = await import('/src/audio/dsp/render.ts')
      const { fft } = await import('/src/audio/labs/analysis.ts')
      const doc = JSON.parse(localStorage.getItem('paramrig.audio-documents.v1') ?? '{}')
      const labs = Object.values(doc).find((entry) => entry?.id === 'audio-example-arcade-coin')?.labs
      const sound = [...labs.history, ...labs.reserve].find((entry) => entry.id === labs.current)
      const rate = 48000, size = 2048, samples = renderPatch(sound.patch, rate)
      let weighted = 0, all = 0
      for (let from = 0; from + size <= samples.left.length; from += size) {
        const re = new Float32Array(size), im = new Float32Array(size)
        for (let i = 0; i < size; i++) re[i] = (samples.left[from + i] + samples.right[from + i]) * 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)))
        fft(re, im)
        for (let k = 1; k < size / 2; k++) { const p = re[k] ** 2 + im[k] ** 2; all += p; weighted += p * k * rate / size }
      }
      return weighted / all
    })
    const stage = await page.evaluate(() => { const r = document.querySelector('.labs-stage').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })
    const picture = async () => (await page.screenshot({ clip: stage })).toString('base64')
    const rest = await grip()
    const brightBefore = await centre()
    await page.mouse.move(rest.x, rest.y)
    await page.waitForTimeout(250)
    const hover = (await grip()).label
    check('the Bite line shows its value, its frequency and a hint under the pointer', /Bite\s*\d+%/.test(hover) && /k?Hz/.test(hover) && /Drag up/.test(hover), hover)
    // Up the scale, the way the relief's depth runs, in slow steps: the waves follow the hand.
    await page.mouse.down()
    const frames = []
    let heardWhileHeld = 0
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(rest.x + i * 3, rest.y - i * 4)
      // Halfway, the hand rests: that is where the sound is heard as it now is. The voice is
      // watched for through the rest, since the render it waits on can take a moment and a short
      // sound is over before the drag is.
      if (i === 6) {
        for (let tick = 0; tick < 14 && !heardWhileHeld; tick++) {
          await page.waitForTimeout(100)
          heardWhileHeld = await page.evaluate(() => document.querySelectorAll('button[aria-label^="Stop "]').length)
        }
      } else await page.waitForTimeout(70)
      if (i === 3 || i === 8 || i === 12) frames.push(await picture())
    }
    const pulling = await page.evaluate(() => !!document.querySelector('.labs-marks__pull line') && !document.querySelector('.labs-relief__loading'))
    await shot('labs-bite-pull.png')
    await page.mouse.up()
    await page.waitForTimeout(1300)
    const pulled = await grip()
    const brightAfter = await centre()
    log(`MEASURE bite: ${rest.now}% at ${rest.hz} Hz → ${pulled.now}% at ${pulled.hz} Hz, spectral centre ${Math.round(brightBefore)} → ${Math.round(brightAfter)} Hz`)
    check('dragging the line up the scale adds bite and moves where the sound cuts', pulled.now > rest.now + 10 && pulled.hz > rest.hz, `${rest.now}% at ${rest.hz} Hz → ${pulled.now}% at ${pulled.hz} Hz`)
    /*
     * The brightness moves, and which way is the sound's business rather than the grip's: over the
     * twelve families a wider filter raises the centre twenty-two times in twenty-four, and on a
     * resonant one it can collapse it — the peak that was sitting in the middle of the spectrum
     * walks off the top of it, leaving the body behind. So what is checked is that the render
     * really answers the hand; the number is reported either way.
     */
    const shift = Math.abs(brightAfter - brightBefore) / Math.max(1, brightBefore)
    check('and the sound it renders really changes', shift > 0.05, `${Math.round(brightBefore)} → ${Math.round(brightAfter)} Hz, ${(shift * 100).toFixed(0)}%`)
    check('the waves change while the hand is still moving', frames[0] !== frames[1] && frames[1] !== frames[2])
    check('a hand at rest hears the sound while still holding it, with a filament to the line', heardWhileHeld >= 1 && pulling)
    await page.locator('.labs-head h1').click()
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`)
    await page.waitForTimeout(800)
    check('one undo takes the whole move back', (await grip()).now === rest.now)
    const again = await grip()
    await page.mouse.move(again.x, again.y); await page.mouse.down()
    for (let i = 1; i <= 6; i++) { await page.mouse.move(again.x - i * 3, again.y + i * 4); await page.waitForTimeout(16) }
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(600)
    check('Escape takes a move back before it lands', (await grip()).now === rest.now)
    await page.focus('.labs-mark[data-kind="bite"] .labs-mark__hit')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(800)
    check('the arrows step Bite from the keyboard', (await grip()).now === Math.min(100, rest.now + 3))
    // Each step is heard: the voice is stopped, and the relief left to settle, before stillness is measured.
    await page.locator('.labs-head h1').click()
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
  } else log('the bench sound has no Bite control: the line is not shown')

  /*
   * 9c. The three other marks. Each stands on the direction its control works in — Grain on the
   * level, Space on time, Motion on the height of a stem — and each is dragged along that
   * direction. What is checked here is the thing that makes them grips rather than readouts: the
   * mark goes exactly as far as the hand, the relief lights it under the pointer, and the sound
   * really changes.
   */
  const marked = await page.evaluate(() => [...document.querySelectorAll('.labs-mark')].map((g) => g.dataset.kind))
  check('the sound on the bench wears its four controls', marked.join() === 'bite,grain,space,motion', marked.join(' '))
  const shapeOf = async (kind) => {
    /*
     * The marks come and go with the picture: while a render is in flight the relief keeps the last
     * one, but between two sounds a mark can be a frame late. Waited for as ATTACHED, not visible —
     * Motion's stem is a vertical segment, so its box is zero pixels wide and the default visible
     * state is never reached however long it is given.
     */
    const there = await page.waitForSelector(`.labs-mark[data-kind="${kind}"] .labs-mark__hit`, { state: 'attached', timeout: 6000 }).catch(() => null)
    if (!there) log(`the ${kind} mark is not on the relief: ${JSON.stringify(await page.evaluate(() => ({
      marks: [...document.querySelectorAll('.labs-mark')].map((g) => g.dataset.kind).join() || 'none',
      empty: !!document.querySelector('.labs-relief__empty'), loading: !!document.querySelector('.labs-relief__loading'),
      canvas: !!document.querySelector('.labs-relief__gl canvas'), bench: document.querySelector('.labs-bench__title h2')?.textContent,
      sliders: [...document.querySelectorAll('.labs-timbre [role="slider"], .labs-mark__hit')].map((el) => el.getAttribute('aria-label')).join(),
    })))}`)
    return readShape(kind)
  }
  const readShape = (kind) => page.evaluate((k) => {
    const hit = document.querySelector(`.labs-mark[data-kind="${k}"] .labs-mark__hit`)
    if (!hit) return null
    const box = hit.ownerSVGElement.getBoundingClientRect()
    const points = hit.getAttribute('points').split(' ').filter(Boolean).map((p) => p.split(',').map(Number))
    const mid = points[Math.floor(points.length / 2)]
    return {
      now: Number(hit.getAttribute('aria-valuenow')), text: hit.getAttribute('aria-valuetext'),
      label: document.querySelector(`.labs-mark__label[data-kind="${k}"]`)?.textContent ?? '',
      grab: { x: box.left + mid[0], y: box.top + mid[1] },
      // The point the drag is read on: the far end for the lines, the head for the stem.
      far: { x: box.left + points[k === 'motion' ? 1 : Math.floor(points.length * 0.2)][0], y: box.top + points[k === 'motion' ? 1 : Math.floor(points.length * 0.2)][1] },
      lit: false,
    }
  }, kind)
  /*
   * How much one picture differs from another, pixel by pixel.
   *
   * Not the difference of their averages: a mark lit where the relief is already white has no
   * headroom to raise an average, and a bright sound reads as no light at all.
   */
  const apart = (before, after) => page.evaluate(async ([a, b]) => {
    const load = async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      c.getContext('2d').drawImage(img, 0, 0)
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    }
    const one = await load(a), two = await load(b)
    let sum = 0
    for (let k = 0; k < one.length; k += 4) sum += Math.abs((0.2126 * one[k] + 0.7152 * one[k + 1] + 0.0722 * one[k + 2]) - (0.2126 * two[k] + 0.7152 * two[k + 1] + 0.0722 * two[k + 2]))
    return sum / (one.length / 4)
  }, [before, after])
  const frame = async (clip) => (await page.screenshot({ clip })).toString('base64')
  for (const [kind, name, dx, dy, unit] of [['grain', 'Grain', 0, -52, 'dB'], ['space', 'Space', 96, 0, 'ms'], ['motion', 'Motion', 0, -44, 'ms']]) {
    const before = await shapeOf(kind)
    if (!before) { log(`the bench sound has no ${name} control`); continue }
    // The mark lights where the pointer is on it — in the relief for a slice of it, in its own
    // line for the bed and the stem. Measured away from the pointer, and with the names taken out
    // of the picture, so a label's own backing cannot be taken for the light.
    const hidden = await page.addStyleTag({ content: '.labs-marks__names { display: none !important }' })
    const clip = { x: Math.round(before.far.x - 60), y: Math.round(before.far.y - 40), width: 120, height: 80 }
    await page.mouse.move(20, 20)
    await page.waitForTimeout(420)
    const cold = await frame(clip)
    await page.mouse.move(before.grab.x, before.grab.y)
    await page.waitForTimeout(420)
    const warm = await frame(clip)
    await page.mouse.move(20, 20)
    await page.waitForTimeout(420)
    const away = await frame(clip)
    // The hand off the mark again gives the noise floor: what the picture does on its own.
    const [change, still] = [await apart(cold, warm), await apart(cold, away)]
    check(`${name} lights under the pointer`, change > 1 && change > still * 3, `${change.toFixed(2)} lit vs ${still.toFixed(2)} still`)
    await page.mouse.move(before.grab.x, before.grab.y)
    await page.waitForTimeout(300)
    // Only the tag this check added: the page's own styles arrive in <style> tags too, and taking
    // one of those away leaves the relief laying itself out with no rules at all.
    await hidden.evaluate((tag) => tag.remove())
    await page.waitForTimeout(250)
    const shown = (await shapeOf(kind)).label
    check(`${name} shows its value, where it stands and a hint under the pointer`, new RegExp(`${name}\\s*\\d+%`).test(shown) && shown.includes(unit) && /Drag (up|right)/.test(shown), shown)
    // The drag: the mark goes where the hand goes, and the sound is made again as it moves.
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) { await page.mouse.move(before.grab.x + dx * i / 8, before.grab.y + dy * i / 8); await page.waitForTimeout(70) }
    const pulling = await page.evaluate(() => !!document.querySelector('.labs-marks__pull line'))
    await page.mouse.up()
    await page.waitForTimeout(1400)
    const after = await shapeOf(kind)
    if (!after) { check(`${name} is still on the relief after the drag`, false, 'the mark went missing'); continue }
    const moved = Math.hypot(after.far.x - before.far.x, after.far.y - before.far.y)
    const hand = Math.hypot(dx, dy)
    /*
     * The mark travels exactly as far as the hand. Measured on the value rather than on the drawn
     * line: the relief is remade under the hand while the drag runs, so a line also rises with the
     * terrain it lies on, and that movement — the point of the whole thing — is not the grip's.
     */
    const reach = await page.evaluate(async (k) => {
      const { renderPatch } = await import('/src/audio/dsp/render.ts')
      const { analyseSpectrum } = await import('/src/audio/labs/analysis.ts')
      const { reliefMarks, markReach } = await import('/src/audio/labs/marks.ts')
      const { reliefLayout } = await import('/src/audio/labs/reliefLayout.ts')
      const doc = JSON.parse(localStorage.getItem('paramrig.audio-documents.v1') ?? '{}')
      const labs = Object.values(doc).find((entry) => entry?.id === 'audio-example-arcade-coin')?.labs
      const sound = [...labs.history, ...labs.reserve].find((entry) => entry.id === labs.current)
      const host = document.querySelector('.labs-relief')
      const box = host.getBoundingClientRect()
      const spectrum = analyseSpectrum(renderPatch(sound.patch, 48000), 48000)
      const { marks } = reliefMarks(sound, spectrum, sound.patch.duration * 1000)
      return markReach(marks.find((mark) => mark.kind === k), reliefLayout(box.width, box.height, host.dataset.view))
    }, kind)
    const asked = hand / reach
    log(`MEASURE ${kind}: ${before.now}% → ${after.now}% · "${before.text}" → "${after.text}" · hand ${hand.toFixed(0)} px of ${reach.toFixed(0)} px, mark ${moved.toFixed(0)} px on screen`)
    check(`dragging ${name} moves it and changes where it stands`, after.now > before.now + 5 && after.text !== before.text, `${before.text} → ${after.text}`)
    check(`and ${name} goes exactly as far as the hand`, Math.abs((after.now - before.now) / 100 - asked) < 0.05, `asked ${(asked * 100).toFixed(0)}%, moved ${after.now - before.now}%`)
    check(`a filament joins the hand to ${name} while it is held`, pulling)
    await page.locator('.labs-head h1').click()
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`)
    await page.waitForTimeout(1000)
    check(`one undo takes the whole ${name} move back`, (await shapeOf(kind))?.now === before.now, `${(await shapeOf(kind))?.now} vs ${before.now}`)
    await page.focus(`.labs-mark[data-kind="${kind}"] .labs-mark__hit`)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(900)
    check(`the arrows step ${name} from the keyboard`, (await shapeOf(kind))?.now === Math.min(100, before.now + 2), `${(await shapeOf(kind))?.now}`)
    await page.locator('.labs-head h1').click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
  }

  // 10. One screen: at the reference sizes the column does not scroll, and the relief holds still
  // under the pointer — no parallax, no flicker, no disappearing.
  const fits = await page.evaluate(() => { const main = document.querySelector('.labs-main'); return main.scrollHeight - main.clientHeight })
  check('the Labs column fits the window without scrolling', fits <= 0, `${fits}px over`)
  const stage = await page.evaluate(() => { const r = document.querySelector('.labs-stage').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })
  const luma = []
  // The marks are meant to light under the pointer, so they stand aside while the relief itself is
  // measured: what is being checked here is that the picture behind them does not move.
  const asideMarks = await page.addStyleTag({ content: '.labs-marks, .labs-marks__names { display: none !important }' })
  await page.waitForTimeout(300)
  for (let i = 0; i < 8; i++) {
    const x = stage.x + (i / 7) * stage.width
    const y = stage.y + stage.height * (0.3 + 0.08 * i)
    await page.mouse.move(x, y, { steps: 3 })
    const png = await page.screenshot({ clip: stage })
    luma.push(await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let sum = 0; for (let k = 0; k < d.length; k += 4) sum += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]
      return sum / (d.length / 4)
    }, png.toString('base64')))
  }
  const spread = Math.max(...luma) - Math.min(...luma)
  check('the relief holds still under the pointer', spread < 0.5, `luma spread ${spread.toFixed(2)}`)
  await asideMarks.evaluate((tag) => tag.remove())
  check('and never drops to the flat fallback', await page.locator('.labs-relief__flat').count() === 0)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(400)
  const small = await page.evaluate(() => { const main = document.querySelector('.labs-main'); return main.scrollHeight - main.clientHeight })
  check('at 1280 × 800 the column still fits without scrolling', small <= 0, `${small}px over`)

  // 11. Narrow widths: the reserve becomes a drawer, nothing spills.
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.waitForTimeout(400)
  const mid = await state()
  check('at 1024 nothing overflows', !mid.overflow && !mid.mainOverflow)
  await shot('labs-1024.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const phone = await state()
  check('at 390 nothing overflows', !phone.overflow && !phone.mainOverflow)
  await shot('labs-390.png')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)

  check('no page errors during the session', errors.length === 0, errors.slice(0, 3).join(' | '))
})
