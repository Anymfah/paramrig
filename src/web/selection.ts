import type { WebChrome, WebProjectManifest, WebTarget } from './contracts'
import type { ScopedControl } from './WebControls'

/** A target's status in words, and whether it is something the user has to repair. */
export const statusWord = { resolved: '', provisional: 'Not instrumented', missing: 'Missing on this page', ambiguous: 'Several matches' } as const
export const needsReattach = (status: WebTarget['status']) => status === 'missing' || status === 'ambiguous'

/**
 * The overlay is drawn inside the project's page, which has never heard of the workbench palette,
 * so the colours travel with `configure`. Read as hex because the guard on the other side is a hex
 * test: a token that resolves to `rgb(… / …)` is normalised here rather than parsed there. The
 * theme is what makes them change, and it also chooses the colours if the tokens are unreadable.
 */
export function overlayChrome(theme: 'light' | 'dark'): WebChrome {
  const missing = theme === 'dark'
    ? { outline: '#b4d3c8', chip: '#1e2423', chipText: '#eef2f1' }
    : { outline: '#1c1d1e', chip: '#e6e6e6', chipText: '#1c1d1e' }
  const read = (token: string, fallback: string) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    const style = document.createElement('span').style
    style.color = value
    const parts = style.color.match(/[\d.]+/g)
    if (!parts || parts.length < 3) return fallback
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
    const [r, g, b, a] = parts.map(Number) as [number, number, number, number?]
    return `#${hex(r)}${hex(g)}${hex(b)}${a === undefined || a >= 1 ? '' : hex(a * 255)}`
  }
  return { outline: read('--focus-ring', missing.outline), chip: read('--surface-raised', missing.chip), chipText: read('--text-primary', missing.chipText) }
}

/** How many controls a target carries, taking the count the page sent when it has one. */
export function targetControls(manifest: WebProjectManifest, target: WebTarget, pageId?: string): number {
  if (target.controls !== undefined) return target.controls
  if (!target.stable) return 0
  const stable = target.stable
  return new Set(manifest.bindings.filter(b => b.paramId && b.scope === 'element' && (!b.pageId || b.pageId === pageId)
    && b.target?.id === stable.id && (b.target.instance === undefined || b.target.instance === stable.instance)).map(b => b.paramId)).size
}

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
