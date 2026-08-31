import { lazy, Suspense, type ComponentType } from 'react'
import type { ParamValue, RendererKind } from '@/rigs/types'
import type { RigSession } from '@/state/session'
import { ContourBloomPreview } from '@/renderers/svg/ContourBloomPreview'
import { SurfaceStudiesPreview } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeSpecimenPreview } from '@/renderers/html/TypeSpecimenPreview'
import { RendererErrorBoundary } from '@/workspace/RendererErrorBoundary'
import { StatusMessage } from '@/ui/StatusMessage'

const TidalPlanetPreview = lazy(() =>
  import('@/renderers/three/TidalPlanetPreview').then((mod) => ({ default: mod.TidalPlanetPreview })),
)

type PreviewProps = { values: Record<string, ParamValue> }

const PREVIEWS: Record<string, ComponentType<PreviewProps>> = {
  'contour-bloom': ContourBloomPreview,
  'long-name-study': ContourBloomPreview,
  'surface-studies': SurfaceStudiesPreview,
  'type-specimen': TypeSpecimenPreview,
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
      {renderer === 'three' && session ? (
        <Suspense fallback={<p className="status-msg">Starting the 3D view</p>}>
          <TidalPlanetPreview session={session} values={values} />
        </Suspense>
      ) : Preview ? (
        <Preview values={values} />
      ) : (
        <StatusMessage>No preview adapter is registered for this rig.</StatusMessage>
      )}
      <span className="visually-hidden">{name} preview</span>
    </RendererErrorBoundary>
  )
}
