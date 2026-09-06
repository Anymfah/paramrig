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

/** How long an announced SDK has to accept us before its silence means it has refused. */
export const REFUSAL_GRACE = 2000

/**
 * What the workspace says when the preview has not answered, and why.
 *
 * The status line stays short — the toolbar carries the same string, and at 390 px it is the only
 * place the state is legible — so the reasons come back beside it rather than inside it.
 *
 * An announcement heard changes the answer entirely: the page is reachable, the SDK is loaded and
 * the frame is allowed, because none of that produces an announcement. All that is left is an
 * integration that does not accept this workbench's address, which is one cause rather than three.
 */
export function unanswered(announced: boolean, hostOrigin: string, projectOrigin: string): { status: string; causes: string[] } {
  if (announced) return {
    status: `The page's SDK is present but did not accept this workbench origin (${hostOrigin})`,
    causes: [`Add ${hostOrigin} to the hostOrigin option of connectWeb, or leave that option out to accept both of the workbench's own addresses.`],
  }
  return {
    status: 'Preview unavailable',
    causes: [
      `The project's development server is not answering at ${projectOrigin}.`,
      `The page does not load the ParamRig SDK, or its integration does not accept this workbench origin (${hostOrigin}).`,
      'Framing is refused by the page: check its Content-Security-Policy frame-ancestors and X-Frame-Options.',
    ],
  }
}
