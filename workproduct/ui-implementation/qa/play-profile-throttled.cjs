async (page) => {
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    connectionType: 'cellular4g',
  })

  await page.goto('http://localhost:5173/r/tidal-planet', { waitUntil: 'networkidle' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Play' }).waitFor()
  await page.waitForTimeout(400)

  const start = await page.evaluate(() => {
    const input = document.querySelector('[aria-label="Playhead"]')
    return input instanceof HTMLInputElement ? Number(input.value) : null
  })

  const frames = []
  await page.evaluate(() => {
    window.__prFrames = []
    const stamp = (t) => {
      window.__prFrames.push(t)
      if (window.__prPlaying) requestAnimationFrame(stamp)
    }
    window.__prPlaying = true
    requestAnimationFrame(stamp)
  })

  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(800)

  const end = await page.evaluate(() => {
    window.__prPlaying = false
    const input = document.querySelector('[aria-label="Playhead"]')
    const label = document.querySelector('.timeline__time')?.textContent
    const deltas = []
    const times = window.__prFrames || []
    for (let i = 1; i < times.length; i += 1) deltas.push(times[i] - times[i - 1])
    deltas.sort((a, b) => a - b)
    const pct = (p) => deltas[Math.min(deltas.length - 1, Math.floor((p / 100) * deltas.length))]
    return {
      playhead: input instanceof HTMLInputElement ? Number(input.value) : null,
      label,
      frames: times.length,
      median: deltas.length ? pct(50) : null,
      p95: deltas.length ? pct(95) : null,
      max: deltas.length ? deltas[deltas.length - 1] : null,
    }
  })

  const pause = await page.getByRole('button', { name: 'Pause' }).count()
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  return { start, end, paused: pause > 0, viewport: '1440x900', cpu: '4x', network: 'Slow 4G' }
}
