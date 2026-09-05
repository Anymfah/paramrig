import { expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest, type WebTarget } from './contracts'
import { selectionControls } from './selection'

const manifest = parseManifest(example)
const target: WebTarget = { key: 'title', label: 'Title', tag: 'h1', stable: { id: 'hero-title' }, pageId: 'home', selector: 'h1', fingerprint: 'h1', rect: { x: 0, y: 0, width: 100, height: 30 }, ancestors: [], status: 'resolved' }

it('shows project controls without selection, then only the selected element controls', () => {
  expect(selectionControls(manifest, [], 'home').map(c => c.param.id)).toEqual(['accent', 'paper', 'heading-font', 'content-width'])
  expect(selectionControls(manifest, [target], 'home').map(c => c.param.id)).toEqual(['hero-size', 'hero-copy'])
  expect(selectionControls(manifest, [{ ...target, stable: undefined }], 'home')).toEqual([])
})

it('distinguishes inherited controls and warns when a control affects every repeated instance', () => {
  const icon: WebTarget = { ...target, stable: { id: 'icon', instance: 'forest' }, ancestors: [{ key: 'card', stable: { id: 'story-card', instance: 'forest' }, label: 'Story card' }] }
  expect(selectionControls(manifest, [icon], 'home').map(c => [c.param.id, c.scope])).toEqual([['card-radius', 'From Story card · All instances']])
  const scoped = structuredClone(manifest)
  scoped.bindings.find(b => b.paramId === 'card-radius')!.target!.instance = 'coast'
  expect(selectionControls(scoped, [icon], 'home')).toEqual([])
})

it('puts local controls before inherited controls regardless of manifest group order', () => {
  const local = structuredClone(manifest)
  local.bindings.find(b => b.paramId === 'accent')!.scope = 'element'
  local.bindings.find(b => b.paramId === 'accent')!.target = { id: 'hero' }
  const selected = { ...target, ancestors: [{ key: 'hero', stable: { id: 'hero' }, label: 'Hero' }] }
  expect(selectionControls(local, [selected], 'home').map(c => c.param.id)).toEqual(['hero-size', 'hero-copy', 'accent'])
})
