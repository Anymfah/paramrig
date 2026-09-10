/**
 * How long the synthesiser takes, per preset and in total.
 *
 * The renderer is a pure function with no clock, so its cost is a number that can be watched
 * rather than guessed at. Every change to the engine is supposed to leave this alone; the ones
 * that are meant to make it faster have to show it. Run it before and after, and paste both.
 *
 *   node --experimental-strip-types scripts/audio-bench.mjs [rounds]
 */
import { PRESETS } from '../src/audio/presets.ts'
import { renderPatch } from '../src/audio/dsp/render.ts'

const SAMPLE_RATE = 44100
const rounds = Math.max(1, Number(process.argv[2] ?? 3))

/** One pass over the whole library, timed per preset. */
function pass() {
  const rows = []
  for (const preset of PRESETS) {
    const patch = preset.build()
    const started = performance.now()
    const out = renderPatch(patch, SAMPLE_RATE)
    const took = performance.now() - started
    rows.push({ id: preset.id, ms: took, seconds: out.left.length / SAMPLE_RATE })
  }
  return rows
}

// One pass thrown away: the first render pays for the compiler warming up on this code.
pass()

const best = new Map()
let total = 0
for (let round = 0; round < rounds; round += 1) {
  for (const row of pass()) {
    const kept = best.get(row.id)
    if (!kept || row.ms < kept.ms) best.set(row.id, row)
  }
}
for (const row of best.values()) total += row.ms

const rows = [...best.values()].sort((a, b) => b.ms - a.ms)
const audio = rows.reduce((sum, row) => sum + row.seconds, 0)
console.log(`${rows.length} presets, ${audio.toFixed(1)} s of audio, best of ${rounds}\n`)
console.log('slowest ten')
for (const row of rows.slice(0, 10)) {
  console.log(`  ${row.ms.toFixed(1).padStart(7)} ms  ${(row.ms / row.seconds).toFixed(1).padStart(6)}× faster than real time is 1000/this  ${row.id}`)
}
console.log(`\ntotal ${total.toFixed(0)} ms  ·  ${(total / rows.length).toFixed(1)} ms per preset  ·  ${(audio * 1000 / total).toFixed(0)}× real time`)
