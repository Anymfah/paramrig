/**
 * A millisecond is not a constant on this machine.
 *
 * The same campaign, on the same code, on the same day: the first frame reads 1240 ms on one pass
 * and 1517 on the next, and 2028 with four development stacks up. A budget written as a fixed
 * number of milliseconds therefore stops measuring the code and starts measuring what else the Mac
 * is doing, and a check that flips on a quiet afternoon teaches nobody anything. Three of the
 * literals in this harness had already been quietly enlarged to absorb that — 75 where the budget
 * is 50, 600 where it is 300, 250 where the plan asks 50 — which is the same allowance, made once,
 * in the dark, and never revisited.
 *
 * So every pass measures the machine it runs on, and reads its budgets against that. Two witnesses,
 * because one does not cover both shapes of work:
 *
 *   `frame`  the interval the browser is handing out between animation frames. It is clamped to the
 *            display, so it barely moves under load: 16.7 ms here with two other stacks running.
 *            The right witness for a claim about cadence, and only for that.
 *   `cpu`    a fixed amount of arithmetic in the renderer. It moves the way one-shot work moves,
 *            which is what nearly every budget here actually measures — the milliseconds a Tab, a
 *            box selection or an undo spends computing, not the frame it lands in.
 *
 * Keeping them apart is not tidiness. Between two passes of the bilan the still page went from 16.7
 * to 18 ms a frame, a factor of 1.08, while the first frame rose by 1.22 and Tab on a hundred
 * thousand vertices by 1.54. A cadence witness cannot account for a number that moves three times
 * further than it does, and attaching it to one would be a calibration that calibrates nothing.
 *
 * Two rules keep this honest rather than convenient. A witness may only loosen a budget, never
 * tighten one: a machine reading faster than nominal does not get to invent failures nobody can
 * reproduce. And past three times nominal the run is no longer measuring the code at all, so the
 * scaling stops there and the check fails, loudly, with the ratio in its own message.
 *
 * Every check still prints its real figure. The scaling decides pass or fail; the number in the
 * message is the one to read.
 */

/*
 * Nominal readings: this Mac (Apple silicon, headless GPU Chrome for Testing), 5 September 2026,
 * measured on about:blank with the helios and stellary-ci stacks up but nothing else running —
 * a quiet machine, deliberately, because the nominal is the floor a budget is written against and
 * anything above it is the allowance.
 *
 * The arithmetic read 9.4 to 10.1 ms over six samples there, and 18.4 ms taken minutes after a
 * campaign had finished. That factor of two, on the same probe on the same machine, is the whole
 * reason this file exists — and note that the frame witness sat at 16.7 ms through both.
 *
 * They go stale with a Chrome or a macOS upgrade. Re-read them from a WITNESS line on an otherwise
 * quiet machine, and say here when, and on what.
 */
export const NOMINAL_FRAME = 16.7
export const NOMINAL_CPU = 9.5

/** The most a witness may loosen a budget before the run is judged to be measuring the machine. */
const CAP = 3

/*
 * Probe sizes. Fifteen million iterations read 18.4 ms with a five per cent spread over seven runs;
 * ten million read 15.7 with seventy per cent, because at that length a single animation frame
 * landing inside the loop moves the whole sample. Thirty-six frames is about six tenths of a
 * second, and the first six are dropped: the first interval after a page settles is not a frame the
 * browser was ever going to hand out twice.
 */
const CPU_ITERATIONS = 15_000_000
const CPU_RUNS = 5
const FRAME_SAMPLES = 36
const FRAME_WARMUP = 6

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Reads both witnesses on the page as it stands.
 *
 * Call it on about:blank, before the script under test has loaded anything: a witness measured on
 * the application would move with the application, which is the one thing it must never do.
 */
export async function readWitness(page) {
  const frame = await page.evaluate(async ({ samples, warmup }) => {
    const intervals = []
    let last = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now()
        intervals.push(now - last)
        last = now
        if (intervals.length < samples) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const sorted = intervals.slice(warmup).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }, { samples: FRAME_SAMPLES, warmup: FRAME_WARMUP })

  const runs = await page.evaluate(({ iterations, times }) => {
    // The accumulator is returned so that neither the engine nor a profiler can decide the loop has
    // no effect and skip it, which would leave the witness reading nought on a fast machine.
    const probe = () => {
      const started = performance.now()
      let acc = 0
      for (let i = 0; i < iterations; i += 1) acc += Math.sqrt(i % 1024) * 1.000001
      return { ms: performance.now() - started, acc }
    }
    probe()
    return Array.from({ length: times }, () => probe().ms)
  }, { iterations: CPU_ITERATIONS, times: CPU_RUNS })

  return witnessFrom(frame, median(runs))
}

/** The witness object, and its two scalers. Separated so a test can build one without a browser. */
export function witnessFrom(frame, cpu) {
  const ratio = (reading, nominal) => Math.min(CAP, Math.max(1, reading / nominal))
  const frameRatio = ratio(frame, NOMINAL_FRAME)
  const cpuRatio = ratio(cpu, NOMINAL_CPU)
  return {
    frame,
    cpu,
    frameRatio,
    cpuRatio,
    /** For a stopwatch around one piece of work: a Tab, a selection, an undo, a compile. */
    ms: (budget) => budget * cpuRatio,
    /** For a claim about the interval between frames, and nothing else. */
    frames: (budget) => budget * frameRatio,
    /** What to print once per script, so a surprising figure can be read against the machine. */
    line: () => `WITNESS ${frame.toFixed(1)} ms a frame (x${frameRatio.toFixed(2)}),`
      + ` ${cpu.toFixed(1)} ms of arithmetic (x${cpuRatio.toFixed(2)})`,
    /** The tail of a check's message, so the reader sees the allowance that was actually given. */
    against: (budget) => `${budget} ms x ${cpuRatio.toFixed(2)}`,
  }
}
