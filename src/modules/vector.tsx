import { BrandExport } from '@/vector/BrandExportAction'
import { disposeAppFonts } from '@/vector/fontLoader'
import { serializeVectorDocument } from '@/vector/serialization'
import { rigDefaults } from '@/vector/rig'
import type { DomainModule } from './types'
import { storageMessage } from '@/editor/storage'
import { getVectorDocument, createVectorDocument, vectorManifest, saveVectorDocument } from '@/vector/document'
import { importProject } from '@/vector/project'
import { VectorEditorPage } from '@/vector/VectorEditorPage'
import { VectorRigPreview } from '@/renderers/vector/VectorRigPreview'
import { ContourBloomPreview } from '@/renderers/svg/ContourBloomPreview'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { VectorRigsPage } from '@/docs/VectorRigsPage'
import { modeOf, readInspectorPrefs, withMode, writeInspectorPrefs } from '@/vector/inspectorPrefs'
import { createControlRegistry } from '@/controls/registry'
import { FontLibraryController } from '@/vector/FontLibraryController'
import { resolveRigValues } from '@/vector/rig'
import '@/styles/editor.css'
import '@/styles/vector.css'

const controls = createControlRegistry()
controls.register('select:font-library', ({ param, ...props }) => <FontLibraryController label={param.label} {...props}/>)
const module: DomainModule = {
  id: 'vector', controls, dispose: disposeAppFonts,
  getRig(id) {
    if (id === 'contour-bloom') return contourBloomManifest
    if (id === 'long-name-study') return { ...contourBloomManifest, id, name: 'Bartholomew Featherstonehaugh contour reconstruction', title: 'Examples/SVG', sourceFile: 'examples/projects/bartholomew-featherstonehaugh/contour-reconstruction.rig.tsx' }
    const document = getVectorDocument(id); return document ? vectorManifest(document) : undefined
  },
  create: createVectorDocument,
  thumbnail(id) { const document = getVectorDocument(id); return document ? { stamp: document.updatedAt, url: `data:image/svg+xml,${encodeURIComponent(serializeVectorDocument(document.rig ? resolveRigValues(document, rigDefaults(document.rig)) : document))}` } : null },
  async openFile(text) {
    const result = importProject(text)
    if (!result.ok) return result
    const saved = saveVectorDocument(result.project.document)
    if (!saved.ok) return { ok: false, error: storageMessage(saved)! }
    const { id, name } = result.project.document
    return { ok: true, id, name, note: result.note }
  },
  Editor: VectorEditorPage,
  Preview: ({ rigId, renderer, values, session, name }) => renderer === 'svg'
    ? <ContourBloomPreview values={session?.previewValues() ?? values}/>
    : <VectorRigPreview key={rigId} documentId={rigId} values={session?.previewValues() ?? values} name={name}/>,
  Documentation: VectorRigsPage, ExportExtras: BrandExport,
  readMode: id => modeOf(readInspectorPrefs(), id),
  writeMode: (id, mode) => writeInspectorPrefs(withMode(readInspectorPrefs(), id, mode)),
}
export default module
