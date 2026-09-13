import { usePlayhead } from '@/state/workspace'
import { useDomain } from '@/modules/context'
import type { ModulePreviewProps } from '@/modules/types'
import { RendererErrorBoundary } from '@/workspace/RendererErrorBoundary'
import { StatusMessage } from '@/ui/StatusMessage'
export function RigPreview(props: ModulePreviewProps) {
  const domain = useDomain()
  usePlayhead(props.session ?? null)
  const Preview = domain?.Preview
  return <RendererErrorBoundary key={props.rigId} fallback={<div className="preview-error"><StatusMessage tone="error">This renderer failed. Your other rigs and saved values are still available.</StatusMessage></div>}>
    {Preview ? <Preview {...props}/> : <StatusMessage>No preview adapter is registered for this rig.</StatusMessage>}
    <span className="visually-hidden">{props.name} preview</span>
  </RendererErrorBoundary>
}
