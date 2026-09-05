import type { WebProjectManifest, WebTarget } from './contracts'
import type { ScopedControl } from './WebControls'

/** A selection exposes only its own controls and those of its actual ancestors. */
export function selectionControls(manifest: WebProjectManifest, selected: WebTarget[], pageId?: string): ScopedControl[] {
  return manifest.parameters.filter(param => !param.hidden).flatMap(param => {
    const bindings = manifest.bindings.filter(binding => binding.paramId === param.id && (!binding.pageId || binding.pageId === pageId))
    if (!selected.length) {
      const binding = bindings.find(binding => binding.scope !== 'element')
      return binding ? [{ param, scope: binding.scope === 'page' ? 'Page' : 'Global' }] : []
    }
    const matches = bindings.flatMap(binding => {
      if (binding.scope !== 'element' || !binding.target) return []
      return selected.flatMap(target => [target, ...target.ancestors].flatMap((ancestor, depth) => {
        if (ancestor.stable?.id !== binding.target!.id || (binding.target!.instance !== undefined && ancestor.stable.instance !== binding.target!.instance)) return []
        return [{ depth, label: ancestor.label, repeated: binding.target!.instance === undefined && !!ancestor.stable.instance }]
      }))
    }).sort((a, b) => a.depth - b.depth)
    const match = matches[0]
    if (!match) return []
    return [{ param, scope: match.depth ? `From ${match.label}${match.repeated ? ' · All instances' : ''}` : match.repeated ? 'All instances' : 'Selected element' }]
  }).sort((a, b) => Number(a.scope.startsWith('From ')) - Number(b.scope.startsWith('From ')))
}
