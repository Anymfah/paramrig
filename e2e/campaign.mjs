import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The whole browser campaign, run from macOS rather than from inside the container.
 *
 * The QA browser is a headless GPU Chrome that is kept running between sessions, and it stops
 * compositing after a while: `document.hidden` is false, no error is printed, and every page in it
 * — including a brand new one — draws nought frames. Every Playwright actionability check then
 * waits for ever on an element that is perfectly still, so a campaign that starts fine ends with
 * twenty scripts reporting the same false symptom. The flags that were meant to prevent it
 * (`--disable-backgrounding-occluded-windows` and its neighbours) delay it rather than stop it.
 *
 * The cure is a browser that has just started, so this runs one script at a time and restarts the
 * browser whenever the harness reports the stall. It has to live on the host because the browser
 * does: from inside the container there is nothing to restart.
 *
 *   node e2e/campaign.mjs scene-        # every script whose name starts with that
 *   node e2e/campaign.mjs               # all of them
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const PORT = 9223
const PROFILE = join(process.env.HOME ?? '', '.claude/chrome-perf-profile')
/** Playwright keeps its browsers by version; the newest one on this machine is the one to run. */
const BROWSERS = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright')
const STALLED = 'has stopped drawing'

function chromePath() {
  const versions = readdirSync(BROWSERS)
    .filter((name) => name.startsWith('chromium-'))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  for (const version of versions) {
    const app = join(BROWSERS, version, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(app)) return app
  }
  throw new Error('No Chrome for Testing found under ~/Library/Caches/ms-playwright.')
}

function stopBrowser() {
  try {
    execFileSync('pkill', ['-f', `remote-debugging-port=${PORT}`], { stdio: 'ignore' })
  } catch {
    /* Nothing was running, which is the state we wanted anyway. */
  }
}

async function startBrowser() {
  const child = spawn(chromePath(), [
    '--headless=new',
    '--use-angle=metal',
    '--enable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  // Ready when the endpoint answers, not after a fixed wait: a slow start is common on a busy Mac.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) return
    } catch {
      /* Not up yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The QA browser did not come up on port 9223.')
}

function runScript(name) {
  const args = ['compose', 'run', '--rm', 'app', 'npm', 'run', 'e2e', '--', name]
  const result = spawn('docker', args, { cwd: ROOT })
  let output = ''
  result.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk) })
  result.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk) })
  return new Promise((resolve) => {
    result.on('close', (code) => resolve({ code, output }))
  })
}

const filter = process.argv[2] ?? ''
const scripts = readdirSync(HERE)
  .filter((name) => name.endsWith('.e2e.mjs') && name.startsWith(filter))
  .sort()

if (scripts.length === 0) {
  console.error(`No script matches “${filter}”.`)
  process.exit(1)
}

let failed = 0
for (const script of scripts) {
  stopBrowser()
  await startBrowser()
  let { code, output } = await runScript(script)
  if (output.includes(STALLED)) {
    // One retry on a browser that has just started: the stall is about the browser, not the script.
    console.log(`— ${script}: the browser had stalled; restarting it and running the script again`)
    stopBrowser()
    await startBrowser()
    ;({ code, output } = await runScript(script))
  }
  if (code !== 0) failed += 1
}

console.log(failed === 0 ? `\nAll ${scripts.length} scripts passed.` : `\n${failed} of ${scripts.length} scripts failed.`)
process.exit(failed === 0 ? 0 : 1)
