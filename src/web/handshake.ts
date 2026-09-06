/**
 * The host's side of the pairing: how often it says hello until the preview answers.
 *
 * An SDK that announces itself is answered on the spot and never sees this queue. It exists for the
 * first message of a page that has not announced anything yet — an integration built before the
 * announcement, or a frame that finished loading before its script ran — where a single two second
 * guess used to be the whole of the wait a person sat through.
 */
export const HELLO_STEPS = [100, 200, 400, 800]
export const HELLO_HEARTBEAT = 2000

/** The delay before the next hello: short steps while unanswered, the heartbeat once paired. */
export function helloDelay(step: number, answered: boolean): number {
  return answered ? HELLO_HEARTBEAT : HELLO_STEPS[step] ?? HELLO_HEARTBEAT
}

/**
 * Says hello now, then keeps saying it. `answered` is read at each step rather than captured, so
 * the queue settles onto the heartbeat as soon as the preview has replied once. Returns the stop.
 */
export function helloQueue(send: () => void, answered: () => boolean): () => void {
  let step = 0
  let timer = 0
  const tick = () => {
    send()
    timer = window.setTimeout(tick, helloDelay(step++, answered()))
  }
  tick()
  return () => window.clearTimeout(timer)
}
