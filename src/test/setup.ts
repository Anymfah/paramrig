import '@testing-library/jest-dom/vitest'
import { clearSceneDocumentCache } from '@/scene/document'

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => undefined
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => undefined
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false
}

// jsdom has no 2D canvas; paper.js only needs a context object to set up a headless project.
if (typeof HTMLCanvasElement !== 'undefined') {
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, ...args: unknown[]) {
    const real = (original as unknown as (...inner: unknown[]) => unknown).apply(this, args)
    if (real) return real as CanvasRenderingContext2D
    return new Proxy({ canvas: this }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined }) as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext
}

// jsdom has no ResizeObserver; the viewport host asks for one the moment it mounts.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver
}

/*
 * jsdom has no `matchMedia`. Anything that asks the platform a question — a reduced-motion
 * preference, a coarse pointer, a colour scheme — gets "no" from this, which is the answer that
 * makes a test render the ordinary case rather than the exception.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

/*
 * The scene store keeps what it read in memory, so a test that clears storage behind its back has
 * to say so. Patching `clear` here rather than in every test file keeps the win — reads that cost
 * nothing — without making each test remember a cache it never asked for.
 */
if (typeof localStorage !== 'undefined') {
  const clear = localStorage.clear.bind(localStorage)
  localStorage.clear = () => {
    clear()
    clearSceneDocumentCache()
  }
}
