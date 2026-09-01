import { lazy, Suspense, type ComponentType } from 'react'
import type { ParamValue, RendererKind } from '@/rigs/types'
import type { RigSession } from '@/state/session'
import { usePlayhead } from '@/state/workspace'
import { ContourBloomPreview } from '@/renderers/svg/ContourBloomPreview'
import { SurfaceStudiesPreview } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeSpecimenPreview } from '@/renderers/html/TypeSpecimenPreview'
import { ControllerLabPreview } from '@/renderers/html/ControllerLabPreview'
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
