# @paramrig/audio-labs

ParamRig's headless sound generation, variation, fusion, criteria and catalogs. Depends on Audio and Core; it does not install an editor or React.

```sh
npm install @paramrig/audio-labs
```

```js
import { DEFAULT_CRITERIA, generateSound } from '@paramrig/audio-labs'
import { renderPatch } from '@paramrig/audio'

const sound = generateSound({ ...DEFAULT_CRITERIA, type: 'notification' }, 171)
const samples = renderPatch(sound.patch, 48000)
```

Persist the returned sound, including its patch and identity metadata. Replay the saved patch directly; do not regenerate it from a recipe during migration. Use `fusionCompatibility` before fusion and surface its explanation. Criteria and request validators expose the existing generation limits.

This package is synchronous and headless. Hosts choose their own worker, cancellation and playback integration. Node 22 and modern ESM browsers are supported. React controls and the Sound Labs editor are separate concerns.
