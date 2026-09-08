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
    expect(playsOnSpace(null, false)).toBe(true)
    expect(playsOnSpace(make('<div></div>'), false)).toBe(true)
    expect(playsOnSpace(document.body, false)).toBe(true)
  })

  it('leaves the key alone where text is being typed', () => {
    expect(playsOnSpace(make('<input type="text" />'), false)).toBe(false)
    expect(playsOnSpace(make('<input />'), false)).toBe(false)
    expect(playsOnSpace(make('<input type="search" />'), false)).toBe(false)
    expect(playsOnSpace(make('<textarea></textarea>'), false)).toBe(false)
    expect(playsOnSpace(make('<div contenteditable="true"></div>'), false)).toBe(false)
    expect(playsOnSpace(make('<div role="textbox"></div>'), false)).toBe(false)
  })

  /**
   * The workspace's own number fields. A space is never part of a number, and the expressions they
   * accept do not need one — `2*3` works — so the transport wins here, which is the whole point.
   */
  it('plays from inside a numeric field', () => {
    expect(playsOnSpace(make('<input inputmode="decimal" />'), false)).toBe(true)
    expect(playsOnSpace(make('<input inputmode="numeric" />'), false)).toBe(true)
    expect(playsOnSpace(make('<input type="number" />'), false)).toBe(true)
    expect(playsOnSpace(make('<input role="spinbutton" />'), false)).toBe(true)
    expect(playsOnSpace(make('<input inputmode="decimal" role="spinbutton" />'), true)).toBe(true)
  })

  it('plays from a slider, which does nothing with the key anyway', () => {
    expect(playsOnSpace(make('<input type="range" />'), true)).toBe(true)
  })

  /** The distinction the whole file exists for: a leftover focus is not an intention. */
  it('plays from a button left focused by a click, and not from one reached by keyboard', () => {
    const button = make('<button>Square</button>')
    expect(playsOnSpace(button, false)).toBe(true)
    expect(playsOnSpace(button, true)).toBe(false)
  })

  it('applies the same rule to the things that behave like buttons', () => {
    for (const html of ['<div role="button"></div>', '<div role="tab"></div>', '<div role="switch"></div>', '<a href="#x">Link</a>', '<summary></summary>']) {
      expect(playsOnSpace(make(html), false), html).toBe(true)
      expect(playsOnSpace(make(html), true), html).toBe(false)
    }
  })

  it('never takes the key from a select, which opens with it', () => {
    expect(playsOnSpace(make('<select></select>'), false)).toBe(true)
    expect(playsOnSpace(make('<select></select>'), true)).toBe(false)
  })

  it('leaves a checkbox its toggle when the keyboard is driving', () => {
    expect(playsOnSpace(make('<input type="checkbox" />'), true)).toBe(false)
    expect(playsOnSpace(make('<input type="checkbox" />'), false)).toBe(true)
  })
})
