import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

export function measureBundle(outputs) {
  const modules = new Set()
  const files = outputs.map(output => {
    if (output.type === 'chunk') for (const id of Object.keys(output.modules)) modules.add(id)
    const bytes = output.type === 'chunk' ? output.code : output.source
    return { file: output.fileName, bytes: Buffer.byteLength(bytes), gzip: gzipSync(bytes).length }
  })
  return { modules, files, gzipBytes: files.reduce((total, file) => total + file.gzip, 0) }
}
export const containsDependency = (modules, name) => [...modules].some(id => id.replaceAll('\\', '/').includes(`/node_modules/${name}/`))

/** Exercise the same instrument on two known modules, one deferred, and a known asset. */
export async function calibrateBundleMetrics() {
  assert.equal(gzipSync('hello').length, 25, 'Gzip calibration changed')
  const entry = '/probe/entry.js'
  const foreign = '/probe/node_modules/three/index.js'
  const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
    plugins: [{ name: 'metric-calibration',
      resolveId(id) { if (id === entry || id === foreign) return id },
      load(id) {
        if (id === entry) return `export const value = 7; export const deferred = () => import(${JSON.stringify(foreign)});`
        if (id === foreign) return 'export const cube = 3;'
      },
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'known.txt', source: 'hello' }) },
    }],
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => result.output)
  const measured = measureBundle(outputs)
  assert.equal(measured.files.length, 3, 'The probe missed a deferred chunk or asset')
  assert(measured.modules.has(entry) && measured.modules.has(foreign), 'The probe missed known source modules')
  assert(containsDependency(measured.modules, 'three'), 'The probe missed the forbidden dependency control')
  assert(!containsDependency(measured.modules, 'react'), 'The probe invented an absent dependency')
  assert.deepEqual(measured.files.find(file => file.file === 'known.txt'), { file: 'known.txt', bytes: 5, gzip: 25 })
  assert.equal(measured.gzipBytes, outputs.filter(output => output.type === 'chunk').reduce((total, output) => total + gzipSync(output.code).length, 25))
}
