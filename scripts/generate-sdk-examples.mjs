import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root } from './sdk-entries.mjs'
import { fixtures } from './consumer-fixtures.mjs'

// Public examples and packed-consumer checks exercise the same imports.
for (const [name, fixture] of Object.entries(fixtures)) {
  const directory = resolve(root, 'examples/sdk', name)
  await mkdir(directory, { recursive: true })
  const dependencies = Object.fromEntries(fixture.packages.map(name => [`@paramrig/${name}`, '0.1.0']))
  if (name === 'scene') dependencies.three = '0.185.1'
  if (fixture.packages.includes('controls')) Object.assign(dependencies, { react: '19.2.0', 'react-dom': '19.2.0' })
  // Only the public package requested by the host needs to be installed explicitly.
  if (name !== 'core') delete dependencies['@paramrig/core']
  const browser = Boolean(fixture.browser)
  const manifest = { name: `paramrig-example-${name}`, private: true, type: 'module',
    scripts: browser ? { dev: 'vite --host 0.0.0.0', build: 'vite build' } : { start: 'node index.mjs' },
    dependencies, ...(browser ? { devDependencies: { vite: '8.2.2' } } : {}) }
  await writeFile(resolve(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  if (browser) {
    await writeFile(resolve(directory, 'sdk.js'), fixture.browser + '\n')
    const template = await readFile(resolve(root, 'tests/consumers', `${name}.html`), 'utf8')
    await writeFile(resolve(directory, 'index.html'), template.replaceAll('__SDK_ENTRY__', './sdk.js').replace(/<link[^>]+__SDK_STYLES__[^>]*>/g, ''))
  } else {
    await writeFile(resolve(directory, 'index.mjs'), fixture.node + `\nconsole.log('${name}: public API completed successfully')\n`)
  }
  if (name === 'vector') {
    await mkdir(resolve(directory, 'public/fonts'), { recursive: true })
    for (const file of ['SourceSerif4.ttf', 'SourceSerif4.woff2', 'SourceSerif4-OFL.txt']) await cp(resolve(root, 'public/fonts', file), resolve(directory, 'public/fonts', file))
  }
  await writeFile(resolve(directory, 'README.md'), `# ${name} example\n\nA standalone consumer of the public npm packages. Copy this directory outside the ParamRig repository.\n\n\`\`\`sh\nnpm install\nnpm ${browser ? 'run dev' : 'start'}\n\`\`\`\n\n${browser ? 'Vite prints the local URL. The example uses no repository aliases or application sources. Run `npm run build` to produce a standalone browser distribution.' : 'Requires Node.js 22 or newer. The checks fail if rendering, serialization or the public contract changes.'}\n\n${name === 'vector' ? 'Fonts are supplied by this host from `public/fonts`, with the included SIL Open Font License. Replace the resolver to use your own resources. PDF outlines use the supplied TTF; browser text uses WOFF2. Server rendering is not claimed to match browser typography.' : name === 'scene' ? 'Three.js is an explicit host dependency. Both integrations share that single copy. Destroying the optional viewer leaves the host renderer running.' : name === 'audio-browser' ? 'Playback starts from a user gesture. Both players share the host context; stopping or destroying one never closes it. This example owns and closes the context on page exit.' : name === 'controls' ? 'React and React DOM belong to the host. The explicit stylesheet import is in `sdk.js`. Values, gesture history and resources belong to this application.' : 'No browser storage or editor is required.'}\n`)
}
