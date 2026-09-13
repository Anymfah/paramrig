import { dropSceneViewport, keptViewportKeys } from '@/scene/viewport/keep'
import { renderDocumentThumbnail, disposeMaterialPreviews } from '@/scene/viewport/preview'
import { sceneThumbnail } from '@/scene/io/thumbnail'
import { sceneRigDefaults, resolveSceneValues } from '@/scene/rig'
import type { DomainModule } from './types'
import { storageMessage } from '@/editor/storage'
import { getSceneDocument, createSceneDocument, sceneManifest, saveSceneDocument } from '@/scene/document'
import { importProject } from '@/scene/project'
import { SceneEditorPage } from '@/scene/SceneEditorPage'
import { SceneRigPreview } from '@/renderers/scene/SceneRigPreview'
import { TidalPlanetPreview } from '@/renderers/three/TidalPlanetPreview'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { SceneRigsPage } from '@/docs/SceneRigsPage'
import { modeOf, readScenePrefs, withMode, writeScenePrefs } from '@/scene/prefs'
import { createControlRegistry } from '@/controls/registry'
import { Gizmo3DController } from '@/ui/VisualControllers'
import { Gizmo3DScene } from '@/renderers/three/Gizmo3DScene'
import type { Gizmo3DValue } from '@paramrig/core/extended-types'
import '@/styles/editor.css'
import '@/styles/scene.css'

const controls = createControlRegistry()
controls.register('gizmo3d', ({ value, onChange, onGestureStart, onGestureEnd, onGestureCancel }) => <Gizmo3DController value={value as Gizmo3DValue} onChange={onChange} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} onGestureCancel={onGestureCancel} Preview={Gizmo3DScene}/>)
const module: DomainModule = {
  id: 'scene', controls,
  dispose() { for (const key of keptViewportKeys()) dropSceneViewport(key); disposeMaterialPreviews() },
  getRig(id) { if (id === 'tidal-planet') return tidalPlanetManifest; const document = getSceneDocument(id); return document ? sceneManifest(document) : undefined },
  create: createSceneDocument,
  thumbnail(id) { const stored = getSceneDocument(id); if (!stored) return null; const document = stored.rig ? resolveSceneValues(stored, sceneRigDefaults(stored.rig)) : stored; return { stamp: stored.updatedAt, url: renderDocumentThumbnail(document) ?? sceneThumbnail(document) } },
  async openFile(text) {
    const result = importProject(text)
    if (!result.ok) return result
    const saved = saveSceneDocument(result.project.document)
    if (!saved.ok) return { ok: false, error: storageMessage(saved)! }
    const { id, name } = result.project.document
    return { ok: true, id, name, note: result.note }
  },
  Editor: ({ manifest, ...props }) => <SceneEditorPage documentId={manifest.id} {...props}/>,
  Preview: ({ rigId, renderer, session, values, name }) => renderer === 'three' && session
    ? <TidalPlanetPreview session={session} values={values}/>
    : <SceneRigPreview documentId={rigId} session={session ?? null} values={values} name={name}/>,
  Documentation: SceneRigsPage,
  readMode: id => modeOf(readScenePrefs(), id),
  writeMode: (id, mode) => writeScenePrefs(withMode(readScenePrefs(), id, mode)),
}
export default module
