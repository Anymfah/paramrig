import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { root } from './sdk-entries.mjs'

/** Prefix the actual shared UI styles, including nested CSS. No copied styling implementation. */
export async function buildControlStyles(outDir) {
  const scope = ':where(.paramrig-controls, .paramrig-control-portal)'
  const source = await Promise.all(['tokens.css', 'components.css'].map(file => readFile(resolve(root, 'src/styles', file), 'utf8')))
  const sheet = postcss.parse(source.join('\n'))
  sheet.walkAtRules('font-face', rule => rule.remove())
  const animations = new Map()
  sheet.walkAtRules(/keyframes$/, rule => { const name = rule.params; const next = `paramrig-control-${name}`; animations.set(name, next); rule.params = next })
  sheet.walkDecls(decl => {
    if (decl.prop === '--font-sans' || decl.prop === '--font-mono') decl.value = decl.prop === '--font-sans' ? 'system-ui, sans-serif' : 'ui-monospace, monospace'
    if (/^animation(?:-name)?$/.test(decl.prop)) for (const [name, next] of animations) decl.value = decl.value.replace(new RegExp(`\\b${name}\\b`, 'g'), next)
  })
  sheet.walkRules(rule => {
    let parent = rule.parent
    while (parent) { if (parent.type === 'rule' || parent.type === 'atrule' && /keyframes$/.test(parent.name)) return; parent = parent.parent }
    // Page layout belongs to the host. Keep reset rules only within actual components.
    if (rule.selectors.some(selector => /(^|[\s,])(?:html|body|#root)(?=[\s.:#\[]|$)/.test(selector))) { rule.remove(); return }
    rule.selectors = rule.selectors.flatMap(selector => {
      if (/(^|[\s,])(?:html|body|#root)(?=[\s.:#\[]|$)|:root/.test(selector)) return [selector.replace(/:root|\bhtml\b|\bbody\b|#root/g, scope)]
      return [`${scope} ${selector}`, `${scope}:is(${selector})`]
    })
  })
  sheet.append(`${scope} { font-family: var(--font-sans); font-size: 14px; line-height: var(--leading-snug); color: var(--text-primary); }\n.paramrig-rig-controls { display: grid; gap: var(--space-4); }`)
  const css = sheet.toString()
  if (/@font-face|url\(/.test(css)) throw new Error('Controls CSS includes an implicit font or asset')
  await writeFile(resolve(outDir, 'styles.css'), css)
  await writeFile(resolve(outDir, 'styles.d.ts'), 'export {}\n')
}
