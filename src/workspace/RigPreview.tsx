import { lazy, Suspense, type ComponentType } from 'react'
import type { ParamValue, RendererKind } from '@/rigs/types'
import type { RigSession } from '@/state/session'
import { usePlayhead } from '@/state/workspace'
import { ContourBloomPreview } from '@/renderers/svg/ContourBloomPreview'
import { SurfaceStudiesPreview } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeSpecimenPreview } from '@/renderers/html/TypeSpecimenPreview'
import { ControllerLabPreview } from '@/renderers/html/ControllerLabPreview'
import { VectorRigPreview } from '@/renderers/vector/VectorRigPreview'
import { RendererErrorBoundary } from '@/workspace/RendererErrorBoundary'
import { StatusMessage } from '@/ui/StatusMessage'

const TidalPlanetPreview = lazy(() =>
  import('@/renderers/three/TidalPlanetPreview').then((mod) => ({ default: mod.TidalPlanetPreview })),
)

/**
 * The scene preview carries the whole 3D editor's viewport with it, so it is loaded only when a
 * scene is actually being tuned — the same reason the three.js example is lazy.
 */
const SceneRigPreview = lazy(() =>
  import('@/renderers/scene/SceneRigPreview').then((mod) => ({ default: mod.SceneRigPreview })),
)

/** The audio preview carries the synthesiser, which nothing else on the page needs. */
const AudioRigPreview = lazy(() =>
  import('@/renderers/audio/AudioRigPreview').then((mod) => ({ default: mod.AudioRigPreview })),
)

type PreviewProps = { values: Record<string, ParamValue> }

type ScenePreviewProps = { session: RigSession; values: Record<string, ParamValue> }

/**
 * The three.js example rigs, by id. A renderer is not a component: two rigs can both be three.js
 * and draw nothing alike, so the table says which one, rather than the renderer name deciding.
 */
const THREE_PREVIEWS: Record<string, ComponentType<ScenePreviewProps>> = {
  'tidal-planet': TidalPlanetPreview,
}

const PREVIEWS: Record<string, ComponentType<PreviewProps>> = {
  'contour-bloom': ContourBloomPreview,
  'long-name-study': ContourBloomPreview,
  'surface-studies': SurfaceStudiesPreview,
  'type-specimen': TypeSpecimenPreview,
  'controller-lab': ControllerLabPreview,
}

type RigPreviewProps = {
  rigId: string
  renderer: RendererKind
  values: Record<string, ParamValue>
  name: string
  session?: RigSession
}

export function RigPreview({ rigId, renderer, values, name, session }: RigPreviewProps) {
  const Preview = PREVIEWS[rigId]
  const ThreePreview = THREE_PREVIEWS[rigId]
  return (
    <RendererErrorBoundary
      fallback={
        <div className="preview-error">
          <StatusMessage tone="error">
            This renderer failed. Your other rigs and saved values are still available.
          </StatusMessage>
        </div>
      }
    >
      {renderer === 'audio' ? (
        <Suspense fallback={<p className="status-msg">Starting the synthesiser</p>}>
          <AudioRigPreview documentId={rigId} values={session?.previewValues() ?? values} name={name} />
        </Suspense>
      ) : renderer === 'vector' ? (
        <VectorRigPreview documentId={rigId} values={session?.previewValues() ?? values} name={name} />
      ) : renderer === 'scene' ? (
        <Suspense fallback={<p className="status-msg">Starting the 3D view</p>}>
          <SceneRigPreview documentId={rigId} session={session ?? null} values={values} name={name} />
        </Suspense>
      ) : renderer === 'three' && session && ThreePreview ? (
        <Suspense fallback={<p className="status-msg">Starting the 3D view</p>}>
          <ThreePreview session={session} values={values} />
        </Suspense>
      ) : Preview ? (
        <LivePreview Preview={Preview} values={values} session={session} />
      ) : (
        <StatusMessage>No preview adapter is registered for this rig.</StatusMessage>
      )}
      <span className="visually-hidden">{name} preview</span>
    </RendererErrorBoundary>
  )
}

function LivePreview({ Preview, values, session }: {
  Preview: ComponentType<PreviewProps>
  values: Record<string, ParamValue>
  session?: RigSession
}) {
  usePlayhead(session ?? null)
  return <Preview values={session?.previewValues() ?? values} />
}
