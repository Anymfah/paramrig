import type { DomainModule } from './types'
import { listWebProjects, pendingWebManifest, webManifest } from '@/web/projects'
import { WebWorkspace } from '@/web/WebWorkspace'
import { WebConnectPage } from '@/web/WebConnectPage'
import { SurfaceStudiesPreview } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeSpecimenPreview } from '@/renderers/html/TypeSpecimenPreview'
import { ControllerLabPreview } from '@/renderers/html/ControllerLabPreview'
import { controllerManifest } from '@/rigs/controller-catalog'
import { surfaceStudiesManifest } from '@/rigs/examples/surface-studies'
import { typeSpecimenManifest } from '@/rigs/examples/type-specimen'
import '@/styles/editor.css'
const examples = [controllerManifest, surfaceStudiesManifest, typeSpecimenManifest]
const module: DomainModule = {
  id: 'web',
  getRig: id => listWebProjects().map(webManifest).find(item => item.id === id) ?? examples.find(item => item.id === id) ?? pendingWebManifest(id),
  Editor: ({ manifest }) => <WebWorkspace rigId={manifest.id}/>,
  Landing: WebConnectPage,
  Preview: ({ rigId, values, session }) => {
    const Preview = rigId === 'surface-studies' ? SurfaceStudiesPreview : rigId === 'type-specimen' ? TypeSpecimenPreview : ControllerLabPreview
    return <Preview values={session?.previewValues() ?? values}/>
  },
}
export default module
