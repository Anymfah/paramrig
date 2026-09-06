import { expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest, type WebTarget } from './contracts'
import { needsReattach, overlayChrome, selectionControls, statusWord, targetControls } from './selection'

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

it('counts the controls that reach a target, and takes the count the page sent', () => {
  expect(targetControls(manifest, target, 'home')).toBe(2)
  expect(targetControls(manifest, { ...target, stable: { id: 'story-card', instance: 'coast' } }, 'home')).toBe(1)
  expect(targetControls(manifest, { ...target, stable: undefined }, 'home')).toBe(0)
  expect(targetControls(manifest, { ...target, controls: 7 }, 'home')).toBe(7)
})

it('says what is wrong with a target in words, and offers repair only where it helps', () => {
  expect([statusWord.resolved, statusWord.provisional, statusWord.missing, statusWord.ambiguous])
    .toEqual(['', 'Not instrumented', 'Missing on this page', 'Several matches'])
  expect(['resolved', 'provisional', 'missing', 'ambiguous'].map(s => needsReattach(s as WebTarget['status'])))
    .toEqual([false, false, true, true])
})

it('reads the overlay colours as hex, whatever shape the token has', () => {
  document.documentElement.style.setProperty('--focus-ring', 'rgb(28 29 30 / 0.5)')
  document.documentElement.style.setProperty('--surface-raised', '#e6e6e6')
  document.documentElement.style.setProperty('--text-primary', 'rgb(255, 255, 255)')
  expect(overlayChrome('light')).toEqual({ outline: '#1c1d1e80', chip: '#e6e6e6', chipText: '#ffffff' })
  document.documentElement.removeAttribute('style')
  // With no tokens at all the page still gets a legible overlay rather than an empty stroke.
  expect(overlayChrome('dark')).toEqual({ outline: '#b4d3c8', chip: '#1e2423', chipText: '#eef2f1' })
  expect(overlayChrome('light').chipText).toBe('#1c1d1e')
})
