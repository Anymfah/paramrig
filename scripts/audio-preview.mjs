/**
 * Renders every preset to a .wav so they can be listened to before any interface exists.
 *
 * This is the whole point of keeping the DSP kernel free of Web Audio: the synthesiser runs here,
 * in Node, with no browser and no sound card, and the files it writes are byte-identical to what
 * the workbench will play. If a sound is wrong, it is wrong before a single control is drawn.
 *
 *   node --experimental-strip-types scripts/audio-preview.mjs [outputDir]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PRESETS } from '../src/audio/presets.ts'
import { renderPatch } from '../src/audio/dsp/render.ts'
import { stereoLevels } from '../src/audio/waveform.ts'
import { encodeWav } from '../src/audio/dsp/wav.ts'

const SAMPLE_RATE = 44100

const dB = (value) => (value <= 0 ? '-inf' : `${(20 * Math.log10(value)).toFixed(1)} dB`)

async function main() {
  const out = path.resolve(process.argv[2] ?? 'output/audio')
  await fs.mkdir(out, { recursive: true })

  const rows = []
  for (const preset of PRESETS) {
    const patch = preset.build()
    const stereo = renderPatch(patch, SAMPLE_RATE)
    const file = path.join(out, `${preset.id}.wav`)
    await fs.writeFile(file, encodeWav(stereo, SAMPLE_RATE))
    const { peak, rms } = stereoLevels(stereo)
    // Counted in place. Spreading two Float32Arrays into one boxed JS array built and threw away
    // a third of a million elements per preset to count a handful of them.
    let clipped = 0
    for (const channel of [stereo.left, stereo.right]) {
      for (let i = 0; i < channel.length; i += 1) if (Math.abs(channel[i]) >= 0.999) clipped += 1
    }
    rows.push({ id: preset.id, seconds: patch.duration, peak, rms, clipped, file })
  }

  const width = Math.max(...rows.map((r) => r.id.length))
  console.log(`\n${rows.length} presets → ${out}\n`)
  console.log(`${'preset'.padEnd(width)}   dur     peak        rms         clipped`)
  for (const r of rows) {
    console.log(
      `${r.id.padEnd(width)}   ${r.seconds.toFixed(2)}s   ${dB(r.peak).padEnd(10)}  ${dB(r.rms).padEnd(10)}  ${r.clipped}`,
    )
  }
  console.log('')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
