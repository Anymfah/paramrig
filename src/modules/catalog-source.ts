/** Build-tool input only. The application imports catalog.generated.json instead. */
import { controllerManifest } from '@/rigs/controller-catalog'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { surfaceStudiesManifest } from '@/rigs/examples/surface-studies'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { typeSpecimenManifest } from '@/rigs/examples/type-specimen'
import { BUNDLED_DOCUMENTS } from '@/rigs/examples/aperture-mark'
import { BUNDLED_SCENES } from '@/rigs/examples/paper-lantern'
import { BUNDLED_PATCHES } from '@/rigs/examples/arcade-coin'
import { projectMetadata } from '@/library/projectIndex'
import { moduleForRenderer, type ModuleId, type ProjectMetadata } from './types'

export function listRigs(): ProjectMetadata[] {
  const documents: Array<readonly [ModuleId, { id: string; name: string; rig?: { parameters: unknown[] }; updatedAt: string }]> = [
    ...BUNDLED_DOCUMENTS.map(document => ['vector', document] as const),
    ...BUNDLED_SCENES.map(make => ['scene', make()] as const),
    ...BUNDLED_PATCHES.map(make => ['audio', make()] as const),
  ]
  const bundled = documents.map(([module, document]): ProjectMetadata => ({
    ...projectMetadata(module, document.id, document), collection: 'examples', title: `Examples/${{ audio: 'Audio', scene: 'Scene', vector: 'Vector', web: 'Web' }[module]}`,
    rendererLabel: { audio: 'Audio', scene: 'Scene', vector: 'Vector', web: 'Web' }[module], description: '',
    summary: `${module === 'scene' ? 'Scene' : module === 'audio' ? 'Audio' : 'Vector'} · ${document.rig?.parameters.length ?? 0} controls`,
    sourceFile: `src/rigs/examples/${document.id.replace(/^(?:(?:audio|vector)-)?example-/, '')}.ts`, tags: [module, 'example', 'rig'],
  }))
  const examples = [contourBloomManifest, tidalPlanetManifest, surfaceStudiesManifest, typeSpecimenManifest, controllerManifest]
    .map(({ id, name, summary, description, renderer, rendererLabel, collection, title, sourceFile, tags }) => ({
      id, name, summary, description, renderer, rendererLabel, collection, title, sourceFile, tags, module: moduleForRenderer(renderer),
    }))
  return [...bundled, ...examples]
}
