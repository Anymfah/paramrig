/**
 * What the workspace hands over once a batch is approved.
 *
 * The instruction is here rather than typed twice: `docs/web-workspace.md` quotes the same words,
 * and the confirmation panel shows them in a block a person can select and paste into their agent.
 */
export const AGENT_INSTRUCTION = 'Read the new approved batch in .paramrig/batches, apply its values and requested changes to this project, preserve target IDs, and write a response following .paramrig/README.md.'

export const batchPath = (id: string) => `.paramrig/batches/${id}.json`
