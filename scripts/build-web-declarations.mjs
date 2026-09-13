import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root } from './sdk-entries.mjs'

const configPath = resolve(root, 'tsconfig.web-sdk.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const host = ts.createCompilerHost(parsed.options)
const originalRead = host.readFile.bind(host)
// Web carries its existing structural types, compiled from the canonical Core source.
// This keeps the public Web paths stable without adding a Core installation dependency.
const source = new Map(['types', 'extended-types'].map(name => [resolve(root, `src/rigs/${name}.ts`), resolve(root, `packages/core/src/${name}.ts`)]))
host.readFile = file => source.has(resolve(file)) ? readFileSync(source.get(resolve(file)), 'utf8') : originalRead(file)
const write = host.writeFile.bind(host)
host.writeFile = (file, content, ...rest) => write(file, content.replace(/(['"])(\.{1,2}\/[^'"\n]+)\1/g, (_match, quote, path) => `${quote}${path.replace(/\.ts$/, '').replace(/(?:\.js)?$/, '.js')}${quote}`), ...rest)
const program = ts.createProgram(parsed.fileNames, parsed.options, host)
const result = program.emit()
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...result.diagnostics]
if (diagnostics.length || result.emitSkipped) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n' }))
  process.exit(1)
}
