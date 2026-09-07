import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { controllerCategories, controllerExamples } from '@/rigs/controller-catalog'

/*
 * Two documents count this catalogue in prose, and nothing made them recount it.
 * `README.md` advertised 62 examples in 10 families, and `docs/CONTROLLERS.md`
 * described Scene instruments in a section of its own while leaving it out of the
 * table above. Both survived review because the numbers are sentences here and a
 * list there: no build step reads either one. Reading the files is the only thing
 * that notices.
 *
 * The number a reader is owed is the number of cards `/docs/controls` draws, which
 * is `controllerExamples` — one declaration is hidden, and `ControlsPage.test.tsx`
 * holds that distinction.
 */
// Read from the repository root: under jsdom `import.meta.url` is an http URL, not a file one.
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/** `docs/CONTROLLERS.md` spells its counts out, so the assertion has to as well. */
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen']

/** The first cell of every row of the table under a heading, in the order they are written. */
const tableColumn = (source: string, heading: string) => {
  const body = source.split(`## ${heading}`)[1]?.split('\n##')[0] ?? ''
  return body
    .split('\n')
    .filter(line => line.startsWith('|'))
    .map(line => line.split('|')[1]!.trim())
    .filter(cell => cell !== 'Family' && !/^-+$/.test(cell))
}

describe('the documents count the catalogue that ships', () => {
  it('states the total and the family count in the README', () => {
    const heading = /^### (\d+) controllers, (\d+) families$/m.exec(read('README.md'))
    expect(heading).not.toBeNull()
    expect(Number(heading![1])).toBe(controllerExamples.length)
    expect(Number(heading![2])).toBe(controllerCategories.length)
  })

  it('states the same two numbers in the contracts', () => {
    const opening = /(\d+) interactive examples across (\w+)\s*\n?\s*families/.exec(read('docs/CONTROLLERS.md'))
    expect(opening).not.toBeNull()
    expect(Number(opening![1])).toBe(controllerExamples.length)
    expect(opening![2]).toBe(words[controllerCategories.length])
  })

  it('gives every family a row in the instruments table, in catalogue order', () => {
    // A family with a section of its own and no row is the exact shape of the last drift.
    expect(tableColumn(read('docs/CONTROLLERS.md'), 'Available instruments')).toEqual(
      controllerCategories.map(category => category.label),
    )
  })
})
