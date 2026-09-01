import '@testing-library/jest-dom/vitest'

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
