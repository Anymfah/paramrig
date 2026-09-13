/** Build-only previews. Consumers of the catalogue download images, never these engines. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BUNDLED_DOCUMENTS } from '@/rigs/examples/aperture-mark'
import { BUNDLED_SCENES } from '@/rigs/examples/paper-lantern'
import { BUNDLED_PATCHES } from '@/rigs/examples/arcade-coin'
import { serializeVectorDocument } from '@/vector/serialization'
import { resolveRigValues, rigDefaults } from '@/vector/rig'
import { sceneThumbnail } from '@/scene/io/thumbnail'
import { resolveSceneValues, sceneRigDefaults } from '@/scene/rig'
import { audioThumbnail } from '@/audio/thumbnail'
import { resolveAudioValues, audioRigDefaults } from '@/audio/rig'
import { ContourBloomMark } from '@/renderers/svg/ContourBloomPreview'
import { ControllerMark } from '@/renderers/html/ControllerLabPreview'
import { SurfaceMark } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeMark } from '@/renderers/html/TypeSpecimenPreview'
import { PlanetMark } from '@/renderers/three/PlanetMark'
const decode = (url: string) => decodeURIComponent(url.slice(url.indexOf(',') + 1))
export function thumbnails() {
  const result: Record<string, string> = {}
  for (const doc of BUNDLED_DOCUMENTS) result[doc.id] = serializeVectorDocument(doc.rig ? resolveRigValues(doc, rigDefaults(doc.rig)) : doc)
  for (const make of BUNDLED_SCENES) { const doc = make(); result[doc.id] = decode(sceneThumbnail(doc.rig ? resolveSceneValues(doc, sceneRigDefaults(doc.rig)) : doc)) }
  for (const make of BUNDLED_PATCHES) { const doc = make(); result[doc.id] = decode(audioThumbnail(doc.rig ? resolveAudioValues(doc, audioRigDefaults(doc.rig)) : doc.patch)) }
  for (const [id, Mark] of Object.entries({ 'contour-bloom': ContourBloomMark, 'tidal-planet': PlanetMark, 'controller-lab': ControllerMark, 'surface-studies': SurfaceMark, 'type-specimen': TypeMark })) {
    result[id] = renderToStaticMarkup(createElement(Mark)).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  }
  return result
}
