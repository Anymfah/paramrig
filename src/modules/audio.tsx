import { audioThumbnail } from '@/audio/thumbnail'
import { audioRigDefaults, resolveAudioValues } from '@/audio/rig'
import type { DomainModule } from './types'
import { audioManifest, createAudioDocument, getAudioDocument } from '@/audio/document'
import { importAudioProject, openAudioProject } from '@/audio/project'
import { AudioEditorPage } from '@/audio/AudioEditorPage'
import { AudioRigPreview } from '@/renderers/audio/AudioRigPreview'
import { AudioRigsPage } from '@/docs/AudioRigsPage'
import { modeOf, readAudioPrefs, withMode, writeAudioPrefs } from '@/audio/prefs'
import { disposeLive } from '@/audio/live'
import { disposePlayback } from '@/audio/playback'
import '@/styles/editor.css'
import '@/styles/audio.css'

const module: DomainModule = {
  id: 'audio',
  getRig(id) { const document = getAudioDocument(id); return document ? audioManifest(document) : undefined },
  create: createAudioDocument,
  thumbnail(id) { const document = getAudioDocument(id); return document ? { stamp: document.updatedAt, url: audioThumbnail(document.rig ? resolveAudioValues(document, audioRigDefaults(document.rig)) : document.patch) } : null },
  async openFile(text) {
    const result = importAudioProject(text)
    if (!result.ok) return result
    const { id, name } = await openAudioProject(result.project)
    return { ok: true, id, name, note: result.note }
  },
  Editor: ({ manifest, ...props }) => <AudioEditorPage documentId={manifest.id} {...props}/>,
  Preview: ({ rigId, session, values, name }) => <AudioRigPreview documentId={rigId} values={session?.previewValues() ?? values} name={name}/>,
  Documentation: AudioRigsPage,
  readMode: id => modeOf(readAudioPrefs(), id),
  writeMode: (id, mode) => writeAudioPrefs(withMode(readAudioPrefs(), id, mode)),
  dispose() { disposeLive(); disposePlayback() },
}
export default module
