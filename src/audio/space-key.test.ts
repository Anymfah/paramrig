import { describe, expect, it } from 'vitest'
import { playsOnSpace } from '@/audio/space-key'

const make = (html: string): Element => {
  const host = document.createElement('div')
  host.innerHTML = html
  const element = host.firstElementChild
  if (!element) throw new Error('the fixture should have an element')
  return element
}

describe('playsOnSpace', () => {
  it('plays when nothing in particular has focus', () => {
    expect(playsOnSpace(null)).toBe(true)
    expect(playsOnSpace(make('<div></div>'))).toBe(true)
    expect(playsOnSpace(document.body)).toBe(true)
  })

  it('leaves the key alone where text is being typed', () => {
    for (const html of ['<input type="text" />', '<input />', '<input type="search" />', '<input type="email" />', '<textarea></textarea>', '<div contenteditable="true"></div>', '<div role="textbox"></div>']) {
      expect(playsOnSpace(make(html)), html).toBe(false)
    }
  })

  it('plays from inside a numeric field, where a space is never part of the value', () => {
    for (const html of ['<input inputmode="decimal" />', '<input inputmode="numeric" />', '<input type="number" />', '<input role="spinbutton" />']) {
      expect(playsOnSpace(make(html)), html).toBe(true)
    }
  })

  /**
   * The whole point. A workspace is made of controls, so a rule that spares any focused control
   * spares nearly everything — and a transport that only works over blank background is not one.
   * These all keep Enter, or arrow keys, so nothing becomes unreachable.
   */
  it('takes the key from a focused button, switch, tab or segment', () => {
    for (const html of ['<button>Square</button>', '<div role="button"></div>', '<div role="switch"></div>', '<div role="tab"></div>', '<div role="radio"></div>', '<a href="#x">Link</a>', '<summary></summary>', '<select></select>']) {
      expect(playsOnSpace(make(html)), html).toBe(true)
    }
  })

  /** The one control where space is the only key that does anything, so it keeps it. */
  it('spares a native checkbox and radio, which have no other key', () => {
    expect(playsOnSpace(make('<input type="checkbox" />'))).toBe(false)
    expect(playsOnSpace(make('<input type="radio" />'))).toBe(false)
  })

  it('plays from a slider, which does nothing with the key anyway', () => {
    expect(playsOnSpace(make('<input type="range" />'))).toBe(true)
  })
})
