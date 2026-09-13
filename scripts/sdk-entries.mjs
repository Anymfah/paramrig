import packageEntries from '../packages/entries.json' with { type: 'json' }
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const entries = packageEntries
export const specifier = (name, entry) => `@paramrig/${name}${entry === '.' ? '' : entry.slice(1)}`
export const sourceAliases = Object.entries(entries).flatMap(([name, points]) =>
  Object.entries(points).map(([entry, source]) => ({
    find: specifier(name, entry), replacement: resolve(root, source),
  }))).sort((a, b) => b.find.length - a.find.length)
