import { loadModule } from './registry'
import type { ModuleId, OpenResult } from './types'
/** Read only the format discriminator before loading exactly one domain validator. */
export async function openFileText(text: string): Promise<OpenResult> {
  try {
    const value: unknown = JSON.parse(text)
    const format = value && typeof value === 'object' && 'format' in value ? value.format : undefined
    const id: ModuleId | undefined = format === 'paramrig.audio' ? 'audio' : format === 'paramrig.scene' ? 'scene' : format === 'paramrig.vector' ? 'vector' : undefined
    if (!id) return { ok: false, error: 'That file is not a supported ParamRig project.' }
    const module = await loadModule(id)
    return module.openFile ? await module.openFile(text) : { ok: false, error: 'This tool does not support project files.' }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'The project could not be opened.' } }
}
