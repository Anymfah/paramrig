/*
 * A project that has installed the package, written the way the README tells it to. It is compiled
 * against the emitted declarations by `npm run build:web-sdk`; nothing here runs.
 */
import { connectWeb, parseManifest } from '@paramrig/web'
import type { ParamValue, WebAdapter, WebProjectManifest } from '@paramrig/web'
import file from './manifest.json' with { type: 'json' }

let headingFont = 'Georgia'
const setHeadingFont = (value: string) => { headingFont = value }

const headings: WebAdapter = {
  read: (): ParamValue => headingFont,
  apply: (value: ParamValue) => setHeadingFont(String(value)),
  restore: () => setHeadingFont('Georgia'),
}

const manifest: WebProjectManifest = parseManifest(file)
const connection = connectWeb({ manifest, adapters: { headings } })

// A list is accepted, and so is a single origin; both are optional.
connectWeb({ manifest, hostOrigin: 'http://localhost:5174' }).dispose()
connectWeb({ manifest, hostOrigin: ['http://localhost:5174', 'http://127.0.0.1:5174'] }).dispose()

export const pages: number = manifest.pages.length
export const dispose = () => connection.dispose()
